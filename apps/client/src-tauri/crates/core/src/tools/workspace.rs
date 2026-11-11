//! `app_workspace_*`：Agent 工作区的目录白名单与受限读写。
//!
//! 越界判定：目标与白名单目录都先 `canonicalize`，再按路径分量比对前缀 ——
//! symlink 指向白名单之外时会被解析成真实路径再拒绝（不是字符串前缀匹配）。
//! 单次读取有字节上限：读进整个仓库会把上下文撑爆。
//!
//! 写入（S3）：Agent 只能经 `app_workspace_write` / `app_workspace_patch` 改文件，
//! goose 内置 `text_editor` / `str_replace` / `apply_patch` 在审批层被 `never_allow`。
//! 路径守卫分两档：
//! - **HARD**：目标路径里出现 `.git` 分量 → 永久拒绝（改 hook 等于拿到执行权）；
//! - **SOFT**：`.env` / `.env.*` / `*.pem` / `*.key` / `*.p12` / `*.pfx` / `id_rsa*` 等
//!   → 需要用户确认（前端审批卡），工具侧必须收到 `confirm: true` 才落盘。
//!
//! 每次写入前把旧内容快照到临时目录（`cogito-agent-snapshots`），回执里同时给出
//! `previous`（前 20000 字符）与 `snapshotPath`，供 diff 卡 / 回滚复用。
use std::{
    ffi::OsString,
    fs,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use cogito_database::entity::agent_workspace_folder as schema;
use sea_orm::DatabaseConnection;
use serde::Deserialize;
use serde_json::{Value, json};

use super::{Effect, Risk, ToolSpec, describe_with_risk};
use crate::agent_workspace_folder::Service;

pub const LIST: &str = "app_workspace_list";
pub const READ: &str = "app_workspace_read";
pub const WRITE: &str = "app_workspace_write";
pub const PATCH: &str = "app_workspace_patch";

/// 默认读取上限 256 KB；硬上限 1 MB。
const DEFAULT_MAX_BYTES: u64 = 256 * 1024;
const HARD_MAX_BYTES: u64 = 1024 * 1024;
/// 单次写入上限 2 MB：再大就不是「改代码」，而是二进制搬运。
const MAX_WRITE_BYTES: usize = 2 * 1024 * 1024;
/// 回执里带回的旧内容预览长度。
const PREVIEW_CHARS: usize = 20_000;
/// 快照目录（系统临时目录下，随机器清理）。
const SNAPSHOT_DIR: &str = "cogito-agent-snapshots";

/// 永久禁止 Agent 写入的目录分量。
const LOCKED_SEGMENTS: &[&str] = &[".git"];
/// 需要逐次确认的文件前缀（`.env` / `.env.local` / `id_rsa.pub` …）。
const CONFIRM_PREFIXES: &[&str] = &[".env", "id_rsa", "id_ed25519", "id_ecdsa"];
/// 需要逐次确认的扩展名。
const CONFIRM_EXTENSIONS: &[&str] = &["pem", "key", "p12", "pfx"];
/// 桥注入的「无人值守」标记（目标模式）。键名固定，**模型无法伪造**：
/// 桥在调工具前会按 `agent_goal.status` 覆写这个字段。
pub const UNATTENDED_KEY: &str = "__unattended";

/// 写路径守卫结论。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteGuard {
    Allow,
    /// 受保护文件：需要用户确认（前端审批卡）。
    Confirm,
    /// 永久拒绝：`.git` 之类。
    Locked,
}

/// 这个模块是否接管该工具名（供 `tools::call` 分发）。
#[must_use]
pub fn owns(name: &str) -> bool {
    name == LIST || name == READ || name == WRITE || name == PATCH
}

#[must_use]
pub fn specs() -> Vec<ToolSpec> {
    vec![list_spec(), read_spec(), write_spec(), patch_spec()]
}

