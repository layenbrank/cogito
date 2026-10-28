#![allow(non_snake_case)]

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use cogito_core::{CommandResult, Exception};
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
    let joined = if relative.as_os_str().is_empty() {
        root.to_path_buf()
    } else {
        root.join(relative)
    };
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

async fn is_git_repo(cwd: &Path) -> bool {
    let Ok(output) = Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(cwd)
        .output()
        .await
    else {
        return false;
    };
    output.status.success()
}

async fn git_ls_files(cwd: &Path) -> CommandResult<Vec<String>> {
    let output = Command::new("git")
        .args([
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
        ])
        .current_dir(cwd)
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

fn walk_files(root: &Path, max_visited: usize) -> Vec<String> {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    let mut visited = 0usize;
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            visited += 1;
            if visited > max_visited {
                return files;
            }
            let path = entry.path();
            let name = entry_name(&path);
            if name.is_empty() {
                continue;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.is_dir() {
                if should_skip_dir(&name) {
                    continue;
                }
                stack.push(path);
            } else if meta.is_file() {
                files.push(to_relative(root, &path));
            }
        }
    }
    files
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
pub async fn workspaceFilesSearch(params: SearchP) -> CommandResult<Vec<SearchHitR>> {
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
        return Ok(Vec::new());
    }

    let mut merged = Vec::new();
    let mut seen = HashSet::new();
    for root in roots {
        let relatives = if is_git_repo(&root).await {
            git_ls_files(&root)
                .await
                .unwrap_or_else(|_| walk_files(&root, MAX_VISITED))
        } else {
            let root_clone = root.clone();
            tokio::task::spawn_blocking(move || walk_files(&root_clone, MAX_VISITED))
                .await
                .unwrap_or_default()
        };
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
    merged.truncate(limit);
    Ok(merged)
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

/* ─── 内容检索 ─── */

const CONTENT_LIMIT: usize = 200;
const CONTENT_FILE_BYTES: u64 = 1024 * 1024;
const CONTENT_PREVIEW_CHARS: usize = 240;
const BINARY_SNIFF_BYTES: usize = 8 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentP {
    pub root: String,
    pub query: String,
    pub is_regex: Option<bool>,
    pub is_case_sensitive: Option<bool>,
    pub is_whole_word: Option<bool>,
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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentR {
    pub hits: Vec<ContentHitR>,
    pub file_count: usize,
    pub is_truncated: bool,
}

fn build_content_matcher(params: &ContentP) -> CommandResult<regex::Regex> {
    let query = params.query.trim();
    if query.is_empty() {
        return Err(Exception::Validation("搜索内容不能为空".into()));
    }
    let pattern = if params.is_regex.unwrap_or(false) {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let pattern = if params.is_whole_word.unwrap_or(false) {
        format!(r"\b{pattern}\b")
    } else {
        pattern
    };
    regex::RegexBuilder::new(&pattern)
        .case_insensitive(!params.is_case_sensitive.unwrap_or(false))
        .build()
        .map_err(|err| Exception::Validation(format!("搜索表达式无效：{err}")))
}

fn looks_like_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(BINARY_SNIFF_BYTES).any(|byte| *byte == 0)
}

fn truncate_preview(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() <= CONTENT_PREVIEW_CHARS {
        return trimmed.to_string();
    }
    let head: String = trimmed.chars().take(CONTENT_PREVIEW_CHARS).collect();
    format!("{head}…")
}

#[tauri::command(rename = "workspaceFiles:content")]
pub async fn workspaceFilesContent(params: ContentP) -> CommandResult<ContentR> {
    let root = validate_root(&params.root)?;
    let matcher = build_content_matcher(&params)?;
    let limit = params.limit.unwrap_or(CONTENT_LIMIT).clamp(1, CONTENT_LIMIT);

    let relatives = if is_git_repo(&root).await {
        git_ls_files(&root)
            .await
            .unwrap_or_else(|_| walk_files(&root, MAX_VISITED))
    } else {
        let root_clone = root.clone();
        tokio::task::spawn_blocking(move || walk_files(&root_clone, MAX_VISITED))
            .await
            .unwrap_or_default()
    };

    tokio::task::spawn_blocking(move || -> CommandResult<ContentR> {
        let mut hits: Vec<ContentHitR> = Vec::new();
        let mut file_count = 0usize;
        let mut is_truncated = false;

        for relative in relatives {
            if hits.len() >= limit {
                is_truncated = true;
                break;
            }
            let Ok(safe_relative) = normalize_relative(&relative) else {
                continue;
            };
            let Ok(absolute) = resolve_under_root(&root, &safe_relative) else {
                continue;
            };
            let Ok(meta) = std::fs::metadata(&absolute) else {
                continue;
            };
            if !meta.is_file() || meta.len() > CONTENT_FILE_BYTES {
                continue;
            }
            let Ok(bytes) = std::fs::read(&absolute) else {
                continue;
            };
            if looks_like_binary(&bytes) {
                continue;
            }
            let text = String::from_utf8_lossy(&bytes);
            let relative_front = safe_relative.to_string_lossy().replace('\\', "/");
            let path_front = to_frontend_path(&absolute);
            let mut file_matches = 0usize;
            for (index, line) in text.lines().enumerate() {
                if hits.len() >= limit {
                    is_truncated = true;
                    break;
                }
                let Some(found) = matcher.find(line) else {
                    continue;
                };
                file_matches += 1;
                hits.push(ContentHitR {
                    path: path_front.clone(),
                    relative: relative_front.clone(),
                    line: (index + 1) as u32,
                    column: (line[..found.start()].chars().count() + 1) as u32,
                    preview: truncate_preview(line),
                });
            }
            if file_matches > 0 {
                file_count += 1;
            }
        }

        Ok(ContentR {
            hits,
            file_count,
            is_truncated,
        })
    })
    .await
    .map_err(|err| Exception::Internal(format!("content 任务失败：{err}")))?
}
