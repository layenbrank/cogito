//! 批量重命名：**真实改文件名**（不是只改库里的显示名）。
//!
//! 这是图库风险最高的一条链路，所以拆成两步、强制 dry-run：
//!
//! ```text
//! media:rename-plan   ids + 模板 → { rows(旧名→新名), conflicts, skipped }
//! media:rename-apply  确认后的 rows        → 逐条 rename + 迁移日志 + 失败回滚
//! ```
//!
//! 四条硬约束：
//!
//! 1. **不跨目录**。新名只换文件名，目录始终取源文件所在目录；跨盘/跨目录移动是另一个功能。
//! 2. **冲突即整批拒绝**。预览里有任何一条冲突，`apply` 一条都不动 —— 半批量改名最难对账。
//! 3. **先写日志再改名**。`<cache>/rename-journal/rename-<ts>.jsonl` 逐条记 intent / done，
//!    中途崩溃可以按日志人工对账（自动恢复留给下一次启动的扫描器）。
//! 4. **只动导入来源**。`source === "capture"` 或 `isManaged === true` 的资产直接拒绝，
//!    避免打断截图 / 录屏的保留策略。
//!
//! 边车（`.xmp` / `.aae`）跟着主文件改名；边车目标已存在时跳过边车、只记 warning，
//! 不因为它整批失败。

use std::collections::{HashMap, HashSet};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{Local, TimeZone};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use cogito_database::Storage;
use cogito_database::entity::asset;

