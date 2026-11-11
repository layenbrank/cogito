//! 授权集：壳层权限面的唯一真源（计划 S1 / 1A）。
//!
//! `capabilities` 只能声明静态 scope，而应用真正要访问的目录是运行期才知道的：
//! 工作区根随用户添加/删除变化，图库素材散落在任意磁盘位置。过去只能把
//! `fs:scope` / `assetProtocol.scope` 全开 —— 这就是 `docs/decisions/security-boundary.md`
//! 里记的那笔账。这里改成三源合一，1B 再把配置里的通配删掉：
//!
//! 1. **静态根**：应用自己的 local-data / data / config / cache / log / temp / resource 目录。
//!    截图冻结帧、贴图、剪辑帧与波形都落在这里。
//! 2. **工作区根**：`agent_workspace_folder` 里已登记的目录（代码工作区、知识库根）。
//! 3. **素材文件**：`asset` 表里未归档的 `filePath`（用户从任意目录导入的图/视频）。
//!
//! 三者的并集写进 `asset:` 协议 scope 与 `fs` scope。**只加不减**：回收靠下一次进程启动
//! 重建（Scope 没有"撤销单条"的正向语义，见 `rebuild` 的注释）。
use std::path::{Path, PathBuf};

use cogito_database::Storage;
use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;

/// 单次重建最多放行多少个素材文件：防止十万条 asset 把 scope 撑爆（首屏也会变慢）。
const ASSET_GRANT_LIMIT: usize = 5_000;

/// 一次重建的结果。既进日志，也经 `security_grants_rebuild` 回给诊断页。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantReport {
    pub static_roots: Vec<String>,
    pub workspace_roots: Vec<String>,
    pub asset_files: usize,
    /// 实际被 scope 接受的目录数（含去重后的并集）
    pub granted_dirs: usize,
    pub granted_files: usize,
    /// 上一次会话落盘、这次重建时重新放行的路径数
    pub granted_persisted: usize,
    /// 路径不存在 / scope 拒绝等；不中断整轮重建
    pub errors: Vec<String>,
}

/// 拼接 + 去重 + 剔除空串。纯函数，单测覆盖。
#[must_use]
fn dedupe(paths: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for path in paths {
        if path.as_os_str().is_empty() {
            continue;
        }
        if out.iter().any(|seen| seen == &path) {
            continue;
        }
        out.push(path);
    }
    out
}

/// 应用自己的固定目录。取不到的（平台不支持）直接跳过。
#[must_use]
fn static_roots(app: &AppHandle) -> Vec<PathBuf> {
    let path = app.path();
    let candidates = [
        path.app_local_data_dir().ok(),
        path.app_data_dir().ok(),
        path.app_config_dir().ok(),
        path.app_cache_dir().ok(),
        path.app_log_dir().ok(),
        path.temp_dir().ok(),
        path.resource_dir().ok(),
    ];
    dedupe(candidates.into_iter().flatten())
}

/// `agent_workspace_folder` 里登记的目录（含知识库根：它也是登记过的）。
async fn workspace_roots(storage: &Storage) -> Result<Vec<PathBuf>, String> {
    let rows = storage
        .connection()
        .query_all(Statement::from_string(
            DatabaseBackend::Sqlite,
            "SELECT path FROM agent_workspace_folder ORDER BY sort, \"createdAt\"".to_string(),
        ))
        .await
        .map_err(|error| format!("查询工作区目录失败：{error}"))?;
    let mut out: Vec<PathBuf> = Vec::new();
    for row in rows {
        let Ok(path) = row.try_get::<String>("", "path") else {
            continue;
        };
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        out.push(PathBuf::from(trimmed));
    }
    Ok(dedupe(out))
}

/// `asset` 表里未归档的素材文件（图库 / 剪辑预览靠 `asset:` 读它们）。
async fn asset_files(storage: &Storage) -> Result<Vec<PathBuf>, String> {
    let sql = format!(
        "SELECT \"filePath\" FROM asset WHERE \"archivedAt\" IS NULL ORDER BY \"createdAt\" DESC LIMIT {ASSET_GRANT_LIMIT}"
    );
    let rows = storage
        .connection()
        .query_all(Statement::from_string(DatabaseBackend::Sqlite, sql))
        .await
        .map_err(|error| format!("查询素材文件失败：{error}"))?;
    let mut out: Vec<PathBuf> = Vec::new();
    for row in rows {
        let Ok(path) = row.try_get::<String>("", "filePath") else {
            continue;
        };
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        out.push(PathBuf::from(trimmed));
    }
    Ok(dedupe(out))
}