fn list_spec() -> ToolSpec {
    describe_with_risk(
        LIST,
        "列出 Agent 工作区已登记的目录（可按 workspaceID 过滤）。这些目录是读写文件的允许范围。",
        Effect::Read,
        Risk::Read,
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
    describe_with_risk(
        READ,
        "读取工作区目录内的文本文件（超出白名单或非 UTF-8 会被拒绝）。默认最多读 256 KB。",
        Effect::Read,
        Risk::Read,
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

fn write_spec() -> ToolSpec {
    describe_with_risk(
        WRITE,
        "在工作区内写入/覆盖一个文本文件（整文件写入）。`.git` 内的路径永久拒绝；`.env` / `*.pem` 等受保护文件需要用户确认后带 confirm=true 重试。",
        Effect::Write,
        Risk::Guarded,
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "文件绝对路径；必须在已登记的工作区目录内" },
                "content": { "type": "string", "description": "写入的完整内容（UTF-8），最大 2 MB" },
                "workspaceID": { "type": "string", "description": "限定只在该工作区的目录内查找" },
                "createParents": { "type": "boolean", "description": "父目录不存在时是否创建，默认 false" },
                "confirm": { "type": "boolean", "description": "受保护文件（.env / *.pem 等）必须由用户确认后置 true" }
            },
            "required": ["path", "content"],
            "additionalProperties": false
        }),
    )
}

fn patch_spec() -> ToolSpec {
    describe_with_risk(
        PATCH,
        "在工作区内按 oldText → newText 做定点替换（可多处），整文件只落盘一次。`.git` 永久拒绝；受保护文件需要 confirm=true。",
        Effect::Write,
        Risk::Guarded,
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "文件绝对路径；必须在已登记的工作区目录内" },
                "edits": {
                    "type": "array",
                    "description": "按顺序应用的替换列表",
                    "items": {
                        "type": "object",
                        "properties": {
                            "oldText": { "type": "string", "description": "要替换的原文（必须唯一命中，除非 replaceAll）" },
                            "newText": { "type": "string", "description": "替换后的文本" },
                            "replaceAll": { "type": "boolean", "description": "命中多处时全部替换，默认 false" }
                        },
                        "required": ["oldText", "newText"],
                        "additionalProperties": false
                    }
                },
                "workspaceID": { "type": "string", "description": "限定只在该工作区的目录内查找" },
                "confirm": { "type": "boolean", "description": "受保护文件（.env / *.pem 等）必须由用户确认后置 true" }
            },
            "required": ["path", "edits"],
            "additionalProperties": false
        }),
    )
}

pub async fn call(db: &DatabaseConnection, name: &str, arguments: &Value) -> Result<Value, String> {
    match name {
        LIST => list(db, arguments).await,
        READ => read(db, arguments).await,
        WRITE => write(db, arguments).await,
        PATCH => patch(db, arguments).await,
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

async fn write(db: &DatabaseConnection, arguments: &Value) -> Result<Value, String> {
    let raw = arguments
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "缺少参数 path".to_string())?;
    let content = arguments
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| "缺少参数 content".to_string())?;
    if content.len() > MAX_WRITE_BYTES {
        return Err(format!(
            "内容 {} 字节，超过单次写入上限 {MAX_WRITE_BYTES} 字节；请拆成多次写入",
            content.len()
        ));
    }

    let target = resolve_write_target(
        db,
        arguments.get("workspaceID").and_then(Value::as_str),
        raw,
        arg_bool(arguments, "createParents"),
    )
    .await?;
    let guard = guard_for(&target);
    let unattended = arg_bool(arguments, UNATTENDED_KEY);
    check_guard(&target, arg_bool(arguments, "confirm"), unattended)?;

    let previous_bytes = fs::read(&target).ok();
    let created = previous_bytes.is_none();
    let snapshot = write_snapshot(&target, previous_bytes.as_deref())?;
    fs::write(&target, content.as_bytes())
        .map_err(|error| format!("写入 {} 失败：{error}", target.display()))?;

    Ok(json!({
        "path": target.to_string_lossy(),
        "guard": guard_label(guard, unattended),
        "created": created,
        "bytes": content.len(),
        "previous": previous_bytes.as_deref().map(preview),
        "snapshotPath": snapshot,
    }))
}