const DEFAULT_TEMPLATE: &str = "{date}_{place}_{seq}";
const SIDECAR_EXTS: [&str; 2] = ["xmp", "aae"];
/// Windows 设备名：即便带扩展名也不能用。
const RESERVED_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];
const MAX_NAME_BYTES: usize = 180;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanArgs {
    pub ids: Vec<String>,
    /// 支持 `{date}` `{place}` `{seq}` `{name}`；缺省 `{date}_{place}_{seq}`
    pub template: Option<String>,
    /// 地点；缺省取 `metadata.keywords.places[0]`
    pub place: Option<String>,
    /// 起始序号（默认 1，至少 3 位补零）
    pub start: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanRow {
    pub id: String,
    pub from_path: String,
    pub from_name: String,
    pub to_name: String,
    pub to_path: String,
    pub captured_at: i64,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    pub id: String,
    /// `managed` / `source-missing` / `invalid-name` / `target-exists` / `duplicate-target` / `locked`
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanResult {
    pub rows: Vec<PlanRow>,
    pub conflicts: Vec<Conflict>,
    /// 名字没变化、无需改动的 id
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyArgs {
    pub rows: Vec<ApplyRow>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRow {
    pub id: String,
    pub to_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub renamed: Vec<String>,
    pub sidecars: usize,
    pub journal_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoArgs {
    /// `media:rename-apply` 返回的迁移日志路径
    pub journal_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoResult {
    pub restored: Vec<String>,
    pub journal_path: String,
}

/// 预览的输入行：与数据库解耦，便于单测。
#[derive(Debug, Clone)]
struct PlanInput {
    id: String,
    file_path: String,
    file_name: String,
    captured_at: i64,
    managed: bool,
    place_hint: Option<String>,
}

fn meta_value(raw: &Option<String>) -> serde_json::Value {
    raw.as_deref()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
        .unwrap_or(serde_json::Value::Null)
}

fn is_managed(meta: &serde_json::Value) -> bool {
    if meta.get("isManaged").and_then(serde_json::Value::as_bool) == Some(true) {
        return true;
    }
    meta.get("source").and_then(serde_json::Value::as_str) == Some("capture")
}

fn place_hint(meta: &serde_json::Value) -> Option<String> {
    meta.pointer("/keywords/places/0")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
}

fn format_date(ms: i64) -> String {
    Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|date| date.format("%Y%m%d").to_string())
        .unwrap_or_else(|| "00000000".to_string())
}

/// 文件名里不能出现的字符统一换 `_`，再折叠连续下划线。
fn sanitize_component(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        let bad =
            ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*');
        out.push(if bad { '_' } else { ch });
    }
    let mut collapsed = String::with_capacity(out.len());
    let mut last_underscore = false;
    for ch in out.chars() {
        if ch == '_' {
            if last_underscore {
                continue;
            }
            last_underscore = true;
        } else {
            last_underscore = false;
        }
        collapsed.push(ch);
    }
    let collapsed = collapsed.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed
        .trim_matches(|ch: char| ch == '_' || ch.is_whitespace())
        .trim_matches('.')
        .to_string()
}

fn is_reserved_name(name: &str) -> bool {
    let stem = Path::new(name)
        .file_stem()
        .map(|value| value.to_string_lossy().to_uppercase())
        .unwrap_or_default();
    RESERVED_NAMES.contains(&stem.as_str())
}

fn render_template(template: &str, date: &str, place: &str, seq: &str, stem: &str) -> String {
    let mut out = template
        .replace("{date}", date)
        .replace("{place}", place)
        .replace("{seq}", seq)
        .replace("{name}", stem);
    // 模板里 {place} 为空会留下双下划线 / 前后下划线
    while out.contains("__") {
        out = out.replace("__", "_");
    }
    out.trim_matches('_').to_string()
}

fn sequence_width(start: u32, count: usize) -> usize {
    let last = start.saturating_add(count.saturating_sub(1) as u32);
    last.to_string().len().max(3)
}

fn is_locked(path: &Path) -> bool {
    // 只开写句柄、不截断：能开说明没被独占 / 只读
    std::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .map(|handle| {
            drop(handle);
            false
        })
        .unwrap_or(true)
}

fn target_exists(target: &Path, source: &Path) -> bool {
    if !target.exists() {
        return false;
    }
    // 大小写不敏感（Windows / macOS 常见）：同一个文件不算冲突
    let same = |a: &Path, b: &Path| {
        a.to_string_lossy()
            .eq_ignore_ascii_case(&b.to_string_lossy())
    };
    !same(target, source)
}

fn validate_new_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("新文件名为空".into());
    }
    if name.len() > MAX_NAME_BYTES {
        return Err(format!(
            "新文件名过长（{} 字节，上限 {MAX_NAME_BYTES}）",
            name.len()
        ));
    }
    if name.contains('/') || name.contains('\\') {
        return Err("新文件名不能包含路径分隔符".into());
    }
    if name == "." || name == ".." {
        return Err("新文件名不能是 . 或 ..".into());
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return Err("Windows 不允许文件名以点或空格结尾".into());
    }
    if is_reserved_name(name) {
        return Err(format!("{name} 是 Windows 保留设备名"));
    }
    Ok(())
}

/// 纯函数：排序 → 命名 → 冲突检测。目录恒定取源目录。
fn build_plan(mut inputs: Vec<PlanInput>, args: &PlanArgs) -> PlanResult {
    inputs.retain(|input| !input.id.is_empty());
    inputs.sort_by(|a, b| {
        a.captured_at
            .cmp(&b.captured_at)
            .then_with(|| a.file_name.cmp(&b.file_name))
            .then_with(|| a.id.cmp(&b.id))
    });

    let template = args
        .template
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_TEMPLATE);
    let start = args.start.unwrap_or(1).max(1);
    let width = sequence_width(start, inputs.len());

    let mut rows: Vec<PlanRow> = Vec::new();
    let mut conflicts: Vec<Conflict> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    let mut seen_targets: HashSet<String> = HashSet::new();
    let mut valid_index: u32 = 0;

    for input in inputs {
        if input.managed {
            conflicts.push(Conflict {
                id: input.id,
                code: "managed".into(),
                message: "截图 / 录屏资产由保留策略管理，不参与批量重命名".into(),
            });
            continue;
        }

        let source = PathBuf::from(&input.file_path);
        if !source.is_file() {
            conflicts.push(Conflict {
                id: input.id,
                code: "source-missing".into(),
                message: format!("源文件不存在：{}", input.file_path),
            });
            continue;
        }

        let stem = source
            .file_stem()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| input.file_name.clone());
        let extension = source
            .extension()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default();

        let sequence = start.saturating_add(valid_index);
        let seq = format!("{sequence:0width$}");
        let place_raw = args
            .place
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or(input.place_hint)
            .unwrap_or_default();
        let place = sanitize_component(&place_raw);
        let date = format_date(input.captured_at);

        let base = sanitize_component(&render_template(template, &date, &place, &seq, &stem));
        let to_name = if extension.is_empty() {
            base.clone()
        } else {
            format!("{base}.{extension}")
        };

        if let Err(message) = validate_new_name(&to_name) {
            conflicts.push(Conflict {
                id: input.id,
                code: "invalid-name".into(),
                message,
            });
            continue;
        }

        if to_name == input.file_name {
            skipped.push(input.id);
            continue;
        }

        let target = source.with_file_name(&to_name);
        if target_exists(&target, &source) {
            conflicts.push(Conflict {
                id: input.id,
                code: "target-exists".into(),
                message: format!("目标文件已存在：{}", target.display()),
            });
            continue;
        }

        let target_key = target.to_string_lossy().to_lowercase();
        if !seen_targets.insert(target_key) {
            conflicts.push(Conflict {
                id: input.id,
                code: "duplicate-target".into(),
                message: format!("同一批次里有两项要改成同一个名字：{to_name}"),
            });
            continue;
        }

        if is_locked(&source) {
            conflicts.push(Conflict {
                id: input.id,
                code: "locked".into(),
                message: format!("文件只读或被其它程序占用：{}", input.file_name),
            });
            continue;
        }

        let mut warnings = Vec::new();
        for ext in SIDECAR_EXTS {
            let sidecar = source.with_extension(ext);
            if sidecar.is_file() && target.with_extension(ext).exists() {
                warnings.push(format!("边车 .{ext} 的目标已存在，将保持原名"));
            }
        }

        rows.push(PlanRow {
            id: input.id,
            from_path: input.file_path,
            from_name: input.file_name,
            to_name,
            to_path: target.to_string_lossy().into_owned(),
            captured_at: input.captured_at,
            warnings,
        });
        valid_index = valid_index.saturating_add(1);
    }

    PlanResult {
        rows,
        conflicts,
        skipped,
    }
}