/// `knowledge_base` 的文件根目录（`<root>/<slug>/`）。知识库根可能是用户挑的
/// 任意位置，收窄 scope 后必须一并放行，否则打开知识库就是「目录不存在」。
async fn knowledge_roots(storage: &Storage) -> Result<Vec<PathBuf>, String> {
    let rows = storage
        .connection()
        .query_all(Statement::from_string(
            DatabaseBackend::Sqlite,
            "SELECT \"rootPath\" FROM knowledge_base WHERE \"archivedAt\" IS NULL".to_string(),
        ))
        .await
        .map_err(|error| format!("查询知识库根目录失败：{error}"))?;
    let mut out: Vec<PathBuf> = Vec::new();
    for row in rows {
        let Ok(path) = row.try_get::<String>("", "rootPath") else {
            continue;
        };
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        out.push(PathBuf::from(trimmed));
    }
    Ok(dedupe(out))
}

/// 用户选过的路径落盘目录（`<appLocalData>/security/grants.json`）。
///
/// 对话框授权只活在当前进程：不落盘的话「昨天选过的工作区，今天打开就没权限」。
/// 用 JSON 而不是建表，是因为它属于第 1A 步的本地缓存，不该进业务 schema。
const PERSIST_DIR: &str = "security";
const PERSIST_FILE: &str = "grants.json";
/// 上限：用户到处另存，不封顶会把这文件写成垃圾场。
const PERSIST_LIMIT: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedGrant {
    path: String,
    recursive: bool,
}

fn persist_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_local_data_dir().ok()?.join(PERSIST_DIR);
    Some(dir.join(PERSIST_FILE))
}

fn read_persisted(app: &AppHandle) -> Vec<PersistedGrant> {
    let Some(file) = persist_path(app) else {
        return Vec::new();
    };
    let Ok(raw) = std::fs::read_to_string(&file) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<PersistedGrant>>(&raw).unwrap_or_default()
}

fn write_persisted(app: &AppHandle, grants: &[PersistedGrant]) {
    let Some(file) = persist_path(app) else {
        return;
    };
    if let Some(parent) = file.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            tracing::warn!(?error, "创建授权落盘目录失败");
            return;
        }
    }
    match serde_json::to_vec_pretty(grants) {
        Ok(bytes) => {
            if let Err(error) = std::fs::write(&file, bytes) {
                tracing::warn!(?error, "写授权落盘文件失败");
            }
        }
        Err(error) => tracing::warn!(?error, "序列化授权落盘文件失败"),
    }
}

/// 记住这批路径（去重、剔除已删除、封顶）。只记账，不放行 —— 放行由调用方做。
fn persist(app: &AppHandle, paths: &[PathBuf], recursive: bool) {
    let mut grants = read_persisted(app);
    for path in paths {
        let text = path.to_string_lossy().into_owned();
        if text.trim().is_empty() || grants.iter().any(|grant| grant.path == text) {
            continue;
        }
        grants.push(PersistedGrant {
            path: text,
            recursive,
        });
    }
    let mut kept: Vec<PersistedGrant> = grants
        .into_iter()
        .filter(|grant| Path::new(&grant.path).exists())
        .collect();
    if kept.len() > PERSIST_LIMIT {
        let drop_count = kept.len() - PERSIST_LIMIT;
        kept.drain(0..drop_count);
    }
    write_persisted(app, &kept);
}

/// 落盘过的路径（父目录挂了就跳过，不阻塞重建）。
fn persisted_paths(app: &AppHandle) -> Vec<(PathBuf, bool)> {
    read_persisted(app)
        .into_iter()
        .map(|grant| (PathBuf::from(grant.path), grant.recursive))
        .filter(|(path, _)| path.exists())
        .collect()
}

fn exists(path: &Path) -> bool {
    path.exists()
}

