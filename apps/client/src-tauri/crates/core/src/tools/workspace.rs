//! `app_workspace_list` / `app_workspace_read`：Agent 工作区的目录白名单与受限读取。
//!
//! 越界判定：目标与白名单目录都先 `canonicalize`，再按路径分量比对前缀 ——
//! symlink 指向白名单之外时会被解析成真实路径再拒绝（不是字符串前缀匹配）。
//! 单次读取有字节上限：读进整个仓库会把上下文撑爆。
use std::{fs, path::PathBuf};

use cogito_database::entity::agent_workspace_folder as schema;
use sea_orm::DatabaseConnection;
use serde_json::{Value, json};

use super::{Effect, ToolSpec, describe};
use crate::agent_workspace_folder::Service;

pub const LIST: &str = "app_workspace_list";
pub const READ: &str = "app_workspace_read";

/// 默认读取上限 256 KB；硬上限 1 MB。
const DEFAULT_MAX_BYTES: u64 = 256 * 1024;
const HARD_MAX_BYTES: u64 = 1024 * 1024;

/// 这个模块是否接管该工具名（供 `tools::call` 分发）。
#[must_use]
pub fn owns(name: &str) -> bool {
    name == LIST || name == READ
}

#[must_use]
pub fn specs() -> Vec<ToolSpec> {
    vec![list_spec(), read_spec()]
}

fn list_spec() -> ToolSpec {
    describe(
        LIST,
        "列出 Agent 工作区已登记的目录（可按 workspaceID 过滤）。这些目录是读文件的允许范围。",
        Effect::Read,
        json!({
            "type": "object",
            "properties": {
                "workspaceID": { "type": "string", "description": "只列该工作区的目录；省略则列全部" }
            },
            "additionalProperties": false
        }),
    )
}

fn read_spec() -> ToolSpec {
    describe(
        READ,
        "读取工作区目录内的文本文件（超出白名单或非 UTF-8 会被拒绝）。默认最多读 256 KB。",
        Effect::Read,
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "文件绝对路径；必须在已登记的工作区目录内" },
                "workspaceID": { "type": "string", "description": "限定只在该工作区的目录内查找" },
                "maxBytes": { "type": "integer", "description": "读取上限（字节），默认 262144，最大 1048576" }
            },
            "required": ["path"],
            "additionalProperties": false
        }),
    )
}

pub async fn call(db: &DatabaseConnection, name: &str, arguments: &Value) -> Result<Value, String> {
    match name {
        LIST => list(db, arguments).await,
        READ => read(db, arguments).await,
        other => Err(format!("未知工具：{other}")),
    }
}

async fn list(db: &DatabaseConnection, arguments: &Value) -> Result<Value, String> {
    let params = schema::ReadP::One(schema::Read {
        id: None,
        workspaceID: arguments
            .get("workspaceID")
            .and_then(Value::as_str)
            .map(str::to_string),
    });
    let rows = Service::toRead(db, params)
        .await
        .map_err(|error| error.to_string())?;
    serde_json::to_value(rows).map_err(|error| error.to_string())
}

async fn read(db: &DatabaseConnection, arguments: &Value) -> Result<Value, String> {
    let raw = arguments
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "缺少参数 path".to_string())?;
    let limit = arguments
        .get("maxBytes")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_MAX_BYTES)
        .clamp(1, HARD_MAX_BYTES);

    let roots = find_roots(db, arguments.get("workspaceID").and_then(Value::as_str)).await?;
    if roots.is_empty() {
        return Err("没有可用的工作区目录（未登记或目录不存在）".to_string());
    }

    let target = fs::canonicalize(raw).map_err(|error| format!("无法访问 {raw}：{error}"))?;
    let Some(root) = roots.iter().find(|root| target.starts_with(root)) else {
        return Err(format!("{} 不在已登记的工作区目录内", target.display()));
    };
    let metadata = fs::metadata(&target).map_err(|error| format!("读取失败：{error}"))?;
    if !metadata.is_file() {
        return Err(format!("{} 不是文件", target.display()));
    }

    let bytes = fs::read(&target).map_err(|error| format!("读取失败：{error}"))?;
    let truncated = bytes.len() as u64 > limit;
    let slice = &bytes[..(limit as usize).min(bytes.len())];
    // 截断可能切在多字节字符中间：lossy 解码，宁可多一个替换符也不要报错
    let content = String::from_utf8_lossy(slice).into_owned();

    Ok(json!({
        "path": target.to_string_lossy(),
        "root": root.to_string_lossy(),
        "bytes": bytes.len(),
        "truncated": truncated,
        "content": content,
    }))
}