async fn patch(db: &DatabaseConnection, arguments: &Value) -> Result<Value, String> {
    let raw = arguments
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "缺少参数 path".to_string())?;
    let edits: Vec<Edit> = serde_json::from_value(
        arguments
            .get("edits")
            .cloned()
            .ok_or_else(|| "缺少参数 edits".to_string())?,
    )
    .map_err(|error| format!("edits 结构不合法：{error}"))?;
    if edits.is_empty() {
        return Err("edits 不能为空".to_string());
    }

    let target = resolve_write_target(
        db,
        arguments.get("workspaceID").and_then(Value::as_str),
        raw,
        false,
    )
    .await?;
    let guard = guard_for(&target);
    let unattended = arg_bool(arguments, UNATTENDED_KEY);
    check_guard(&target, arg_bool(arguments, "confirm"), unattended)?;

    let previous_bytes =
        fs::read(&target).map_err(|error| format!("读取 {} 失败：{error}", target.display()))?;
    let original = String::from_utf8(previous_bytes.clone())
        .map_err(|_| format!("{} 不是 UTF-8 文本，无法按文本替换", target.display()))?;
    let (next, applied) = apply_edits(original, &edits)?;
    if next.len() > MAX_WRITE_BYTES {
        return Err(format!(
            "替换后 {} 字节，超过单次写入上限 {MAX_WRITE_BYTES} 字节",
            next.len()
        ));
    }

    let snapshot = write_snapshot(&target, Some(&previous_bytes))?;
    fs::write(&target, next.as_bytes())
        .map_err(|error| format!("写入 {} 失败：{error}", target.display()))?;

    Ok(json!({
        "path": target.to_string_lossy(),
        "guard": guard_label(guard, unattended),
        "applied": applied,
        "edits": edits.len(),
        "bytes": next.len(),
        "previous": preview(&previous_bytes),
        "snapshotPath": snapshot,
    }))
}

/// 一处定点替换。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Edit {
    old_text: String,
    new_text: String,
    #[serde(default)]
    replace_all: bool,
}

/// 按顺序应用替换；任何一处没命中都整体失败（不做半截写入）。
fn apply_edits(mut text: String, edits: &[Edit]) -> Result<(String, usize), String> {
    let mut applied = 0;
    for (index, edit) in edits.iter().enumerate() {
        if edit.old_text.is_empty() {
            return Err(format!("第 {} 处替换的 oldText 不能为空", index + 1));
        }
        let occurrences = text.matches(edit.old_text.as_str()).count();
        if occurrences == 0 {
            return Err(format!(
                "第 {} 处替换没找到 oldText（文件可能已被改动，请重新读取后再试）",
                index + 1
            ));
        }
        if occurrences > 1 && !edit.replace_all {
            return Err(format!(
                "第 {} 处 oldText 在文件里出现 {occurrences} 次；请补足上下文或设置 replaceAll=true",
                index + 1
            ));
        }
        text = if edit.replace_all {
            text.replace(edit.old_text.as_str(), edit.new_text.as_str())
        } else {
            text.replacen(edit.old_text.as_str(), edit.new_text.as_str(), 1)
        };
        applied += 1;
    }
    Ok((text, applied))
}

/// 写路径守卫：`.git` 永久拒；受保护文件要 `confirm`。
pub fn guard_for(path: &Path) -> WriteGuard {
    for component in path.components() {
        if let Component::Normal(name) = component
            && LOCKED_SEGMENTS
                .iter()
                .any(|segment| name.eq_ignore_ascii_case(segment))
        {
            return WriteGuard::Locked;
        }
    }

    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if CONFIRM_PREFIXES
        .iter()
        .any(|prefix| name == *prefix || name.starts_with(&format!("{prefix}.")))
    {
        return WriteGuard::Confirm;
    }
    if let Some(extension) = path.extension().and_then(|value| value.to_str())
        && CONFIRM_EXTENSIONS
            .iter()
            .any(|candidate| extension.eq_ignore_ascii_case(candidate))
    {
        return WriteGuard::Confirm;
    }
    WriteGuard::Allow
}

