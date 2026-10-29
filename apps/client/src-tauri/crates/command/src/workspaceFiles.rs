#![allow(non_snake_case)]

use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant, SystemTime};

use aho_corasick::AhoCorasickBuilder;
use cogito_core::{CommandResult, Exception};
use parking_lot::Mutex;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

const SEARCH_LIMIT: usize = 50;
const MAX_VISITED: usize = 8000;
const READ_LIMIT: usize = 512 * 1024;

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    "target",
    ".next",
    ".turbo",
    ".cache",
    "coverage",
    "__pycache__",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDirP {
    pub root: String,
    pub relative: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchP {
    pub roots: Vec<String>,
    pub query: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileP {
    pub roots: Vec<String>,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackTypesP {
    pub root: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PackTypesFileR {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PackTypesR {
    pub files: Vec<PackTypesFileR>,
    pub is_truncated: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultR {
    pub hits: Vec<SearchHitR>,
    pub is_truncated: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryR {
    pub name: String,
    pub kind: String,
    pub path: String,
    pub relative: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchHitR {
    pub name: String,
    pub relative: String,
    pub path: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileR {
    pub path: String,
    pub content: String,
}

fn validate_root(root: &str) -> CommandResult<PathBuf> {
    let trimmed = root.trim();
    if trimmed.is_empty() {
        return Err(Exception::Validation("root 不能为空".into()));
    }
    let buf = PathBuf::from(trimmed);
    if !buf.is_absolute() {
        return Err(Exception::Validation("root 必须为绝对路径".into()));
    }
    if !buf.is_dir() {
        return Err(Exception::Validation("root 不是有效目录".into()));
    }
    Ok(buf)
}

fn normalize_relative(relative: &str) -> CommandResult<PathBuf> {
    let trimmed = relative.trim().trim_matches(['/', '\\']);
    if trimmed.is_empty() {
        return Ok(PathBuf::new());
    }
    let candidate = PathBuf::from(trimmed);
    for component in candidate.components() {
        match component {
            Component::Normal(_) => {}
            Component::CurDir => {}
            _ => {
                return Err(Exception::Validation("相对路径非法".into()));
            }
        }
    }
    Ok(candidate)
}

fn resolve_under_root(root: &Path, relative: &Path) -> CommandResult<PathBuf> {
    let joined = join_under_root(root, relative);
    let canonical_root = root
        .canonicalize()
        .map_err(|err| Exception::Validation(format!("无法解析 root：{err}")))?;
    let canonical = joined
        .canonicalize()
        .map_err(|err| Exception::Validation(format!("路径不存在：{err}")))?;
    if !canonical.starts_with(&canonical_root) {
        return Err(Exception::Permission("路径越出工作区 root".into()));
    }
    Ok(canonical)
}

/// 检索热路径：`normalize_relative` 已拒绝 `..`，直接 join，避免每文件 canonicalize。
fn join_under_root(root: &Path, relative: &Path) -> PathBuf {
    if relative.as_os_str().is_empty() {
        root.to_path_buf()
    } else {
        root.join(relative)
    }
}

fn resolve_under_roots(path: &str, roots: &[PathBuf]) -> CommandResult<PathBuf> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(Exception::Validation("path 不能为空".into()));
    }
    let candidate = PathBuf::from(trimmed);
    if !candidate.is_absolute() {
        for root in roots {
            if let Ok(resolved) = resolve_under_root(root, Path::new(trimmed)) {
                return Ok(resolved);
            }
        }
        return Err(Exception::Permission("路径不在工作区内".into()));
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|err| Exception::Validation(format!("路径不存在：{err}")))?;
    for root in roots {
        let Ok(canonical_root) = root.canonicalize() else {
            continue;
        };
        if canonical == canonical_root || canonical.starts_with(&canonical_root) {
            return Ok(canonical);
        }
    }
    Err(Exception::Permission("路径不在工作区内".into()))
}

fn should_skip_dir(name: &str) -> bool {
    SKIP_DIRS.iter().any(|item| *item == name)
}

fn entry_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_string()
}

fn to_frontend_path(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('\\', "/");
    if let Some(rest) = raw.strip_prefix("//?/UNC/") {
        format!("//{rest}")
    } else if let Some(rest) = raw.strip_prefix("//?/") {
        rest.to_string()
    } else {
        raw
    }
}

fn to_relative(root: &Path, absolute: &Path) -> String {
    absolute
        .strip_prefix(root)
        .ok()
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

fn path_for_safe_directory(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('\\', "/");
    if let Some(rest) = raw.strip_prefix("//?/UNC/") {
        format!("//{rest}")
    } else if let Some(rest) = raw.strip_prefix("//?/") {
        rest.to_string()
    } else {
        raw
    }
}

fn git_command(cwd: &Path, args: &[&str]) -> Command {
    let safe = path_for_safe_directory(cwd);
    let mut command = Command::new("git");
    command
        .arg("-c")
        .arg(format!("safe.directory={safe}"))
        .args(args)
        .current_dir(cwd);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

async fn is_git_repo(cwd: &Path) -> bool {
    let Ok(output) = git_command(cwd, &["rev-parse", "--is-inside-work-tree"])
        .output()
        .await
    else {
        return false;
    };
    output.status.success()
        && String::from_utf8_lossy(&output.stdout)
            .trim()
            .eq_ignore_ascii_case("true")
}

async fn git_ls_files(cwd: &Path) -> CommandResult<Vec<String>> {
    let output = git_command(
        cwd,
        &[
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
        ],
    )
    .output()
    .await
    .map_err(|err| Exception::Internal(format!("无法执行 git ls-files：{err}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(Exception::Internal(if stderr.is_empty() {
            "git ls-files 失败".into()
        } else {
            stderr
        }));
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    Ok(raw
        .split('\0')
        .map(|item| item.trim().replace('\\', "/"))
        .filter(|item| !item.is_empty())
        .collect())
}

/// 用 `ignore` 遍历（尊重 .gitignore / .ignore），并叠加内置 SKIP_DIRS。
/// 返回 `(相对路径列表, 是否因 max_visited 截断)`。
fn walk_files(root: &Path, max_visited: usize) -> (Vec<String>, bool) {
    let mut files = Vec::new();
    let mut visited = 0usize;
    let mut is_truncated = false;
    let walker = ignore::WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .parents(true)
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            let is_dir = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
            !(is_dir && should_skip_dir(name.as_ref()))
        })
        .build();
    for result in walker {
        visited += 1;
        if visited > max_visited {
            is_truncated = true;
            break;
        }
        let Ok(entry) = result else {
            continue;
        };
        if !entry.file_type().map(|kind| kind.is_file()).unwrap_or(false) {
            continue;
        }
        let relative = to_relative(root, entry.path());
        if !relative.is_empty() {
            files.push(relative);
        }
    }
    (files, is_truncated)
}

fn score_hit(relative: &str, query: &str) -> i32 {
    if query.is_empty() {
        return 0;
    }
    let lower_rel = relative.to_ascii_lowercase();
    let lower_q = query.to_ascii_lowercase();
    let name = Path::new(relative)
        .file_name()
        .and_then(|item| item.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if name == lower_q {
        return 300;
    }
    if name.starts_with(&lower_q) {
        return 200;
    }
    if name.contains(&lower_q) {
        return 120;
    }
    if lower_rel.contains(&lower_q) {
        return 60;
    }
    -1
}

fn filter_hits(root: &Path, relatives: Vec<String>, query: &str, limit: usize) -> Vec<SearchHitR> {
    let mut scored: Vec<(i32, SearchHitR)> = relatives
        .into_iter()
        .filter_map(|relative| {
            let Ok(safe_relative) = normalize_relative(&relative) else {
                return None;
            };
            let relative = safe_relative.to_string_lossy().replace('\\', "/");
            let score = score_hit(&relative, query);
            if score < 0 {
                return None;
            }
            let Ok(absolute) = resolve_under_root(root, &safe_relative) else {
                return None;
            };
            let name = Path::new(&relative)
                .file_name()
                .and_then(|item| item.to_str())
                .unwrap_or(relative.as_str())
                .to_string();
            Some((
                score,
                SearchHitR {
                    name,
                    relative,
                    path: to_frontend_path(&absolute),
                },
            ))
        })
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.relative.cmp(&b.1.relative)));
    scored.into_iter().take(limit).map(|item| item.1).collect()
}

#[tauri::command(rename = "workspaceFiles:listDir")]
pub async fn workspaceFilesListDir(params: ListDirP) -> CommandResult<Vec<DirEntryR>> {
    let root = validate_root(&params.root)?;
    let relative = normalize_relative(params.relative.as_deref().unwrap_or(""))?;
    let dir = resolve_under_root(&root, &relative)?;
    let relative_prefix = relative.to_string_lossy().replace('\\', "/");
    tokio::task::spawn_blocking(move || -> CommandResult<Vec<DirEntryR>> {
        let mut dirs = Vec::new();
        let mut files = Vec::new();
        let entries = std::fs::read_dir(&dir).map_err(Exception::from)?;
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry_name(&path);
            if name.is_empty() || name == ".git" {
                continue;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            let rel = if relative_prefix.is_empty() {
                name.clone()
            } else {
                format!("{relative_prefix}/{name}")
            };
            let item = DirEntryR {
                name: name.clone(),
                kind: if meta.is_dir() {
                    "dir".into()
                } else {
                    "file".into()
                },
                path: to_frontend_path(&path),
                relative: rel,
            };
            if meta.is_dir() {
                dirs.push(item);
            } else if meta.is_file() {
                files.push(item);
            }
        }
        dirs.sort_by(|a, b| {
            a.name
                .to_ascii_lowercase()
                .cmp(&b.name.to_ascii_lowercase())
        });
        files.sort_by(|a, b| {
            a.name
                .to_ascii_lowercase()
                .cmp(&b.name.to_ascii_lowercase())
        });
        dirs.extend(files);
        Ok(dirs)
    })
    .await
    .map_err(|err| Exception::Internal(format!("listDir 任务失败：{err}")))?
}

#[tauri::command(rename = "workspaceFiles:search")]
pub async fn workspaceFilesSearch(params: SearchP) -> CommandResult<SearchResultR> {
    let limit = params.limit.unwrap_or(SEARCH_LIMIT).clamp(1, SEARCH_LIMIT);
    let query = params.query.unwrap_or_default();
    let query = query.trim().to_string();
    let mut roots = Vec::new();
    for root in &params.roots {
        if let Ok(path) = validate_root(root) {
            roots.push(path);
        }
    }
    if roots.is_empty() {
        return Ok(SearchResultR {
            hits: Vec::new(),
            is_truncated: false,
        });
    }

    let mut merged = Vec::new();
    let mut seen = HashSet::new();
    let mut is_truncated = false;
    for root in roots {
        let (relatives, walk_truncated) = if is_git_repo(&root).await {
            match git_ls_files(&root).await {
                Ok(files) => (files, false),
                Err(_) => walk_files(&root, MAX_VISITED),
            }
        } else {
            let root_clone = root.clone();
            tokio::task::spawn_blocking(move || walk_files(&root_clone, MAX_VISITED))
                .await
                .unwrap_or_else(|_| (Vec::new(), false))
        };
        is_truncated |= walk_truncated;
        for hit in filter_hits(&root, relatives, &query, limit) {
            if seen.insert(hit.path.clone()) {
                merged.push(hit);
            }
        }
    }
    merged.sort_by(|a, b| {
        score_hit(&b.relative, &query)
            .cmp(&score_hit(&a.relative, &query))
            .then_with(|| a.relative.cmp(&b.relative))
    });
    if merged.len() > limit {
        is_truncated = true;
    }
    merged.truncate(limit);
    Ok(SearchResultR {
        hits: merged,
        is_truncated,
    })
}

#[tauri::command(rename = "workspaceFiles:readFile")]
pub async fn workspaceFilesReadFile(params: ReadFileP) -> CommandResult<ReadFileR> {
    let mut roots = Vec::new();
    for root in &params.roots {
        roots.push(validate_root(root)?);
    }
    if roots.is_empty() {
        return Err(Exception::Validation("roots 不能为空".into()));
    }
    let path = params.path.clone();
    tokio::task::spawn_blocking(move || -> CommandResult<ReadFileR> {
        let resolved = resolve_under_roots(&path, &roots)?;
        let meta = std::fs::metadata(&resolved).map_err(Exception::from)?;
        if !meta.is_file() {
            return Err(Exception::Validation("目标不是文件".into()));
        }
        if meta.len() as usize > READ_LIMIT {
            return Err(Exception::Validation("文件过大，无法读取".into()));
        }
        let content = std::fs::read_to_string(&resolved).map_err(Exception::from)?;
        Ok(ReadFileR {
            path: to_frontend_path(&resolved),
            content,
        })
    })
    .await
    .map_err(|err| Exception::Internal(format!("readFile 任务失败：{err}")))?
}

/* ─── Monaco @types 打包 ─── */

const PACK_TYPES_MAX_FILES: usize = 500;
const PACK_TYPES_MAX_FILE_BYTES: u64 = 512 * 1024;
const PACK_TYPES_MAX_TOTAL_BYTES: u64 = 8 * 1024 * 1024;
const PACK_TYPES_WALK_UP: usize = 6;

fn find_at_types_dirs(workspace_root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut seen = HashSet::new();
    let mut current = workspace_root.to_path_buf();
    for _ in 0..PACK_TYPES_WALK_UP {
        let at_types = current.join("node_modules").join("@types");
        if let Ok(canonical) = std::fs::canonicalize(&at_types) {
            if seen.insert(canonical.clone()) && at_types.is_dir() {
                found.push(at_types);
            }
        } else if at_types.is_dir() && seen.insert(at_types.clone()) {
            found.push(at_types);
        }
        match current.parent() {
            Some(parent) if parent != current => current = parent.to_path_buf(),
            _ => break,
        }
    }
    found
}

fn should_pack_types_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".d.ts") || lower == "package.json"
}

fn collect_types_files(
    dir: &Path,
    out: &mut Vec<PathBuf>,
    budget: &mut usize,
) -> std::io::Result<()> {
    if *budget == 0 {
        return Ok(());
    }
    let mut entries: Vec<_> = std::fs::read_dir(dir)?
        .filter_map(|item| item.ok())
        .collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        if *budget == 0 {
            break;
        }
        let path = entry.path();
        let file_type = entry.file_type()?;
        let name = entry.file_name().to_string_lossy().to_string();
        if file_type.is_dir() {
            // 跳过无关目录，避免把测试/文档拖进预算；保留 node_modules（undici-types 等）
            if name == ".github" || name == "test" || name == "tests" || name == "__tests__" {
                continue;
            }
            collect_types_files(&path, out, budget)?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        if !should_pack_types_file(&name) {
            continue;
        }
        out.push(path);
        *budget = budget.saturating_sub(1);
    }
    Ok(())
}

/// 只打包 `@types/node`。
/// Monaco 侧 `types: ['node']` 只自动纳入该包；扫完整棵 `@types` 会顶满限额并截断，还拖慢 worker。
fn pack_at_types_dir(at_types: &Path, remaining: &mut usize) -> (Vec<PathBuf>, bool) {
    let mut files = Vec::new();
    if *remaining == 0 {
        return (files, true);
    }

    let node_dir = at_types.join("node");
    if !node_dir.is_dir() {
        return (files, false);
    }
    let before = *remaining;
    if collect_types_files(&node_dir, &mut files, remaining).is_err() {
        return (files, false);
    }
    let truncated = before > 0 && *remaining == 0;
    (files, truncated)
}

fn read_pack_types_file(path: &Path, total_bytes: &mut u64) -> Option<PackTypesFileR> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > PACK_TYPES_MAX_FILE_BYTES {
        return None;
    }
    if *total_bytes + meta.len() > PACK_TYPES_MAX_TOTAL_BYTES {
        return None;
    }
    let content = std::fs::read_to_string(path).ok()?;
    *total_bytes += meta.len();
    Some(PackTypesFileR {
        path: to_frontend_path(path),
        content,
    })
}

#[tauri::command(rename = "workspaceFiles:packTypes")]
pub async fn workspaceFilesPackTypes(params: PackTypesP) -> CommandResult<PackTypesR> {
    let root = validate_root(&params.root)?;
    tokio::task::spawn_blocking(move || -> CommandResult<PackTypesR> {
        let at_types_dirs = find_at_types_dirs(&root);
        if at_types_dirs.is_empty() {
            return Ok(PackTypesR {
                files: Vec::new(),
                is_truncated: false,
            });
        }

        let mut remaining = PACK_TYPES_MAX_FILES;
        let mut paths = Vec::new();
        let mut is_truncated = false;
        for at_types in &at_types_dirs {
            let (batch, batch_truncated) = pack_at_types_dir(at_types, &mut remaining);
            is_truncated |= batch_truncated;
            paths.extend(batch);
            if remaining == 0 {
                is_truncated = true;
                break;
            }
        }

        let mut total_bytes = 0u64;
        let mut files = Vec::with_capacity(paths.len());
        for path in paths {
            match read_pack_types_file(&path, &mut total_bytes) {
                Some(file) => files.push(file),
                None => {
                    if total_bytes >= PACK_TYPES_MAX_TOTAL_BYTES {
                        is_truncated = true;
                        break;
                    }
                }
            }
        }

        Ok(PackTypesR {
            files,
            is_truncated,
        })
    })
    .await
    .map_err(|err| Exception::Internal(format!("packTypes 任务失败：{err}")))?
}

/* ─── 内容检索 ─── */

const CONTENT_LIMIT: usize = 200;
const CONTENT_FILE_BYTES: u64 = 1024 * 1024;
const CONTENT_PREVIEW_CHARS: usize = 240;
const BINARY_SNIFF_BYTES: usize = 8 * 1024;
/// 替换文件数达到此阈值才并行（过少时线程池开销 > 收益）
const PARALLEL_REPLACE_MIN: usize = 8;
/// 工作区文件列表缓存 TTL（覆盖输入防抖重复查询）
const FILE_LIST_TTL: Duration = Duration::from_secs(3);

struct FileListCache {
    files: Arc<Vec<String>>,
    via_git: bool,
    git_index_mtime: Option<SystemTime>,
    cached_at: Instant,
    is_truncated: bool,
}

/// per-root 缓存，避免快切工作区互相冲掉
static FILE_LIST_CACHE: LazyLock<Mutex<HashMap<PathBuf, FileListCache>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn git_index_mtime(root: &Path) -> Option<SystemTime> {
    std::fs::metadata(root.join(".git").join("index"))
        .and_then(|meta| meta.modified())
        .ok()
}

struct ListedFiles {
    files: Arc<Vec<String>>,
    is_truncated: bool,
}

/// 列出工作区文件；短 TTL + git index mtime 命中则免 fork / 免 walk。
async fn list_workspace_files(root: &Path) -> ListedFiles {
    let via_git = is_git_repo(root).await;
    let index_mtime = if via_git {
        git_index_mtime(root)
    } else {
        None
    };

    {
        let cache = FILE_LIST_CACHE.lock();
        if let Some(entry) = cache.get(root)
            && entry.via_git == via_git
            && entry.cached_at.elapsed() < FILE_LIST_TTL
            && (!via_git || entry.git_index_mtime == index_mtime)
        {
            return ListedFiles {
                files: Arc::clone(&entry.files),
                is_truncated: entry.is_truncated,
            };
        }
    }

    let (files, is_truncated) = if via_git {
        match git_ls_files(root).await {
            Ok(files) => (files, false),
            Err(_) => walk_files(root, MAX_VISITED),
        }
    } else {
        let root_clone = root.to_path_buf();
        tokio::task::spawn_blocking(move || walk_files(&root_clone, MAX_VISITED))
            .await
            .unwrap_or_else(|_| (Vec::new(), false))
    };
    let files = Arc::new(files);
    FILE_LIST_CACHE.lock().insert(
        root.to_path_buf(),
        FileListCache {
            files: Arc::clone(&files),
            via_git,
            git_index_mtime: index_mtime,
            cached_at: Instant::now(),
            is_truncated,
        },
    );
    ListedFiles { files, is_truncated }
}

/// 行级匹配引擎：字面量走 memchr/aho-corasick；正则与复杂 Unicode 回退 regex。
enum LineMatcher {
    Regex(regex::Regex),
    Literal {
        needle_bytes: Vec<u8>,
        /// ASCII 忽略大小写时用；否则 None，走 memmem 精确匹配
        ascii_ci: Option<aho_corasick::AhoCorasick>,
        whole_word: bool,
    },
}

fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn is_ascii_word_boundary(hay: &[u8], start: usize, end: usize) -> bool {
    let left_ok = start == 0 || !is_word_byte(hay[start - 1]);
    let right_ok = end >= hay.len() || !is_word_byte(hay[end]);
    left_ok && right_ok
}

impl LineMatcher {
    fn build(
        query: &str,
        is_regex: bool,
        is_case_sensitive: bool,
        is_whole_word: bool,
    ) -> CommandResult<Self> {
        let query = query.trim();
        if query.is_empty() {
            return Err(Exception::Validation("搜索内容不能为空".into()));
        }
        // 正则 / 非 ASCII 忽略大小写 → regex（语义正确优先）
        if is_regex || (!is_case_sensitive && !query.is_ascii()) {
            return Ok(Self::Regex(build_matcher(
                query,
                is_regex,
                is_case_sensitive,
                is_whole_word,
            )?));
        }
        // 字面量全字 + 非 ASCII：\b 交给 regex
        if is_whole_word && !query.is_ascii() {
            return Ok(Self::Regex(build_matcher(
                query,
                false,
                is_case_sensitive,
                true,
            )?));
        }

        let needle_bytes = query.as_bytes().to_vec();
        let ascii_ci = if !is_case_sensitive {
            let ac = AhoCorasickBuilder::new()
                .ascii_case_insensitive(true)
                .build([&needle_bytes])
                .map_err(|err| Exception::Validation(format!("搜索表达式无效：{err}")))?;
            Some(ac)
        } else {
            None
        };
        Ok(Self::Literal {
            needle_bytes,
            ascii_ci,
            whole_word: is_whole_word,
        })
    }

    /// 整文件字节预过滤：无 needle 则跳过 UTF-8 解码与按行扫描。
    fn file_may_match(&self, bytes: &[u8]) -> bool {
        match self {
            Self::Regex(_) => true,
            Self::Literal {
                needle_bytes,
                ascii_ci,
                ..
            } => {
                if let Some(ac) = ascii_ci {
                    ac.find(bytes).is_some()
                } else {
                    memchr::memmem::find(bytes, needle_bytes).is_some()
                }
            }
        }
    }

    /// 返回行内字节区间 [start, end)
    fn find_in_line(&self, line: &str) -> Option<(usize, usize)> {
        match self {
            Self::Regex(matcher) => matcher.find(line).map(|found| (found.start(), found.end())),
            Self::Literal {
                needle_bytes,
                ascii_ci,
                whole_word,
            } => {
                let hay = line.as_bytes();
                let mut offset = 0usize;
                while offset <= hay.len() {
                    let found = if let Some(ac) = ascii_ci {
                        ac.find(&hay[offset..])
                            .map(|m| (offset + m.start(), offset + m.end()))
                    } else {
                        memchr::memmem::find(&hay[offset..], needle_bytes).map(|index| {
                            let start = offset + index;
                            (start, start + needle_bytes.len())
                        })
                    };
                    let Some((start, end)) = found else {
                        return None;
                    };
                    if !*whole_word || is_ascii_word_boundary(hay, start, end) {
                        return Some((start, end));
                    }
                    offset = start.saturating_add(1);
                    if offset >= hay.len() {
                        break;
                    }
                }
                None
            }
        }
    }

}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentP {
    pub root: String,
    pub query: String,
    pub is_regex: Option<bool>,
    pub is_case_sensitive: Option<bool>,
    pub is_whole_word: Option<bool>,
    /// 逗号分隔的 glob；空 = 全部。Search 视图约定：无 `/` 时隐含 `**/` 前缀。
    pub includes: Option<String>,
    /// 逗号分隔的 glob；命中则跳过。
    pub excludes: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ContentHitR {
    pub path: String,
    pub relative: String,
    pub line: u32,
    pub column: u32,
    pub preview: String,
    /// 命中在 `preview` 内的 Unicode 标量起点（含）
    pub match_start: u32,
    /// 命中在 `preview` 内的 Unicode 标量终点（不含）
    pub match_end: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentR {
    pub hits: Vec<ContentHitR>,
    pub file_count: usize,
    pub is_truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceP {
    pub root: String,
    pub paths: Vec<String>,
    pub query: String,
    pub is_regex: Option<bool>,
    pub is_case_sensitive: Option<bool>,
    pub is_whole_word: Option<bool>,
    pub replacement: String,
    pub is_preserve_case: Option<bool>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceChangedR {
    pub path: String,
    pub count: u32,
    pub content: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceFailedR {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceR {
    pub changed: Vec<ReplaceChangedR>,
    pub failed: Vec<ReplaceFailedR>,
}

fn build_matcher(
    query: &str,
    is_regex: bool,
    is_case_sensitive: bool,
    is_whole_word: bool,
) -> CommandResult<regex::Regex> {
    let query = query.trim();
    if query.is_empty() {
        return Err(Exception::Validation("搜索内容不能为空".into()));
    }
    let pattern = if is_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let pattern = if is_whole_word {
        format!(r"\b{pattern}\b")
    } else {
        pattern
    };
    regex::RegexBuilder::new(&pattern)
        .case_insensitive(!is_case_sensitive)
        .build()
        .map_err(|err| Exception::Validation(format!("搜索表达式无效：{err}")))
}

/// 拆逗号分隔的 glob，并按 VS Code Search 视图规则补 `**/` 与目录 `/**`。
fn parse_globs(raw: Option<&str>) -> Vec<String> {
    let Some(text) = raw.map(str::trim).filter(|item| !item.is_empty()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for part in text.split(',') {
        let trimmed = part.trim().trim_start_matches("./");
        if trimmed.is_empty() {
            continue;
        }
        let normalized = if trimmed.contains('/') || trimmed.starts_with("**/") {
            trimmed.to_string()
        } else {
            format!("**/{trimmed}")
        };
        out.push(normalized.clone());
        if !normalized.ends_with("/**") && !normalized.ends_with('*') {
            out.push(format!("{normalized}/**"));
        }
    }
    out
}

fn push_glob_char(re: &mut String, ch: char) {
    match ch {
        '*' => re.push_str("[^/]*"),
        '?' => re.push_str("[^/]"),
        '.' | '+' | '(' | ')' | '|' | '^' | '$' | '[' | ']' | '\\' => {
            re.push('\\');
            re.push(ch);
        }
        _ => re.push(ch),
    }
}

/// 把单个 VS Code 风格 glob 转成正则（支持 `*` / `**` / `?` / `{a,b}`）。
fn glob_to_regex(glob: &str) -> String {
    let mut re = String::from("^");
    let chars: Vec<char> = glob.chars().collect();
    let mut index = 0usize;
    while index < chars.len() {
        match chars[index] {
            '*' if index + 1 < chars.len() && chars[index + 1] == '*' => {
                if index + 2 < chars.len() && chars[index + 2] == '/' {
                    re.push_str("(?:.*/)?");
                    index += 3;
                } else {
                    re.push_str(".*");
                    index += 2;
                }
            }
            '{' => {
                index += 1;
                re.push_str("(?:");
                while index < chars.len() && chars[index] != '}' {
                    if chars[index] == ',' {
                        re.push('|');
                        index += 1;
                        continue;
                    }
                    push_glob_char(&mut re, chars[index]);
                    index += 1;
                }
                re.push(')');
                if index < chars.len() {
                    index += 1;
                }
            }
            ch => {
                push_glob_char(&mut re, ch);
                index += 1;
            }
        }
    }
    re.push('$');
    re
}

fn compile_globs(raw: Option<&str>) -> CommandResult<Vec<regex::Regex>> {
    let mut compiled = Vec::new();
    for pattern in parse_globs(raw) {
        let source = glob_to_regex(&pattern);
        let matcher = regex::RegexBuilder::new(&source)
            .case_insensitive(true)
            .build()
            .map_err(|err| Exception::Validation(format!("路径过滤无效：{err}")))?;
        compiled.push(matcher);
    }
    Ok(compiled)
}

fn path_allowed(relative: &str, includes: &[regex::Regex], excludes: &[regex::Regex]) -> bool {
    if excludes.iter().any(|matcher| matcher.is_match(relative)) {
        return false;
    }
    if includes.is_empty() {
        return true;
    }
    includes.iter().any(|matcher| matcher.is_match(relative))
}

fn looks_like_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(BINARY_SNIFF_BYTES).any(|byte| *byte == 0)
}

struct PreviewSlice {
    text: String,
    match_start: u32,
    match_end: u32,
}

/// 以命中为中心裁剪预览，并返回命中在 preview 内的 Unicode 标量偏移。
fn build_preview(line: &str, match_start: usize, match_end: usize) -> PreviewSlice {
    let trimmed = line.trim();
    let trim_offset = line.len() - line.trim_start().len();
    let start = match_start.saturating_sub(trim_offset).min(trimmed.len());
    let end = match_end.saturating_sub(trim_offset).clamp(start, trimmed.len());
    // 先算标量长度；短行无需收集整行 Vec<char>
    let char_len = trimmed.chars().count();
    let match_start_char = trimmed[..start].chars().count().min(char_len);
    let match_end_char = trimmed[..end]
        .chars()
        .count()
        .min(char_len)
        .max(match_start_char);

    if char_len <= CONTENT_PREVIEW_CHARS {
        return PreviewSlice {
            text: trimmed.to_string(),
            match_start: match_start_char as u32,
            match_end: match_end_char as u32,
        };
    }

    let chars: Vec<char> = trimmed.chars().collect();
    let match_len = match_end_char - match_start_char;
    let before = CONTENT_PREVIEW_CHARS.saturating_sub(match_len) / 3;
    let mut window_start = match_start_char.saturating_sub(before);
    let mut window_end = (window_start + CONTENT_PREVIEW_CHARS).min(chars.len());
    window_start = window_end.saturating_sub(CONTENT_PREVIEW_CHARS);
    if match_end_char > window_end {
        window_end = match_end_char.min(chars.len());
        window_start = window_end.saturating_sub(CONTENT_PREVIEW_CHARS);
    }
    let body: String = chars[window_start..window_end].iter().collect();
    let has_prefix = window_start > 0;
    let has_suffix = window_end < chars.len();
    let text = match (has_prefix, has_suffix) {
        (true, true) => format!("…{body}…"),
        (true, false) => format!("…{body}"),
        (false, true) => format!("{body}…"),
        (false, false) => body,
    };
    let prefix_chars = if has_prefix { 1u32 } else { 0 };
    PreviewSlice {
        text,
        match_start: prefix_chars + (match_start_char - window_start) as u32,
        match_end: prefix_chars + (match_end_char - window_start) as u32,
    }
}

fn scan_file_hits(
    root: &Path,
    relative: &str,
    matcher: &LineMatcher,
    remaining: usize,
) -> Vec<ContentHitR> {
    if remaining == 0 {
        return Vec::new();
    }
    let relative_front = relative.replace('\\', "/");
    let Ok(safe_relative) = normalize_relative(relative) else {
        return Vec::new();
    };
    let absolute = join_under_root(root, &safe_relative);
    let Ok(bytes) = std::fs::read(&absolute) else {
        return Vec::new();
    };
    if bytes.len() as u64 > CONTENT_FILE_BYTES || looks_like_binary(&bytes) {
        return Vec::new();
    }
    // 1′：字面量整文件字节预过滤，避免无命中文件的 UTF-8 / 分行开销
    if !matcher.file_may_match(&bytes) {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&bytes);
    let path_front = to_frontend_path(&absolute);
    let mut hits = Vec::with_capacity(4);
    for (index, line) in text.lines().enumerate() {
        if hits.len() >= remaining {
            break;
        }
        let Some((start, end)) = matcher.find_in_line(line) else {
            continue;
        };
        let preview = build_preview(line, start, end);
        hits.push(ContentHitR {
            path: path_front.clone(),
            relative: relative_front.clone(),
            line: (index + 1) as u32,
            column: (line[..start].chars().count() + 1) as u32,
            preview: preview.text,
            match_start: preview.match_start,
            match_end: preview.match_end,
        });
    }
    hits
}

fn take_hit_budget(budget: &AtomicUsize, want: usize) -> usize {
    if want == 0 {
        return 0;
    }
    loop {
        let available = budget.load(Ordering::Relaxed);
        if available == 0 {
            return 0;
        }
        let take = want.min(available);
        let next = available - take;
        if budget
            .compare_exchange_weak(available, next, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
        {
            return take;
        }
    }
}

#[tauri::command(rename = "workspaceFiles:content")]
pub async fn workspaceFilesContent(params: ContentP) -> CommandResult<ContentR> {
    let root = validate_root(&params.root)?;
    let matcher = LineMatcher::build(
        &params.query,
        params.is_regex.unwrap_or(false),
        params.is_case_sensitive.unwrap_or(false),
        params.is_whole_word.unwrap_or(false),
    )?;
    let includes = compile_globs(params.includes.as_deref())?;
    let excludes = compile_globs(params.excludes.as_deref())?;
    let limit = params.limit.unwrap_or(CONTENT_LIMIT).clamp(1, CONTENT_LIMIT);
    let listed = list_workspace_files(&root).await;
    let relatives = listed.files;
    let list_truncated = listed.is_truncated;

    tokio::task::spawn_blocking(move || -> CommandResult<ContentR> {
        // 先串行过滤 glob：避免并行阶段对排除文件做 IO
        let allowed: Vec<&String> = relatives
            .iter()
            .filter(|relative| {
                if relative.contains('\\') {
                    path_allowed(&relative.replace('\\', "/"), &includes, &excludes)
                } else {
                    path_allowed(relative, &includes, &excludes)
                }
            })
            .collect();

        let hit_budget = AtomicUsize::new(limit);
        let saw_overflow = AtomicBool::new(false);

        let mut per_file: Vec<Vec<ContentHitR>> = allowed
            .par_iter()
            .map(|relative| {
                let available = hit_budget.load(Ordering::Relaxed);
                if available == 0 {
                    saw_overflow.store(true, Ordering::Relaxed);
                    return Vec::new();
                }
                let mut hits = scan_file_hits(&root, relative.as_str(), &matcher, available);
                if hits.is_empty() {
                    return hits;
                }
                let granted = take_hit_budget(&hit_budget, hits.len());
                if granted < hits.len() {
                    saw_overflow.store(true, Ordering::Relaxed);
                    hits.truncate(granted);
                }
                hits
            })
            .collect();

        per_file.sort_by(|a, b| {
            let left = a.first().map(|hit| hit.relative.as_str()).unwrap_or("");
            let right = b.first().map(|hit| hit.relative.as_str()).unwrap_or("");
            left.cmp(right)
        });

        let mut hits = Vec::with_capacity(limit.min(128));
        let mut file_count = 0usize;
        for file_hits in per_file {
            if file_hits.is_empty() {
                continue;
            }
            file_count += 1;
            for hit in file_hits {
                if hits.len() >= limit {
                    break;
                }
                hits.push(hit);
            }
            if hits.len() >= limit {
                break;
            }
        }

        let is_truncated =
            list_truncated || saw_overflow.load(Ordering::Relaxed) || hits.len() >= limit;
        Ok(ContentR {
            hits,
            file_count,
            is_truncated,
        })
    })
    .await
    .map_err(|err| Exception::Internal(format!("content 任务失败：{err}")))?
}

/// 对齐前端 Preserve Case：全大写 / 全小写 / Title / 逐字符映射。
fn preserve_case(matched: &str, replacement: &str) -> String {
    if matched.is_empty() || replacement.is_empty() {
        return replacement.to_string();
    }
    let matched_chars: Vec<char> = matched.chars().collect();
    let replacement_chars: Vec<char> = replacement.chars().collect();
    if matched == matched.to_uppercase() {
        return replacement.to_uppercase();
    }
    if matched == matched.to_lowercase() {
        return replacement.to_lowercase();
    }
    let is_title = matched_chars[0].is_uppercase()
        && matched_chars[1..]
            .iter()
            .all(|ch| !ch.is_alphabetic() || ch.is_lowercase());
    if is_title {
        let mut out = String::with_capacity(replacement.len());
        for (index, ch) in replacement_chars.iter().enumerate() {
            if index == 0 {
                out.extend(ch.to_uppercase());
            } else {
                out.extend(ch.to_lowercase());
            }
        }
        return out;
    }
    let mut out = String::with_capacity(replacement.len());
    for (index, ch) in replacement_chars.iter().enumerate() {
        let source = matched_chars[index.min(matched_chars.len() - 1)];
        if source.is_uppercase() && source.is_alphabetic() {
            out.extend(ch.to_uppercase());
        } else {
            out.extend(ch.to_lowercase());
        }
    }
    out
}

/// 展开 JS 风格替换模板：`$$` / `$&` / `$`` / `$'` / `$n`
fn expand_regex_replacement(template: &str, caps: &regex::Captures, input: &str) -> String {
    let whole = caps.get(0).map(|item| item.as_str()).unwrap_or("");
    let start = caps.get(0).map(|item| item.start()).unwrap_or(0);
    let end = caps.get(0).map(|item| item.end()).unwrap_or(0);
    let mut out = String::new();
    let chars: Vec<char> = template.chars().collect();
    let mut index = 0usize;
    while index < chars.len() {
        if chars[index] != '$' {
            out.push(chars[index]);
            index += 1;
            continue;
        }
        if index + 1 >= chars.len() {
            out.push('$');
            break;
        }
        match chars[index + 1] {
            '$' => {
                out.push('$');
                index += 2;
            }
            '&' => {
                out.push_str(whole);
                index += 2;
            }
            '`' => {
                out.push_str(&input[..start]);
                index += 2;
            }
            '\'' => {
                out.push_str(&input[end..]);
                index += 2;
            }
            digit if digit.is_ascii_digit() => {
                let mut digits = String::new();
                index += 1;
                while index < chars.len() && chars[index].is_ascii_digit() {
                    digits.push(chars[index]);
                    index += 1;
                }
                let group = digits.parse::<usize>().unwrap_or(0);
                if let Some(captured) = caps.get(group) {
                    out.push_str(captured.as_str());
                } else {
                    out.push('$');
                    out.push_str(&digits);
                }
            }
            other => {
                out.push('$');
                out.push(other);
                index += 2;
            }
        }
    }
    out
}

fn replace_in_content(
    content: &str,
    matcher: &regex::Regex,
    is_regex: bool,
    replacement: &str,
    is_preserve_case: bool,
) -> (String, u32) {
    // 字面量替换：单遍 replace_all 并计数，避免 find_iter + replace 双扫
    if !is_preserve_case && !is_regex {
        let mut count = 0u32;
        let out = matcher.replace_all(content, |_: &regex::Captures| {
            count += 1;
            replacement
        });
        return (out.into_owned(), count);
    }

    let mut out = String::with_capacity(content.len());
    let mut last = 0usize;
    let mut count = 0u32;
    for caps in matcher.captures_iter(content) {
        let Some(whole) = caps.get(0) else {
            continue;
        };
        out.push_str(&content[last..whole.start()]);
        let expanded = if is_regex {
            expand_regex_replacement(replacement, &caps, content)
        } else {
            replacement.to_string()
        };
        if is_preserve_case {
            out.push_str(&preserve_case(whole.as_str(), &expanded));
        } else {
            out.push_str(&expanded);
        }
        last = whole.end();
        count += 1;
        if whole.as_str().is_empty() {
            if last < content.len() {
                let ch = content[last..]
                    .chars()
                    .next()
                    .map(|item| item.len_utf8())
                    .unwrap_or(1);
                out.push_str(&content[last..last + ch]);
                last += ch;
            } else {
                break;
            }
        }
    }
    out.push_str(&content[last..]);
    (out, count)
}

fn replace_one_path(
    roots: &[PathBuf],
    path: String,
    matcher: &regex::Regex,
    is_regex: bool,
    replacement: &str,
    is_preserve_case: bool,
) -> Result<Option<ReplaceChangedR>, ReplaceFailedR> {
    let resolved = resolve_under_roots(&path, roots).map_err(|err| ReplaceFailedR {
        path: path.clone(),
        message: format!("{err}"),
    })?;
    let content = std::fs::read_to_string(&resolved).map_err(|err| ReplaceFailedR {
        path: to_frontend_path(&resolved),
        message: err.to_string(),
    })?;
    let (next, count) =
        replace_in_content(&content, matcher, is_regex, replacement, is_preserve_case);
    if count == 0 || next == content {
        return Ok(None);
    }
    std::fs::write(&resolved, &next).map_err(|err| ReplaceFailedR {
        path: to_frontend_path(&resolved),
        message: err.to_string(),
    })?;
    Ok(Some(ReplaceChangedR {
        path: to_frontend_path(&resolved),
        count,
        content: next,
    }))
}

#[tauri::command(rename = "workspaceFiles:replace")]
pub async fn workspaceFilesReplace(params: ReplaceP) -> CommandResult<ReplaceR> {
    let root = validate_root(&params.root)?;
    let matcher = build_matcher(
        &params.query,
        params.is_regex.unwrap_or(false),
        params.is_case_sensitive.unwrap_or(false),
        params.is_whole_word.unwrap_or(false),
    )?;
    let is_regex = params.is_regex.unwrap_or(false);
    let is_preserve_case = params.is_preserve_case.unwrap_or(false);
    let replacement = params.replacement.clone();
    let paths = params.paths.clone();

    tokio::task::spawn_blocking(move || -> CommandResult<ReplaceR> {
        let roots = [root];
        let outcomes: Vec<Result<Option<ReplaceChangedR>, ReplaceFailedR>> =
            if paths.len() >= PARALLEL_REPLACE_MIN {
                paths
                    .into_par_iter()
                    .map(|path| {
                        replace_one_path(
                            &roots,
                            path,
                            &matcher,
                            is_regex,
                            &replacement,
                            is_preserve_case,
                        )
                    })
                    .collect()
            } else {
                paths
                    .into_iter()
                    .map(|path| {
                        replace_one_path(
                            &roots,
                            path,
                            &matcher,
                            is_regex,
                            &replacement,
                            is_preserve_case,
                        )
                    })
                    .collect()
            };

        let mut changed = Vec::new();
        let mut failed = Vec::new();
        for outcome in outcomes {
            match outcome {
                Ok(Some(item)) => changed.push(item),
                Ok(None) => {}
                Err(item) => failed.push(item),
            }
        }
        Ok(ReplaceR { changed, failed })
    })
    .await
    .map_err(|err| Exception::Internal(format!("replace 任务失败：{err}")))?
}

#[cfg(test)]
mod content_glob_tests {
    use super::*;

    #[test]
    fn plain_name_implies_star_star_prefix() {
        let patterns = parse_globs(Some("src"));
        assert!(patterns.iter().any(|item| item == "**/src"));
        assert!(patterns.iter().any(|item| item == "**/src/**"));
    }

    #[test]
    fn include_filters_relative_paths() {
        let includes = compile_globs(Some("*.ts")).unwrap();
        let excludes = compile_globs(None).unwrap();
        assert!(path_allowed("apps/client/a.ts", &includes, &excludes));
        assert!(!path_allowed("apps/client/a.rs", &includes, &excludes));
    }

    #[test]
    fn exclude_wins_over_include() {
        let includes = compile_globs(Some("**/*")).unwrap();
        let excludes = compile_globs(Some("dist")).unwrap();
        assert!(!path_allowed("dist/index.js", &includes, &excludes));
        assert!(path_allowed("src/index.js", &includes, &excludes));
    }

    #[test]
    fn preview_keeps_match_offsets() {
        let line = "  return import('@/views/signin/signin.tsx')";
        let start = line.find("signin.tsx").unwrap();
        let end = start + "signin.tsx".len();
        let preview = build_preview(line, start, end);
        let chars: Vec<char> = preview.text.chars().collect();
        let hit: String = chars[preview.match_start as usize..preview.match_end as usize]
            .iter()
            .collect();
        assert_eq!(hit, "signin.tsx");
    }

    #[test]
    fn preserve_case_shapes() {
        assert_eq!(preserve_case("NAME", "thing"), "THING");
        assert_eq!(preserve_case("name", "Thing"), "thing");
        assert_eq!(preserve_case("Name", "thing"), "Thing");
        assert_eq!(preserve_case("nAmE", "thing"), "tHiNG");
    }

    #[test]
    fn literal_prefilter_and_line_find() {
        let matcher = LineMatcher::build("signin.tsx", false, true, false).unwrap();
        assert!(matcher.file_may_match(b"return import('@/views/signin/signin.tsx')"));
        assert!(!matcher.file_may_match(b"no match here"));
        let line = "return import('@/views/signin/signin.tsx')";
        let (start, end) = matcher.find_in_line(line).unwrap();
        assert_eq!(&line[start..end], "signin.tsx");
    }

    #[test]
    fn literal_ascii_ci_and_whole_word() {
        let ci = LineMatcher::build("Foo", false, false, false).unwrap();
        assert!(ci.file_may_match(b"hello FOO bar"));
        let ww = LineMatcher::build("foo", false, true, true).unwrap();
        assert_eq!(ww.find_in_line("foobar"), None);
        assert!(ww.find_in_line("a foo b").is_some());
    }
}
