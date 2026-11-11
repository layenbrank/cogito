//! 代码索引工具面（S12）：`app_code_*`。
//!
//! 五个只读工具，全部建立在 `cogito_codeindex` 的 tree-sitter 索引之上：
//! 建索引、看大纲、找引用、算影响面、按名字搜。**没有写路径** —— 索引是派生数据，
//! 工具只负责把它暴露给 Agent，改代码仍然只能走 `app_workspace_write` / `app_workspace_patch`。
//!
//! 索引缓存：进程内按根目录缓存 60 秒。为什么不落库：`code_symbol` / `code_edge`
//! 本质是缓存（删了能重建），落库就要迁移 + 失效逻辑，而重建一遍本地仓库只要几百毫秒。
//! 代价写在 ADR 的欠账里：跨重启第一次调用会慢一点。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use cogito_codeindex::{
    EdgeKind, Index, SymbolKind, describe, index_root, lang_supported, normalize_path,
};
use sea_orm::DatabaseConnection;
use serde_json::{Value, json};

use super::workspace::find_roots;
use super::{Effect, ToolSpec, describe as describe_tool};

/// 建索引 / 看摘要
pub const SYMBOLS: &str = "app_code_symbols";
/// 单文件符号大纲
pub const OUTLINE: &str = "app_code_outline";
/// 谁引用了某个名字 / 模块
pub const REFS: &str = "app_code_refs";
/// 影响面（传递闭包）
pub const IMPACT: &str = "app_code_impact";
/// 按名字搜符号
pub const SEARCH: &str = "app_code_search";

/// 单次返回上限；参数可下调不可上调。
const DEFAULT_LIMIT: usize = 100;
const MAX_LIMIT: usize = 500;
/// 影响面的默认展开层数。
const DEFAULT_DEPTH: usize = 3;
const MAX_DEPTH: usize = 6;
/// 索引缓存存活时间：目录内容变了，最多 1 分钟后能看到。
const CACHE_TTL: Duration = Duration::from_secs(60);

pub fn owns(name: &str) -> bool {
    matches!(name, SYMBOLS | OUTLINE | REFS | IMPACT | SEARCH)
}