async fn find_roots(
    db: &DatabaseConnection,
    workspace_id: Option<&str>,
) -> Result<Vec<PathBuf>, String> {
    let params = schema::ReadP::One(schema::Read {
        id: None,
        workspaceID: workspace_id.map(str::to_string),
    });
    let rows = Service::toRead(db, params)
        .await
        .map_err(|error| error.to_string())?;
    Ok(rows
        .iter()
        .filter_map(|row| fs::canonicalize(&row.path).ok())
        .collect())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use sea_orm::{ConnectionTrait, Database, DatabaseBackend, Statement};

    use super::*;

    struct Fixture {
        db: Arc<DatabaseConnection>,
        base: PathBuf,
        root: PathBuf,
        outside: PathBuf,
    }

    /// 建库 + 一个工作区/目录行 + 白名单内外的两个文件。
    async fn fixture() -> Fixture {
        let connection = Arc::new(
            Database::connect("sqlite::memory:")
                .await
                .expect("in-memory sqlite"),
        );
        cogito_database::migration::run(&connection)
            .await
            .expect("migration");

        let base = std::env::temp_dir().join(format!("cogito-ws-{}", uuid::Uuid::new_v4()));
        let root = base.join("root");
        let outside = base.join("outside");
        fs::create_dir_all(&root).expect("root dir");
        fs::create_dir_all(&outside).expect("outside dir");
        fs::write(root.join("a.md"), "# 工作区内的文件").expect("write inside");
        fs::write(outside.join("b.md"), "白名单之外").expect("write outside");

        for statement in [
            "INSERT INTO agent_workspace (id,title,icon,color,pinned,createdAt,updatedAt) \
             VALUES ('w1','工作区','folder','#166534',0,1,1)"
                .to_string(),
            format!(
                "INSERT INTO agent_workspace_folder \
                 (id,\"workspaceID\",path,\"isPrimary\",sort,\"createdAt\",\"updatedAt\") \
                 VALUES ('f1','w1','{}',1,0,1,1)",
                root.to_string_lossy().replace('\'', "''")
            ),
        ] {
            connection
                .execute(Statement::from_string(DatabaseBackend::Sqlite, statement))
                .await
                .expect("insert fixture");
        }

        Fixture {
            db: connection,
            base,
            root,
            outside,
        }
    }

    #[tokio::test]
    async fn reads_file_inside_workspace() {
        let fixture = fixture().await;
        let value = read(
            &fixture.db,
            &json!({ "path": fixture.root.join("a.md").to_string_lossy() }),
        )
        .await
        .expect("白名单内应可读");
        assert_eq!(value["content"], json!("# 工作区内的文件"));
        assert_eq!(value["truncated"], json!(false));

        fs::remove_dir_all(&fixture.base).ok();
    }

    #[tokio::test]
    async fn rejects_path_outside_workspace() {
        let fixture = fixture().await;
        let error = read(
            &fixture.db,
            &json!({ "path": fixture.outside.join("b.md").to_string_lossy() }),
        )
        .await
        .expect_err("白名单外必须拒绝");
        assert!(error.contains("不在已登记的工作区目录内"), "{error}");

        fs::remove_dir_all(&fixture.base).ok();
    }

    #[tokio::test]
    async fn truncates_oversized_read() {
        let fixture = fixture().await;
        let value = read(
            &fixture.db,
            &json!({ "path": fixture.root.join("a.md").to_string_lossy(), "maxBytes": 4 }),
        )
        .await
        .expect("应可读并截断");
        assert_eq!(value["truncated"], json!(true));
        assert_eq!(
            value["bytes"],
            json!(fs::metadata(fixture.root.join("a.md")).unwrap().len())
        );

        fs::remove_dir_all(&fixture.base).ok();
    }
}