fn check_guard(target: &Path, confirm: bool, unattended: bool) -> Result<(), String> {
    match guard_for(target) {
        WriteGuard::Allow => Ok(()),
        WriteGuard::Locked => Err(format!(
            "{} 位于版本库元数据目录（.git）内：Agent 永久不可写。要改 git 行为请让用户在终端里操作",
            target.display()
        )),
        // `unattended` = 目标推进（无人值守）由桥注入的事实：受保护文件自动放行，
        // `.git` 不在这条豁免里。实际放行会写回执（`guard` 字段）并进审计行。
        WriteGuard::Confirm if confirm || unattended => Ok(()),
        WriteGuard::Confirm => Err(format!(
            "{} 是受保护文件（.env / 密钥类）。请先向用户说明将要改动哪些键，得到同意后带 confirm=true 重试",
            target.display()
        )),
    }
}

/// 回执里的守卫标记：让「为什么这次能写」有据可查（目标模式的放行不能是隐形的）
fn guard_label(guard: WriteGuard, unattended: bool) -> &'static str {
    match guard {
        WriteGuard::Allow => "open",
        WriteGuard::Locked => "locked",
        WriteGuard::Confirm if unattended => "unattended",
        WriteGuard::Confirm => "confirmed",
    }
}

/// 解析写入目标。
///
/// 两条顺序要求，都是踩过坑的：
/// 1. **先校验已存在的那一段，再建目录**。反过来（先 `create_dir_all` 再查根）等于让
///    越界路径在工作区外留下一堆目录，虽然写入被拒，越权副作用已经发生；
/// 2. **相对路径锂到工作区根**，不按进程 cwd。dev 下 cwd 可能正好是另一个工作区，
///    用 cwd 解析既可能写错仓库、又能通过根校验。
///
/// 目标存在时按真实路径复核：工作区里放一个指向外部的 symlink 不能把写入带出去。
async fn resolve_write_target(
    db: &DatabaseConnection,
    workspace_id: Option<&str>,
    raw: &str,
    create_parents: bool,
) -> Result<PathBuf, String> {
    let roots = find_roots(db, workspace_id).await?;
    if roots.is_empty() {
        return Err("没有可用的工作区目录（未登记或目录不存在）".to_string());
    }

    let candidate = anchor_to_root(raw, &roots)?;
    let parent = candidate
        .parent()
        .ok_or_else(|| format!("{raw} 没有父目录"))?;
    let name = candidate
        .file_name()
        .ok_or_else(|| format!("{raw} 缺少文件名"))?;

    let (parent_real, missing) = split_missing(parent)?;
    // 根校验只针对**已存在的部分**：不存在的那几段稍后才创建
    if !roots.iter().any(|root| parent_real.starts_with(root)) {
        return Err(format!(
            "{} 不在已登记的工作区目录内（Agent 只能改工作区里的文件）",
            parent.display()
        ));
    }

    let mut dir = parent_real;
    for segment in missing {
        dir.push(segment);
    }
    if !dir.exists() {
        if !create_parents {
            return Err(format!(
                "目录 {} 不存在；需要新建请设置 createParents=true",
                parent.display()
            ));
        }
        fs::create_dir_all(&dir)
            .map_err(|error| format!("创建目录 {} 失败：{error}", dir.display()))?;
    }

    let mut target = dir.join(name);
    if target.exists() {
        target = fs::canonicalize(&target)
            .map_err(|error| format!("无法访问 {}：{error}", target.display()))?;
        if !roots.iter().any(|root| target.starts_with(root)) {
            return Err(format!(
                "{} 解析后不在已登记的工作区目录内（符号链接越界）",
                target.display()
            ));
        }
    }
    if target.is_dir() {
        return Err(format!("{} 是目录，不是文件", target.display()));
    }
    Ok(target)
}