pub fn specs() -> Vec<ToolSpec> {
    vec![
        describe_tool(
            SYMBOLS,
            "为一个工作区建立代码索引（tree-sitter，只读），返回文件/符号/边的规模摘要。\
             索引在进程内缓存 60 秒；传 refresh=true 可强制重建。",
            Effect::Read,
            json!({
                "type": "object",
                "properties": {
                    "workspaceID": { "type": "string", "description": "工作区 id；缺省用第一个已登记目录" },
                    "refresh": { "type": "boolean", "description": "true = 丢弃缓存重新索引" }
                }
            }),
        ),
        describe_tool(
            OUTLINE,
            "列出一个源码文件的符号大纲（函数/类/方法/结构体…，带行号与父符号）。\
             path 可以是绝对路径，也可以是相对工作区根的路径。",
            Effect::Read,
            json!({
                "type": "object",
                "properties": {
                    "workspaceID": { "type": "string" },
                    "path": { "type": "string", "description": "文件路径（绝对或相对工作区根）" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": MAX_LIMIT }
                },
                "required": ["path"]
            }),
        ),
        describe_tool(
            REFS,
            "列出指向某个名字或模块说明符的边（import / call，按名字连，不做类型消解）。\
             用来回答「谁用了这个函数 / 谁 import 了这个文件」。",
            Effect::Read,
            json!({
                "type": "object",
                "properties": {
                    "workspaceID": { "type": "string" },
                    "name": { "type": "string", "description": "符号名或模块说明符（如 './session' 或 'spawn'）" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": MAX_LIMIT }
                },
                "required": ["name"]
            }),
        ),
        describe_tool(
            IMPACT,
            "算影响面：从某个名字/模块出发，沿 import 与 call 边反向展开，列出（传递地）受影响的文件。",
            Effect::Read,
            json!({
                "type": "object",
                "properties": {
                    "workspaceID": { "type": "string" },
                    "name": { "type": "string" },
                    "depth": { "type": "integer", "minimum": 1, "maximum": MAX_DEPTH },
                    "limit": { "type": "integer", "minimum": 1, "maximum": MAX_LIMIT }
                },
                "required": ["name"]
            }),
        ),
        describe_tool(
            SEARCH,
            "按名字搜索符号（子串、大小写不敏感），返回名字/种类/文件/行号。",
            Effect::Read,
            json!({
                "type": "object",
                "properties": {
                    "workspaceID": { "type": "string" },
                    "query": { "type": "string", "description": "符号名子串" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": MAX_LIMIT }
                },
                "required": ["query"]
            }),
        ),
    ]
}

pub async fn call(db: &DatabaseConnection, name: &str, arguments: &Value) -> Result<Value, String> {
    match name {
        SYMBOLS => symbols(db, arguments).await,
        OUTLINE => outline(db, arguments).await,
        REFS => refs(db, arguments).await,
        IMPACT => impact(db, arguments).await,
        SEARCH => search(db, arguments).await,
        other => Err(format!("未知工具：{other}")),
    }
}

/// 索引缓存条目。`Arc` 让「读缓存」不必复制几万个符号。
struct Cached {
    at: Instant,
    index: Arc<Index>,
}

fn cache() -> &'static Mutex<HashMap<String, Cached>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Cached>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 取索引：命中缓存（且未过期）就直接用，否则重建。
///
/// 同步构建：tree-sitter 解析是 CPU 活，这里没有 await 点，锁也不会跨 yield
/// 持有 —— 一次调用几百毫秒，比让 Agent 等两次往返便宜。
fn index_for(root: &Path, refresh: bool) -> Result<Arc<Index>, String> {
    let key = normalize_path(&root.to_string_lossy());
    if !refresh
        && let Ok(guard) = cache().lock()
        && let Some(entry) = guard.get(&key)
        && entry.at.elapsed() < CACHE_TTL
    {
        return Ok(entry.index.clone());
    }
    let index = Arc::new(index_root(root)?);
    if let Ok(mut guard) = cache().lock() {
        guard.insert(
            key,
            Cached {
                at: Instant::now(),
                index: index.clone(),
            },
        );
    }
    Ok(index)
}

/// 解析根目录：`workspaceID` 限定范围，`path` 若给了就必须落在某个根里。
async fn resolve_root(
    db: &DatabaseConnection,
    arguments: &Value,
) -> Result<(PathBuf, Option<String>), String> {
    let workspace_id = arguments.get("workspaceID").and_then(Value::as_str);
    let roots = find_roots(db, workspace_id).await?;
    if roots.is_empty() {
        return Err("没有可用的工作区目录（未登记或目录不存在）".to_string());
    }
    let Some(raw) = arguments.get("path").and_then(Value::as_str) else {
        return Ok((roots[0].clone(), None));
    };
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("path 不能为空".to_string());
    }
    let candidate = PathBuf::from(raw);
    let absolute = if candidate.is_absolute() {
        candidate
    } else {
        roots[0].join(&candidate)
    };
    let target = std::fs::canonicalize(&absolute)
        .map_err(|error| format!("无法访问 {}：{error}", absolute.display()))?;
    let Some(root) = roots.iter().find(|root| target.starts_with(root)).cloned() else {
        return Err(format!("{} 不在已登记的工作区目录内", target.display()));
    };
    let relative = target
        .strip_prefix(&root)
        .map(|path| normalize_path(&path.to_string_lossy()))
        .ok()
        .filter(|path| !path.is_empty());
    Ok((root, relative))
}

fn limit_of(arguments: &Value, key: &str, default: usize) -> usize {
    arguments
        .get(key)
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(default)
        .clamp(1, MAX_LIMIT)
}

fn symbol_json(symbol: &cogito_codeindex::Symbol) -> Value {
    json!({
        "name": symbol.name,
        "kind": kind_label(symbol.kind),
        "path": symbol.path,
        "line": symbol.line,
        "endLine": symbol.end_line,
        "parent": symbol.parent,
        "exported": symbol.exported,
    })
}

fn kind_label(kind: SymbolKind) -> &'static str {
    match kind {
        SymbolKind::Function => "function",
        SymbolKind::Method => "method",
        SymbolKind::Class => "class",
        SymbolKind::Interface => "interface",
        SymbolKind::Enum => "enum",
        SymbolKind::Struct => "struct",
        SymbolKind::Trait => "trait",
        SymbolKind::Impl => "impl",
        SymbolKind::Type => "type",
        SymbolKind::Const => "const",
        SymbolKind::Module => "module",
        SymbolKind::Variable => "variable",
    }
}

fn edge_json(edge: &cogito_codeindex::Edge) -> Value {
    json!({
        "from": edge.from,
        "to": edge.to,
        "kind": match edge.kind {
            EdgeKind::Import => "import",
            EdgeKind::Call => "call",
        },
        "line": edge.line,
    })
}

async fn symbols(db: &DatabaseConnection, arguments: &Value) -> Result<Value, String> {
    let (root, _) = resolve_root(db, arguments).await?;
    let refresh = arguments
        .get("refresh")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let index = index_for(&root, refresh)?;
    let kinds: HashMap<&'static str, usize> =
        index
            .symbols
            .iter()
            .fold(HashMap::new(), |mut acc, symbol| {
                *acc.entry(kind_label(symbol.kind)).or_insert(0) += 1;
                acc
            });
    Ok(json!({
        "root": index.root,
        "files": index.files,
        "skipped": index.skipped,
        "symbols": index.symbols.len(),
        "edges": index.edges.len(),
        "byKind": kinds,
        "summary": describe(&index),
        "cached": !refresh,
    }))
}

async fn outline(db: &DatabaseConnection, arguments: &Value) -> Result<Value, String> {
    let raw = arguments
        .get("path")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "缺少参数 path".to_string())?;
    if !lang_supported(raw) {
        return Err(format!("{raw} 不是已支持的语言（.ts/.tsx/.js/.jsx/.rs）"));
    }
    let (root, relative) = resolve_root(db, arguments).await?;
    let path = relative
        .clone()
        .or_else(|| Some(normalize_path(raw)))
        .unwrap_or_default();
    let index = index_for(&root, false)?;
    let limit = limit_of(arguments, "limit", DEFAULT_LIMIT);
    let rows: Vec<Value> = index
        .outline(&path)
        .into_iter()
        .take(limit)
        .map(symbol_json)
        .collect();
    Ok(json!({
        "root": index.root,
        "path": path,
        "count": rows.len(),
        "symbols": rows,
    }))
}