fn to_plan_inputs(models: Vec<asset::Model>) -> Vec<PlanInput> {
    models
        .into_iter()
        .map(|model| {
            let meta = meta_value(&model.metadata);
            PlanInput {
                id: model.id,
                file_path: model.file_path,
                file_name: model.file_name,
                captured_at: meta
                    .get("capturedAt")
                    .and_then(serde_json::Value::as_i64)
                    .unwrap_or(model.created_at),
                managed: is_managed(&meta),
                place_hint: place_hint(&meta),
            }
        })
        .collect()
}

async fn load_assets(storage: &Storage, ids: &[String]) -> Result<Vec<asset::Model>, String> {
    let unique: Vec<String> = ids
        .iter()
        .filter(|id| !id.trim().is_empty())
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if unique.is_empty() {
        return Ok(Vec::new());
    }
    asset::Entity::find()
        .filter(asset::Column::Id.is_in(unique))
        .all(storage.connection())
        .await
        .map_err(|error| format!("读取资产失败：{error}"))
}

#[tauri::command(rename = "media:rename-plan")]
pub async fn media_rename_plan(
    state: State<'_, Storage>,
    args: PlanArgs,
) -> Result<PlanResult, String> {
    let models = load_assets(&state, &args.ids).await?;
    Ok(build_plan(to_plan_inputs(models), &args))
}