/// 相对路径锂到工作区根。
///
/// `find_roots` 已按 `workspaceID` 过滤，所以只剩一个根时直接用它；多根说明无法
/// 判定该落到哪个仓库，要求调用方传绝对路径（猜错比报错更糟）。
fn anchor_to_root(raw: &str, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if path.is_absolute() {
        return Ok(path);
    }
    match roots {
        [only] => Ok(only.join(path)),
        _ => Err(format!(
            "相对路径 {raw} 匹配到多个工作区目录，无法确定落在哪一个；请改用绝对路径"
        )),
    }
}

/// 把（可能不存在的）目录拆成「已存在的真实路径 + 待创建的分量」。
///
/// 直接 `canonicalize(整条)` 在末端目录不存在时会失败，而先建目录再校验会留下
/// 越界建目录的副作用 —— 所以从最深的已存在祖先开始拆。
fn split_missing(path: &Path) -> Result<(PathBuf, Vec<OsString>), String> {
    let mut missing: Vec<OsString> = Vec::new();
    let mut cursor = path;
    loop {
        if let Ok(real) = fs::canonicalize(cursor) {
            missing.reverse();
            return Ok((real, missing));
        }
        let Some(parent) = cursor.parent() else {
            return Err(format!("无法访问目录 {}：父级路径不存在", path.display()));
        };
        let Some(name) = cursor.file_name() else {
            return Err(format!("无法解析目录 {}", path.display()));
        };
        missing.push(name.to_os_string());
        cursor = parent;
    }
}