async fn refs(db: &DatabaseConnection, arguments: &Value) -> Result<Value, String> {
    let name = arguments
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "缺少参数 name".to_string())?;
    let (root, _) = resolve_root(db, arguments).await?;
    let index = index_for(&root, false)?;
    let limit = limit_of(arguments, "limit", DEFAULT_LIMIT);
    let rows: Vec<Value> = index.refs(name, limit).into_iter().map(edge_json).collect();
    Ok(json!({
        "root": index.root,
        "name": name,
        "count": rows.len(),
        "refs": rows,
    }))
}

async fn impact(db: &DatabaseConnection, arguments: &Value) -> Result<Value, String> {
    let name = arguments
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "缺少参数 name".to_string())?;
    let (root, _) = resolve_root(db, arguments).await?;
    let index = index_for(&root, false)?;
    let depth = arguments
        .get("depth")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_DEPTH)
        .clamp(1, MAX_DEPTH);
    let limit = limit_of(arguments, "limit", DEFAULT_LIMIT);
    let affected = index.impact(name, depth, limit);
    Ok(json!({
        "root": index.root,
        "name": name,
        "depth": depth,
        "count": affected.len(),
        "files": affected,
    }))
}

async fn search(db: &DatabaseConnection, arguments: &Value) -> Result<Value, String> {
    let query = arguments
        .get("query")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "缺少参数 query".to_string())?;
    let (root, _) = resolve_root(db, arguments).await?;
    let index = index_for(&root, false)?;
    let limit = limit_of(arguments, "limit", DEFAULT_LIMIT);
    let rows: Vec<Value> = index
        .search(query, limit)
        .into_iter()
        .map(symbol_json)
        .collect();
    Ok(json!({
        "root": index.root,
        "query": query,
        "count": rows.len(),
        "symbols": rows,
    }))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use sea_orm::{ConnectionTrait, Database, DatabaseBackend, Statement};

    use super::*;

    /// 建一个跑过迁移的库，登记一个临时工作区目录。
    async fn fixture() -> (Arc<DatabaseConnection>, PathBuf) {
        let db = Arc::new(
            Database::connect("sqlite::memory:")
                .await
                .expect("in-memory sqlite"),
        );
        cogito_database::migration::run(&db)
            .await
            .expect("migration");

        let base = std::env::temp_dir().join(format!("code-tools-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(base.join("src")).expect("mkdir");
        std::fs::write(
            base.join("src/board.ts"),
            "export function spawnTask() { return 1 }\nexport class Board { run() { return spawnTask() } }\n",
        )
        .expect("write");
        std::fs::write(
            base.join("src/main.ts"),
            "import { Board } from './board'\nnew Board().run()\n",
        )
        .expect("write");
        let root = std::fs::canonicalize(&base).expect("canonicalize");

        for statement in [
            "INSERT INTO agent_workspace (id,title,icon,color,pinned,createdAt,updatedAt) \
             VALUES ('w1','工作区','folder','#166534',0,1,1)"
                .to_string(),
            format!(
                "INSERT INTO agent_workspace_folder \
                 (id,\"workspaceID\",path,sort,\"createdAt\",\"updatedAt\") \
                 VALUES ('f1','w1','{}',0,1,1)",
                root.to_string_lossy().replace('\'', "''")
            ),
        ] {
            db.execute(Statement::from_string(DatabaseBackend::Sqlite, statement))
                .await
                .expect("insert fixture");
        }
        (db, root)
    }

    #[tokio::test]
    async fn symbols_reports_a_real_index() {
        let (db, _) = fixture().await;
        let value = symbols(&db, &json!({ "workspaceID": "w1" }))
            .await
            .expect("index");
        assert_eq!(value["files"], 2);
        assert!(value["symbols"].as_u64().unwrap_or(0) >= 2);
        assert!(value["summary"].as_str().unwrap_or("").contains("个文件"));
    }

    #[tokio::test]
    async fn outline_lists_file_symbols() {
        let (db, _) = fixture().await;
        let value = outline(&db, &json!({ "workspaceID": "w1", "path": "src/board.ts" }))
            .await
            .expect("outline");
        let names: Vec<&str> = value["symbols"]
            .as_array()
            .expect("array")
            .iter()
            .filter_map(|row| row["name"].as_str())
            .collect();
        assert!(names.contains(&"Board"), "{names:?}");
        assert!(names.contains(&"spawnTask"), "{names:?}");
    }

    #[tokio::test]
    async fn refs_and_impact_follow_imports() {
        let (db, _) = fixture().await;
        let refs_value = refs(&db, &json!({ "workspaceID": "w1", "name": "./board" }))
            .await
            .expect("refs");
        assert_eq!(refs_value["count"], 1);
        assert_eq!(refs_value["refs"][0]["from"], "src/main.ts");
        let impact_value = impact(&db, &json!({ "workspaceID": "w1", "name": "board" }))
            .await
            .expect("impact");
        assert_eq!(impact_value["files"][0], "src/main.ts");
    }

    #[tokio::test]
    async fn search_finds_symbols_by_name() {
        let (db, _) = fixture().await;
        let value = search(&db, &json!({ "workspaceID": "w1", "query": "spawn" }))
            .await
            .expect("search");
        assert_eq!(value["count"], 1);
        assert_eq!(value["symbols"][0]["name"], "spawnTask");
    }

    #[tokio::test]
    async fn missing_path_argument_is_a_readable_error() {
        let (db, _) = fixture().await;
        let error = outline(&db, &json!({ "workspaceID": "w1" }))
            .await
            .expect_err("缺 path 应报错");
        assert!(error.contains("path"), "{error}");
    }

    #[tokio::test]
    async fn path_outside_workspace_is_rejected() {
        let (db, _) = fixture().await;
        // 真实存在的 .ts 文件，但不在已登记的工作区里
        let outside = std::env::temp_dir().join(format!("outside-{}.ts", uuid::Uuid::new_v4()));
        std::fs::write(&outside, "export const x = 1\n").expect("write outside");
        let error = outline(
            &db,
            &json!({ "workspaceID": "w1", "path": outside.to_string_lossy() }),
        )
        .await
        .expect_err("越界路径应报错");
        let _ = std::fs::remove_file(&outside);
        assert!(error.contains("不在已登记的工作区目录内"), "{error}");
    }
}