fn journal_path(app: &AppHandle, prefix: &str) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法解析缓存目录：{error}"))?
        .join("rename-journal");
    std::fs::create_dir_all(&root).map_err(|error| format!("创建改名日志目录失败：{error}"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    Ok(root.join(format!("{prefix}-{stamp}.jsonl")))
}

fn append_journal(file: &mut std::fs::File, payload: serde_json::Value) {
    if let Ok(line) = serde_json::to_string(&payload) {
        let _ = writeln!(file, "{line}");
        let _ = file.flush();
    }
}

fn sidecar_paths(source: &Path, target: &Path) -> Vec<(PathBuf, PathBuf)> {
    let mut out = Vec::new();
    for ext in SIDECAR_EXTS {
        let from = source.with_extension(ext);
        if !from.is_file() {
            continue;
        }
        let to = target.with_extension(ext);
        if to.exists() {
            continue;
        }
        out.push((from, to));
    }
    out
}

/// 一条落盘任务。文件层不需要整行 `asset`，只要一个旧名用于报错。
struct RenameTask {
    id: String,
    display_name: String,
    source: PathBuf,
    to_name: String,
    target: PathBuf,
}

/// 文件层：逐条改名并写 journal（intent → rename → done + 边车跟随）。
///
/// 任一条 rename 失败 → 把**已经改过的**逆序回滚（并写 rollback 行），再把错误抛给调用方：
/// 宁可整批退回原样，也不留半批量改名。
fn rename_files(
    journal: &mut std::fs::File,
    tasks: &[RenameTask],
) -> Result<(Vec<(String, PathBuf, PathBuf)>, usize), String> {
    let mut renamed: Vec<(String, PathBuf, PathBuf)> = Vec::new();
    let mut sidecars = 0usize;

    for task in tasks {
        append_journal(
            journal,
            serde_json::json!({
                "op": "intent",
                "id": task.id,
                "from": task.source.to_string_lossy(),
                "to": task.target.to_string_lossy(),
            }),
        );
        if let Err(error) = std::fs::rename(&task.source, &task.target) {
            rollback_files(journal, &renamed);
            return Err(format!(
                "改名失败（{} → {}）：{error}",
                task.display_name, task.to_name
            ));
        }
        for (from, to) in sidecar_paths(&task.source, &task.target) {
            if std::fs::rename(&from, &to).is_ok() {
                sidecars += 1;
            }
        }
        append_journal(
            journal,
            serde_json::json!({
                "op": "done",
                "id": task.id,
                "to": task.target.to_string_lossy(),
            }),
        );
        renamed.push((task.id.clone(), task.source.clone(), task.target.clone()));
    }

    Ok((renamed, sidecars))
}

/// 真正落盘。任何一条校验失败 → 整批不动（返回 Err，前端展示原因）。
#[tauri::command(rename = "media:rename-apply")]
pub async fn media_rename_apply(
    app: AppHandle,
    state: State<'_, Storage>,
    args: ApplyArgs,
) -> Result<ApplyResult, String> {
    if args.rows.is_empty() {
        return Err("没有可执行的改名项".into());
    }
    let ids: Vec<String> = args.rows.iter().map(|row| row.id.clone()).collect();
    let models = load_assets(&state, &ids).await?;
    let by_id: HashMap<String, asset::Model> = models
        .into_iter()
        .map(|model| (model.id.clone(), model))
        .collect();

    // —— 1. 全量校验（先算完，任何一条失败都不落盘）——
    let mut seen: HashSet<String> = HashSet::new();
    let mut tasks: Vec<RenameTask> = Vec::new();
    for row in &args.rows {
        let Some(model) = by_id.get(&row.id) else {
            return Err(format!("资产不存在：{}", row.id));
        };
        if is_managed(&meta_value(&model.metadata)) {
            return Err(format!(
                "{} 是截图 / 录屏资产，不参与重命名",
                model.file_name
            ));
        }
        validate_new_name(&row.to_name)?;
        let source = PathBuf::from(&model.file_path);
        if !source.is_file() {
            return Err(format!("源文件不存在：{}", model.file_path));
        }
        let target = source.with_file_name(&row.to_name);
        if target_exists(&target, &source) {
            return Err(format!("目标文件已存在：{}", target.display()));
        }
        let key = target.to_string_lossy().to_lowercase();
        if !seen.insert(key) {
            return Err(format!("同一批次里有两项要改成同一个名字：{}", row.to_name));
        }
        if is_locked(&source) {
            return Err(format!("文件只读或被占用：{}", model.file_name));
        }
        tasks.push(RenameTask {
            id: model.id.clone(),
            display_name: model.file_name.clone(),
            source,
            to_name: row.to_name.clone(),
            target,
        });
    }

    // —— 2. 逐条改名（先写 intent，再 rename，再写 done）——
    let journal = journal_path(&app, "rename")?;
    let mut journal_file =
        std::fs::File::create(&journal).map_err(|error| format!("创建改名日志失败：{error}"))?;
    let (renamed, sidecars) = rename_files(&mut journal_file, &tasks)?;

    // —— 3. 同步 asset 行（文件是真相，库只是索引）——
    let now = chrono::Utc::now().timestamp_millis();
    let mut updated: Vec<(String, String, String)> = Vec::new();
    for (id, _source, target) in &renamed {
        let Some(model) = by_id.get(id) else { continue };
        let mut active: asset::ActiveModel = model.clone().into();
        active.file_path = Set(target.to_string_lossy().into_owned());
        active.file_name = Set(target
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| model.file_name.clone()));
        active.updated_at = Set(now);
        if let Err(error) = active.update(state.connection()).await {
            // 库写失败：把已经写过的库行还原，再把文件改回去 —— 不让「文件已改、库里还是旧路径」
            for (updated_id, old_path, old_name) in &updated {
                if let Some(previous) = by_id.get(updated_id) {
                    let mut revert: asset::ActiveModel = previous.clone().into();
                    revert.file_path = Set(old_path.clone());
                    revert.file_name = Set(old_name.clone());
                    revert.updated_at = Set(now);
                    let _ = revert.update(state.connection()).await;
                }
            }
            rollback_files(&mut journal_file, &renamed);
            return Err(format!("写入数据库失败，已回滚文件改名：{error}"));
        }
        updated.push((id.clone(), model.file_path.clone(), model.file_name.clone()));
    }

    Ok(ApplyResult {
        renamed: renamed.into_iter().map(|(id, _, _)| id).collect(),
        sidecars,
        journal_path: journal.to_string_lossy().into_owned(),
    })
}