/// 写前快照：旧内容落到系统临时目录，返回路径（新文件没有快照）。
fn write_snapshot(target: &Path, previous: Option<&[u8]>) -> Result<Option<String>, String> {
    let Some(bytes) = previous else {
        return Ok(None);
    };
    let dir = std::env::temp_dir().join(SNAPSHOT_DIR);
    fs::create_dir_all(&dir).map_err(|error| format!("创建快照目录失败：{error}"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let stem = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file")
        .replace(['/', '\\', ':'], "_");
    let path = dir.join(format!("{stem}.{stamp}.bak"));
    fs::write(&path, bytes).map_err(|error| format!("写快照失败：{error}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

fn preview(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .chars()
        .take(PREVIEW_CHARS)
        .collect()
}

fn arg_bool(arguments: &Value, key: &str) -> bool {
    arguments.get(key).and_then(Value::as_bool).unwrap_or(false)
}

pub(crate) async fn find_roots(
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
                 (id,\"workspaceID\",path,sort,\"createdAt\",\"updatedAt\") \
                 VALUES ('f1','w1','{}',0,1,1)",
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

    #[tokio::test]
    async fn writes_new_file_and_overwrites_with_snapshot() {
        let fixture = fixture().await;
        let target = fixture.root.join("nested/notes.md");
        let created = write(
            &fixture.db,
            &json!({
                "path": target.to_string_lossy(),
                "content": "第一版",
                "createParents": true
            }),
        )
        .await
        .expect("新文件应可写");
        assert_eq!(created["created"], json!(true));
        assert_eq!(created["snapshotPath"], Value::Null);
        assert_eq!(fs::read_to_string(&target).unwrap(), "第一版");

        let overwritten = write(
            &fixture.db,
            &json!({ "path": target.to_string_lossy(), "content": "第二版" }),
        )
        .await
        .expect("覆盖写应成功");
        assert_eq!(overwritten["created"], json!(false));
        assert_eq!(overwritten["previous"], json!("第一版"));
        let snapshot = overwritten["snapshotPath"]
            .as_str()
            .expect("覆盖写必须留快照");
        assert_eq!(fs::read_to_string(snapshot).unwrap(), "第一版");
        assert_eq!(fs::read_to_string(&target).unwrap(), "第二版");

        fs::remove_dir_all(&fixture.base).ok();
        fs::remove_file(snapshot).ok();
    }

    #[tokio::test]
    async fn write_outside_workspace_is_rejected() {
        let fixture = fixture().await;
        let error = write(
            &fixture.db,
            &json!({
                "path": fixture.outside.join("b.md").to_string_lossy(),
                "content": "越界"
            }),
        )
        .await
        .expect_err("白名单外必须拒绝");
        assert!(error.contains("不在已登记的工作区目录内"), "{error}");
        assert_eq!(
            fs::read_to_string(fixture.outside.join("b.md")).unwrap(),
            "白名单之外"
        );

        fs::remove_dir_all(&fixture.base).ok();
    }

    #[tokio::test]
    async fn git_metadata_is_permanently_locked() {
        let fixture = fixture().await;
        fs::create_dir_all(fixture.root.join(".git/hooks")).expect("git dir");
        let error = write(
            &fixture.db,
            &json!({
                "path": fixture.root.join(".git/hooks/pre-commit").to_string_lossy(),
                "content": "#!/bin/sh\necho pwned",
                "confirm": true
            }),
        )
        .await
        .expect_err(".git 必须永久拒绝");
        assert!(error.contains(".git"), "{error}");
        assert!(!fixture.root.join(".git/hooks/pre-commit").exists());

        fs::remove_dir_all(&fixture.base).ok();
    }

    #[tokio::test]
    async fn protected_file_needs_confirmation() {
        let fixture = fixture().await;
        let target = fixture.root.join(".env");
        let error = write(
            &fixture.db,
            &json!({ "path": target.to_string_lossy(), "content": "SECRET=1" }),
        )
        .await
        .expect_err("受保护文件必须先确认");
        assert!(error.contains("受保护文件"), "{error}");
        assert!(!target.exists());

        write(
            &fixture.db,
            &json!({
                "path": target.to_string_lossy(),
                "content": "SECRET=1",
                "confirm": true
            }),
        )
        .await
        .expect("用户确认后应可写");
        assert_eq!(fs::read_to_string(&target).unwrap(), "SECRET=1");

        fs::remove_dir_all(&fixture.base).ok();
    }

    #[tokio::test]
    async fn patch_applies_edits_and_keeps_snapshot() {
        let fixture = fixture().await;
        let target = fixture.root.join("a.md");
        let value = patch(
            &fixture.db,
            &json!({
                "path": target.to_string_lossy(),
                "edits": [{ "oldText": "工作区内的文件", "newText": "改过的文件" }]
            }),
        )
        .await
        .expect("定点替换应成功");
        assert_eq!(value["applied"], json!(1));
        assert_eq!(fs::read_to_string(&target).unwrap(), "# 改过的文件");
        let snapshot = value["snapshotPath"].as_str().expect("必须留快照");
        assert_eq!(fs::read_to_string(snapshot).unwrap(), "# 工作区内的文件");

        fs::remove_dir_all(&fixture.base).ok();
        fs::remove_file(snapshot).ok();
    }

    #[tokio::test]
    async fn patch_without_match_changes_nothing() {
        let fixture = fixture().await;
        let target = fixture.root.join("a.md");
        let error = patch(
            &fixture.db,
            &json!({
                "path": target.to_string_lossy(),
                "edits": [{ "oldText": "不存在的文本", "newText": "x" }]
            }),
        )
        .await
        .expect_err("没命中必须报错");
        assert!(error.contains("没找到 oldText"), "{error}");
        assert_eq!(fs::read_to_string(&target).unwrap(), "# 工作区内的文件");

        fs::remove_dir_all(&fixture.base).ok();
    }

    #[test]
    fn guard_classifies_paths() {
        assert_eq!(
            guard_for(Path::new("C:/repo/.git/config")),
            WriteGuard::Locked
        );
        assert_eq!(guard_for(Path::new("C:/repo/.env")), WriteGuard::Confirm);
        assert_eq!(
            guard_for(Path::new("C:/repo/.env.local")),
            WriteGuard::Confirm
        );
        assert_eq!(
            guard_for(Path::new("C:/repo/cert.pem")),
            WriteGuard::Confirm
        );
        assert_eq!(guard_for(Path::new("C:/repo/id_rsa")), WriteGuard::Confirm);
        assert_eq!(
            guard_for(Path::new("C:/repo/src/main.rs")),
            WriteGuard::Allow
        );
        assert_eq!(
            guard_for(Path::new("C:/repo/.github/workflow.yml")),
            WriteGuard::Allow
        );
    }

    /// 越界写入**不得**先建目录：目录是副作用，写失败也得当没发生
    #[tokio::test]
    async fn write_outside_workspace_creates_no_directories() {
        let fixture = fixture().await;
        let nested = fixture.outside.join("nested/deep");
        let error = write(
            &fixture.db,
            &json!({
                "path": nested.join("x.md").to_string_lossy(),
                "content": "越界",
                "createParents": true
            }),
        )
        .await
        .expect_err("白名单外必须拒绝");
        assert!(error.contains("不在已登记的工作区目录内"), "{error}");
        assert!(
            !fixture.outside.join("nested").exists(),
            "越界路径不得被创建"
        );

        fs::remove_dir_all(&fixture.base).ok();
    }

    /// 相对路径按工作区根解析，不跟着进程 cwd 跑
    #[tokio::test]
    async fn relative_write_lands_in_workspace_root() {
        let fixture = fixture().await;
        let value = write(
            &fixture.db,
            &json!({ "path": "relative.md", "content": "相对路径" }),
        )
        .await
        .expect("单根时相对路径应锂到工作区根");
        assert_eq!(value["created"], json!(true));
        assert_eq!(
            fs::read_to_string(fixture.root.join("relative.md")).unwrap(),
            "相对路径"
        );

        fs::remove_dir_all(&fixture.base).ok();
    }

    #[test]
    fn anchors_relative_path_to_the_only_root() {
        let root = std::env::temp_dir();
        assert_eq!(
            anchor_to_root("src/a.ts", std::slice::from_ref(&root)).unwrap(),
            root.join("src/a.ts")
        );
        // 绝对路径原样返回
        let absolute = std::env::temp_dir().join("a.ts");
        assert_eq!(
            anchor_to_root(&absolute.to_string_lossy(), std::slice::from_ref(&root)).unwrap(),
            absolute
        );
        // 多根时不猜
        let error = anchor_to_root("a.ts", &[root.clone(), root]).expect_err("多根必须报错");
        assert!(error.contains("多个工作区目录"), "{error}");
    }

    #[test]
    fn split_missing_keeps_created_suffix_in_order() {
        let base = std::env::temp_dir().join(format!("cogito-split-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&base).expect("base dir");
        let (real, missing) = split_missing(&base.join("a/b/c")).expect("split");
        assert_eq!(real, fs::canonicalize(&base).expect("canonical"));
        assert_eq!(
            missing,
            vec![
                OsString::from("a"),
                OsString::from("b"),
                OsString::from("c")
            ]
        );
        fs::remove_dir_all(&base).ok();
    }

    /// 目标模式（无人值守）：受保护文件放行，且回执里写明这次是豁免
    #[tokio::test]
    async fn unattended_may_write_protected_file_and_reports_guard() {
        let fixture = fixture().await;
        let target = fixture.root.join(".env");
        let value = write(
            &fixture.db,
            &json!({
                "path": target.to_string_lossy(),
                "content": "SECRET=1",
                "__unattended": true
            }),
        )
        .await
        .expect("无人值守应放行受保护文件");
        assert_eq!(value["guard"], json!("unattended"));
        assert_eq!(fs::read_to_string(&target).unwrap(), "SECRET=1");

        fs::remove_dir_all(&fixture.base).ok();
    }

    /// `.git` 不享受无人值守豁免：永久拒绝
    #[tokio::test]
    async fn unattended_does_not_unlock_git_metadata() {
        let fixture = fixture().await;
        fs::create_dir_all(fixture.root.join(".git/hooks")).expect("git dir");
        let error = write(
            &fixture.db,
            &json!({
                "path": fixture.root.join(".git/hooks/pre-commit").to_string_lossy(),
                "content": "x",
                "__unattended": true
            }),
        )
        .await
        .expect_err(".git 必须永远拒绝");
        assert!(error.contains(".git"), "{error}");

        fs::remove_dir_all(&fixture.base).ok();
    }
}