/// 重建授权集并把结果写进两个 scope。
///
/// 幂等：重复调用只是重复 allow（Tauri 的 scope 是集合）。不需要「撤销」——
/// 用户删掉工作区 / 归档素材后，旧路径仍在本进程的 scope 里，但读取要经过
/// `app_workspace_*` 的根校验与 asset 表，所以不会因此变成越权；下一次启动自然收敛。
pub async fn rebuild(app: &AppHandle) -> Result<GrantReport, String> {
    let storage = app.state::<Storage>().inner().clone();
    let mut report = GrantReport::default();

    let statics = static_roots(app);
    report.static_roots = statics
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();

    let mut roots = workspace_roots(&storage).await?;
    roots.extend(knowledge_roots(&storage).await?);
    let roots = dedupe(roots);
    report.workspace_roots = roots
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();

    let files = asset_files(&storage).await?;
    report.asset_files = files.len();

    let asset_scope = app.asset_protocol_scope();
    let fs_scope = app.fs_scope();

    for dir in statics.iter().chain(roots.iter()) {
        if !exists(dir) {
            report
                .errors
                .push(format!("目录不存在，已跳过：{}", dir.display()));
            continue;
        }
        match asset_scope.allow_directory(dir, true) {
            Ok(()) => report.granted_dirs += 1,
            Err(error) => report
                .errors
                .push(format!("asset scope 拒绝 {}：{error}", dir.display())),
        }
        if let Err(error) = fs_scope.allow_directory(dir, true) {
            report
                .errors
                .push(format!("fs scope 拒绝 {}：{error}", dir.display()));
        }
    }

    for file in &files {
        if !exists(file) {
            report
                .errors
                .push(format!("素材文件不存在，已跳过：{}", file.display()));
            continue;
        }
        match asset_scope.allow_file(file) {
            Ok(()) => report.granted_files += 1,
            Err(error) => report
                .errors
                .push(format!("asset scope 拒绝 {}：{error}", file.display())),
        }
        if let Err(error) = fs_scope.allow_file(file) {
            report
                .errors
                .push(format!("fs scope 拒绝 {}：{error}", file.display()));
        }
    }

    // 用户上一次会话里亲手选过的路径（另存目标 / 素材文件夹 / 代码工作区）
    for (path, recursive) in persisted_paths(app) {
        if path.is_dir() {
            match asset_scope.allow_directory(&path, recursive) {
                Ok(()) => report.granted_dirs += 1,
                Err(error) => report
                    .errors
                    .push(format!("asset scope 拒绝 {}：{error}", path.display())),
            }
            if let Err(error) = fs_scope.allow_directory(&path, recursive) {
                report
                    .errors
                    .push(format!("fs scope 拒绝 {}：{error}", path.display()));
            }
        } else {
            match asset_scope.allow_file(&path) {
                Ok(()) => report.granted_files += 1,
                Err(error) => report
                    .errors
                    .push(format!("asset scope 拒绝 {}：{error}", path.display())),
            }
            if let Err(error) = fs_scope.allow_file(&path) {
                report
                    .errors
                    .push(format!("fs scope 拒绝 {}：{error}", path.display()));
            }
        }
        report.granted_persisted += 1;
    }

    tracing::info!(
        static_roots = report.static_roots.len(),
        workspace_roots = report.workspace_roots.len(),
        asset_files = report.asset_files,
        granted_dirs = report.granted_dirs,
        granted_files = report.granted_files,
        granted_persisted = report.granted_persisted,
        errors = report.errors.len(),
        "授权集重建完成"
    );
    Ok(report)
}

/// 单独放行一批路径：用户在对话框里刚选的目录 / 文件、刚导入的素材。
///
/// 与 `rebuild` 的区别：这里不查库，只处理「用户这一秒亲自选了它」这一件事。
/// 目录按 `recursive` 递归放行（选一个素材文件夹 = 放行其子树）。
pub fn allow_paths(app: &AppHandle, paths: &[PathBuf], recursive: bool) {
    let asset_scope = app.asset_protocol_scope();
    let fs_scope = app.fs_scope();
    for path in paths {
        if path.is_dir() {
            let _ = asset_scope.allow_directory(path, recursive);
            let _ = fs_scope.allow_directory(path, recursive);
        } else {
            let _ = asset_scope.allow_file(path);
            let _ = fs_scope.allow_file(path);
        }
    }
}