/// 从迁移日志还原「这批到底改了哪几条」，方向反过来（当前名 → 原名）。
///
/// 只认「既有 intent 又有 done」的条目：崩溃在 intent 与 done 之间的那一条要人工看，
/// 这里不猜。返回顺序与日志一致，调用方负责逆序执行。
fn undo_tasks(raw: &str) -> Vec<RenameTask> {
    let mut order: Vec<(String, PathBuf, PathBuf)> = Vec::new();
    let mut done: HashSet<String> = HashSet::new();
    for line in raw.lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let id = value.get("id").and_then(|v| v.as_str()).unwrap_or_default();
        match value.get("op").and_then(|v| v.as_str()).unwrap_or_default() {
            "intent" => {
                let from = value
                    .get("from")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let to = value.get("to").and_then(|v| v.as_str()).unwrap_or_default();
                if id.is_empty() || from.is_empty() || to.is_empty() {
                    continue;
                }
                order.push((id.to_string(), PathBuf::from(to), PathBuf::from(from)));
            }
            "done" => {
                done.insert(id.to_string());
            }
            _ => {}
        }
    }
    order
        .into_iter()
        .filter(|(id, _, _)| done.contains(id))
        .map(|(id, current, original)| {
            let display_name = current
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_default();
            let to_name = original
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_default();
            RenameTask {
                id,
                display_name,
                source: current,
                to_name,
                target: original,
            }
        })
        .collect()
}

/// 撤销一次批量改名：按迁移日志反向操作，前置校验不通过就整批不动。
///
/// 之所以要求「当前文件仍在日志记的新名上」，是因为撤销的前提是`文件没被别人动过`；
/// 有任何一条对不上就整批拒绝，让用户先看清楚，而不是把文件改成一团乱。
#[tauri::command(rename = "media:rename-undo")]
pub async fn media_rename_undo(
    app: AppHandle,
    state: State<'_, Storage>,
    args: UndoArgs,
) -> Result<UndoResult, String> {
    let raw = std::fs::read_to_string(&args.journal_path)
        .map_err(|error| format!("读不到迁移日志：{error}"))?;
    let mut tasks = undo_tasks(&raw);
    if tasks.is_empty() {
        return Err("迁移日志里没有可撤销的改名记录（可能已撤销过）".into());
    }
    // 逆序撤销：最后改的先退回，避免中间名互相占用
    tasks.reverse();

    for task in &tasks {
        if !task.source.is_file() {
            return Err(format!(
                "文件已不在：{}（可能被移动、再次改名或删除）",
                task.source.display()
            ));
        }
        if task.target.exists() {
            return Err(format!("原名位置已被占用：{}", task.target.display()));
        }
        if is_locked(&task.source) {
            return Err(format!("文件只读或被占用：{}", task.display_name));
        }
    }

    let journal = journal_path(&app, "rename-undo")?;
    let mut journal_file =
        std::fs::File::create(&journal).map_err(|error| format!("创建撤销日志失败：{error}"))?;
    let (restored, _sidecars) = rename_files(&mut journal_file, &tasks)?;

    // 文件是真相，库只是索引：把行也退回去（失败则先把文件改回，再报错）
    let ids: Vec<String> = restored.iter().map(|(id, _, _)| id.clone()).collect();
    let models = load_assets(&state, &ids).await?;
    let by_id: HashMap<String, asset::Model> = models
        .into_iter()
        .map(|model| (model.id.clone(), model))
        .collect();

    let now = chrono::Utc::now().timestamp_millis();
    let mut updated: Vec<(String, String, String)> = Vec::new();
    for (id, _current, original) in &restored {
        let Some(model) = by_id.get(id) else { continue };
        let mut active: asset::ActiveModel = model.clone().into();
        active.file_path = Set(original.to_string_lossy().into_owned());
        active.file_name = Set(original
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| model.file_name.clone()));
        active.updated_at = Set(now);
        if let Err(error) = active.update(state.connection()).await {
            for (updated_id, old_path, old_name) in &updated {
                if let Some(previous) = by_id.get(updated_id) {
                    let mut revert: asset::ActiveModel = previous.clone().into();
                    revert.file_path = Set(old_path.clone());
                    revert.file_name = Set(old_name.clone());
                    revert.updated_at = Set(now);
                    let _ = revert.update(state.connection()).await;
                }
            }
            rollback_files(&mut journal_file, &restored);
            return Err(format!("写入数据库失败，已把文件改回原名：{error}"));
        }
        updated.push((id.clone(), model.file_path.clone(), model.file_name.clone()));
    }

    Ok(UndoResult {
        restored: restored.into_iter().map(|(id, _, _)| id).collect(),
        journal_path: journal.to_string_lossy().into_owned(),
    })
}