/// 写盘前的授权判定：目标必须落在「静态根 / 工作区根」里。
///
/// 用在 `media:export` 这类「前端传一个 output 路径、Rust 直接写盘」的命令上 ——
/// 否则 `fs:scope` 收得再紧，这里仍是一条任意路径写盘的后门。
pub async fn assert_writable(app: &AppHandle, raw: &str) -> Result<PathBuf, String> {
    let storage = app.state::<Storage>().inner().clone();
    let mut roots = static_roots(app);
    roots.extend(workspace_roots(&storage).await?);
    roots.extend(knowledge_roots(&storage).await?);
    // 用户选过的目录也算「已授权写入」：另存到上次选过的文件夹不该被拒
    roots.extend(persisted_paths(app).into_iter().map(|(path, _)| path));
    let roots = dedupe(roots);

    let target = PathBuf::from(raw);
    let checked = if target.exists() {
        std::fs::canonicalize(&target).unwrap_or_else(|_| target.clone())
    } else {
        // 目标还不存在：校验父目录（存在性由调用方保证）
        let parent = target
            .parent()
            .ok_or_else(|| format!("导出的目标路径没有父目录：{raw}"))?;
        let parent = std::fs::canonicalize(parent)
            .map_err(|error| format!("导出目录不可用（{raw}）：{error}"))?;
        parent.join(target.file_name().unwrap_or_default())
    };

    let allowed = roots
        .iter()
        .filter_map(|root| std::fs::canonicalize(root).ok())
        .any(|root| checked.starts_with(&root));
    if !allowed {
        // 提示要可行动：告诉用户把文件放到已授权的目录，而不是丢一句「拒绝」
        return Err(format!(
            "导出目标 {} 不在已授权目录内（应用数据目录 / 工作区根）。请先在工作区里新建文件或另存到工作区目录，再导出。",
            checked.display()
        ));
    }
    Ok(checked)
}

/// 逃生门（`--safe-mode` / `COGITO_SAFE_MODE=1`）：跳过授权集，直接放行整盘。
///
/// 收口把用户收挂时（例如某条链路漏了授权），用户至少要能进门把活干完 ——
/// 这是「破坏性改动必须有退路」的那条退路。代价是回到 1B 之前的状态，
/// 所以启动日志里要显式 warn，设置页也会显示「安全模式」。
#[must_use]
pub fn safe_mode_enabled() -> bool {
    std::env::args().any(|arg| arg == "--safe-mode")
        || std::env::var("COGITO_SAFE_MODE").is_ok_and(|value| {
            let value = value.trim();
            value == "1" || value.eq_ignore_ascii_case("true")
        })
}

/// 安全模式：把家目录与各个盘根递归放行（等价于 1B 之前的宽 scope）。
///
/// 只用于「收口出错时仍能开工」，不进正常启动路径。
pub fn apply_safe_mode(app: &AppHandle) {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(home) = app.path().home_dir() {
        roots.push(home);
    }
    #[cfg(windows)]
    {
        for letter in b'A'..=b'Z' {
            let root = PathBuf::from(format!("{}:\\", letter as char));
            if root.exists() {
                roots.push(root);
            }
        }
    }
    #[cfg(not(windows))]
    {
        roots.push(PathBuf::from("/"));
    }
    for root in &roots {
        let _ = app.asset_protocol_scope().allow_directory(root, true);
        let _ = app.fs_scope().allow_directory(root, true);
    }
    tracing::warn!(
        roots = roots.len(),
        "安全模式：已放行整盘 scope（--safe-mode / COGITO_SAFE_MODE）"
    );
}

/// 前端在「用户选完路径」后调用：立刻放行，避免 plugin-fs / asset: 读取被 scope 拦下。
#[tauri::command]
pub async fn security_grant_paths(
    app: AppHandle,
    paths: Vec<String>,
    recursive: Option<bool>,
) -> Result<usize, String> {
    let list: Vec<PathBuf> = dedupe(
        paths
            .into_iter()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .map(PathBuf::from),
    );
    allow_paths(&app, &list, recursive.unwrap_or(true));
    // 记在盘上：下次启动 rebuild 会重新放行，否则用户得再选一遍
    persist(&app, &list, recursive.unwrap_or(true));
    tracing::debug!(count = list.len(), "放行用户选择的路径");
    Ok(list.len())
}

/// 诊断 / 设置页用：重建后把结果回给前端（授权集是否为空、哪些路径被跳过）。
#[tauri::command]
pub async fn security_grants_rebuild(app: AppHandle) -> Result<GrantReport, String> {
    rebuild(&app).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dedupe_keeps_order_and_drops_duplicates() {
        let out = dedupe(vec![
            PathBuf::from("C:/a"),
            PathBuf::from(""),
            PathBuf::from("C:/b"),
            PathBuf::from("C:/a"),
        ]);
        assert_eq!(out, vec![PathBuf::from("C:/a"), PathBuf::from("C:/b")]);
    }

    #[test]
    fn dedupe_of_empty_iterator_is_empty() {
        assert!(dedupe(Vec::new()).is_empty());
    }
}