/// 逆序改回；逐步写日志，失败也留下痕迹。
fn rollback_files(journal: &mut std::fs::File, renamed: &[(String, PathBuf, PathBuf)]) {
    for (id, from, to) in renamed.iter().rev() {
        if std::fs::rename(to, from).is_ok() {
            append_journal(
                journal,
                serde_json::json!({
                    "op": "rollback",
                    "id": id,
                    "from": to.to_string_lossy(),
                    "to": from.to_string_lossy(),
                }),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn base() -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("cogito-rename-{stamp}"));
        fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    /// 建一个真实文件再返回输入行：`build_plan` 会检查源文件是否存在。
    fn input(dir: &Path, id: &str, name: &str, captured_at: i64) -> PlanInput {
        let path = dir.join(name);
        if !path.exists() {
            fs::write(&path, b"x").expect("write source");
        }
        PlanInput {
            id: id.into(),
            file_path: path.to_string_lossy().into_owned(),
            file_name: name.into(),
            captured_at,
            managed: false,
            place_hint: None,
        }
    }

    fn args() -> PlanArgs {
        PlanArgs {
            ids: vec![],
            template: None,
            place: Some("故宫".into()),
            start: None,
        }
    }

    #[test]
    fn sanitizes_forbidden_characters() {
        assert_eq!(sanitize_component("2026:11/23  故宫*"), "2026_11_23 故宫");
        assert_eq!(sanitize_component("__京都__2026__"), "京都_2026");
        assert_eq!(sanitize_component("..."), "");
    }

    #[test]
    fn renders_template_and_collapses_empty_place() {
        assert_eq!(
            render_template("{date}_{place}_{seq}", "20261123", "", "001", "IMG_1"),
            "20261123_001"
        );
        assert_eq!(
            render_template("{date}_{place}_{seq}", "20261123", "京都", "001", "IMG_1"),
            "20261123_京都_001"
        );
        assert_eq!(
            render_template("{name}_{seq}", "20261123", "", "001", "IMG_1"),
            "IMG_1_001"
        );
    }

    #[test]
    fn sequences_are_stable_and_padded() {
        let dir = base();
        let result = build_plan(
            vec![
                input(&dir, "b", "b.jpg", 200),
                input(&dir, "a", "a.jpg", 100),
            ],
            &args(),
        );
        assert!(result.conflicts.is_empty(), "{:?}", result.conflicts);
        let date = format_date(100);
        assert_eq!(result.rows[0].to_name, format!("{date}_故宫_001.jpg"));
        assert_eq!(result.rows[1].to_name, format!("{date}_故宫_002.jpg"));
        // 序号跟着「拍摄时间」走，而不是入参顺序
        assert_eq!(result.rows[0].id, "a");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rejects_managed_reserved_and_duplicates() {
        let dir = base();
        let mut managed = input(&dir, "m", "shot.png", 100);
        managed.managed = true;
        let result = build_plan(vec![managed], &args());
        assert_eq!(result.conflicts[0].code, "managed");

        let result = build_plan(
            vec![
                input(&dir, "a", "a.jpg", 100),
                input(&dir, "b", "b.jpg", 100),
            ],
            &PlanArgs {
                ids: vec![],
                template: Some("same".into()),
                place: None,
                start: None,
            },
        );
        let codes: Vec<&str> = result.conflicts.iter().map(|c| c.code.as_str()).collect();
        assert!(codes.contains(&"duplicate-target"), "{codes:?}");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn skips_when_name_unchanged() {
        // 模板结果与原名一致 → 记入 skipped，不产生 rename 行
        let dir = base();
        let name = format!("{}_001.jpg", format_date(100));
        let result = build_plan(
            vec![input(&dir, "a", &name, 100)],
            &PlanArgs {
                ids: vec![],
                template: Some("{date}_{seq}".into()),
                place: None,
                start: Some(1),
            },
        );
        assert!(result.rows.is_empty(), "{:?}", result.rows);
        assert_eq!(result.skipped, vec!["a".to_string()]);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn finds_sidecars_that_should_follow() {
        let dir = base();
        let source = dir.join("IMG_0001.jpg");
        fs::write(&source, b"x").expect("write");
        fs::write(dir.join("IMG_0001.xmp"), b"x").expect("write xmp");

        let target = dir.join("20260101_故宫_001.jpg");
        let pairs = sidecar_paths(&source, &target);
        assert_eq!(pairs.len(), 1, "{pairs:?}");
        assert!(
            pairs[0].1.ends_with("20260101_故宫_001.xmp"),
            "{:?}",
            pairs[0].1
        );

        // 目标边车已存在时不跟着改（避免覆盖）
        fs::write(dir.join("conflict.xmp"), b"y").expect("write conflict");
        let pairs = sidecar_paths(&source, &dir.join("conflict.jpg"));
        assert!(pairs.is_empty(), "{pairs:?}");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rejects_path_separator_in_new_name() {
        assert!(validate_new_name("../escape.jpg").is_err());
        assert!(validate_new_name("dir/file.jpg").is_err());
        assert!(validate_new_name("CON").is_err());
        assert!(validate_new_name("ok.jpg").is_ok());
    }

    fn task(dir: &Path, id: &str, from: &str, to: &str) -> RenameTask {
        RenameTask {
            id: id.into(),
            display_name: from.into(),
            source: dir.join(from),
            to_name: to.into(),
            target: dir.join(to),
        }
    }

    #[test]
    fn renames_files_and_writes_journal() {
        let dir = base();
        fs::write(dir.join("IMG_1.jpg"), b"one").expect("write");
        fs::write(dir.join("IMG_1.xmp"), b"side").expect("write sidecar");
        let journal_path = dir.join("journal.jsonl");
        let mut journal = fs::File::create(&journal_path).expect("journal");

        let (renamed, sidecars) = rename_files(
            &mut journal,
            &[task(&dir, "a", "IMG_1.jpg", "20260101_京都_001.jpg")],
        )
        .expect("rename");

        assert_eq!(renamed.len(), 1);
        assert_eq!(sidecars, 1);
        assert!(dir.join("20260101_京都_001.jpg").is_file());
        assert!(dir.join("20260101_京都_001.xmp").is_file());
        assert!(!dir.join("IMG_1.jpg").exists());

        let log = fs::read_to_string(&journal_path).expect("read journal");
        assert!(log.contains("\"op\":\"intent\""), "{log}");
        assert!(log.contains("\"op\":\"done\""), "{log}");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rolls_back_earlier_renames_when_one_fails() {
        let dir = base();
        fs::write(dir.join("a.jpg"), b"a").expect("write");
        let journal_path = dir.join("journal.jsonl");
        let mut journal = fs::File::create(&journal_path).expect("journal");
        // 第二条源文件不存在 → rename 失败 → 第一条必须被逆序改回
        let tasks = vec![
            task(&dir, "a", "a.jpg", "a2.jpg"),
            task(&dir, "b", "missing.jpg", "b2.jpg"),
        ];

        let error = rename_files(&mut journal, &tasks).expect_err("should fail");
        assert!(error.contains("改名失败"), "{error}");
        assert!(dir.join("a.jpg").is_file());
        assert!(!dir.join("a2.jpg").exists());
        let log = fs::read_to_string(&journal_path).expect("read journal");
        assert!(log.contains("\"op\":\"rollback\""), "{log}");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn undo_only_reverses_entries_that_finished() {
        // b 只有 intent 没有 done（崩溃现场）→ 撤销时不能碰它，留给人工对账
        let raw = [
            serde_json::json!({"op": "intent", "id": "a", "from": "x/A.jpg", "to": "x/new.jpg"})
                .to_string(),
            serde_json::json!({"op": "done", "id": "a", "to": "x/new.jpg"}).to_string(),
            serde_json::json!({"op": "intent", "id": "b", "from": "x/B.jpg", "to": "x/newb.jpg"})
                .to_string(),
        ]
        .join("\n");

        let tasks = undo_tasks(&raw);
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "a");
        assert_eq!(tasks[0].source, PathBuf::from("x/new.jpg"));
        assert_eq!(tasks[0].target, PathBuf::from("x/A.jpg"));
        assert_eq!(tasks[0].to_name, "A.jpg");
    }

    #[test]
    fn undo_moves_files_back_with_sidecars() {
        let dir = base();
        let original = dir.join("IMG_1.jpg");
        let renamed = dir.join("20260101_京都_001.jpg");
        fs::write(&renamed, b"x").expect("write renamed");
        fs::write(dir.join("20260101_京都_001.xmp"), b"x").expect("write sidecar");
        let raw = [
            serde_json::json!({"op": "intent", "id": "a", "from": original.to_string_lossy(), "to": renamed.to_string_lossy()})
                .to_string(),
            serde_json::json!({"op": "done", "id": "a", "to": renamed.to_string_lossy()})
                .to_string(),
        ]
        .join("\n");

        let mut tasks = undo_tasks(&raw);
        tasks.reverse();
        let mut journal = fs::File::create(dir.join("undo.jsonl")).expect("journal");
        let (restored, sidecars) = rename_files(&mut journal, &tasks).expect("undo");

        assert_eq!(restored.len(), 1);
        assert_eq!(sidecars, 1);
        assert!(original.is_file());
        assert!(dir.join("IMG_1.xmp").is_file());
        assert!(!renamed.exists());
        fs::remove_dir_all(&dir).ok();
    }
}
