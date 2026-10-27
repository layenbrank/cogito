#![allow(non_snake_case)]

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use cogito_core::{CommandResult, Exception};
use serde::{Deserialize, Serialize};

const SKILL_FILE: &str = "SKILL.md";
const DESC_MAX: usize = 80;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSkillsP {
    pub roots: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillR {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub relative: String,
}

fn validate_root(root: &str) -> Option<PathBuf> {
    let trimmed = root.trim();
    if trimmed.is_empty() {
        return None;
    }
    let buf = PathBuf::from(trimmed);
    if buf.is_absolute() && buf.is_dir() {
        Some(buf)
    } else {
        None
    }
}

fn truncate_desc(value: &str) -> String {
    let trimmed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed.chars().count() <= DESC_MAX {
        return trimmed;
    }
    let cut: String = trimmed.chars().take(DESC_MAX).collect();
    format!("{cut}…")
}

fn parse_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (None, None);
    }
    let rest = &trimmed[3..];
    let Some(end) = rest.find("\n---") else {
        return (None, None);
    };
    let block = &rest[..end];
    let mut name = None;
    let mut description = None;
    let mut current_key: Option<&str> = None;
    let mut current_value = String::new();

    fn flush(
        key: Option<&str>,
        value: &str,
        name: &mut Option<String>,
        description: &mut Option<String>,
    ) {
        let Some(key) = key else {
            return;
        };
        let cleaned = value
            .trim()
            .trim_matches(|c| c == '"' || c == '\'')
            .trim()
            .to_string();
        if cleaned.is_empty() {
            return;
        }
        match key {
            "name" => *name = Some(cleaned),
            "description" => *description = Some(cleaned),
            _ => {}
        }
    }

    for line in block.lines() {
        let stripped = line.trim_end();
        if stripped.is_empty() {
            continue;
        }
        if let Some((key, value)) = stripped.split_once(':') {
            let key = key.trim();
            if key == "name" || key == "description" {
                flush(current_key, &current_value, &mut name, &mut description);
                current_key = Some(key);
                let value = value.trim();
                if value == ">" || value == "|-" || value == "|" || value == ">-" {
                    current_value.clear();
                } else {
                    current_value = value.to_string();
                }
                continue;
            }
        }
        if current_key.is_some() {
            if !current_value.is_empty() {
                current_value.push(' ');
            }
            current_value.push_str(stripped.trim());
        }
    }
    flush(current_key, &current_value, &mut name, &mut description);
    (name, description)
}

fn collect_from_skills_dir(
    root: &Path,
    skills_dir: &Path,
    out: &mut Vec<SkillR>,
    seen: &mut HashSet<String>,
) {
    let Ok(entries) = std::fs::read_dir(skills_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let skill_path = path.join(SKILL_FILE);
        if !skill_path.is_file() {
            continue;
        }
        let absolute = skill_path.to_string_lossy().to_string();
        if !seen.insert(absolute.clone()) {
            continue;
        }
        let folder_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("skill")
            .to_string();
        let content = std::fs::read_to_string(&skill_path).unwrap_or_default();
        let (parsed_name, parsed_desc) = parse_frontmatter(&content);
        let relative = skill_path
            .strip_prefix(root)
            .ok()
            .map(|item| item.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|| absolute.clone());
        out.push(SkillR {
            id: absolute.clone(),
            name: parsed_name.unwrap_or(folder_name),
            description: truncate_desc(&parsed_desc.unwrap_or_default()),
            path: absolute,
            relative,
        });
    }
}

fn skill_parent_candidates(root: &Path) -> Vec<PathBuf> {
    let mut parents = vec![
        root.join(".agents").join("skills"),
        root.join(".cursor").join("skills"),
        root.join(".qoder").join("skills"),
    ];
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten().take(40) {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = path
                .file_name()
                .and_then(|item| item.to_str())
                .unwrap_or("");
            if name.starts_with('.') || name == "node_modules" || name == "target" {
                continue;
            }
            parents.push(path.join(".cursor").join("skills"));
            parents.push(path.join("src-tauri").join(".cursor").join("skills"));
            // apps/client/src-tauri/.cursor/skills
            if let Ok(children) = std::fs::read_dir(&path) {
                for child in children.flatten().take(30) {
                    let child_path = child.path();
                    if !child_path.is_dir() {
                        continue;
                    }
                    parents.push(child_path.join(".cursor").join("skills"));
                    parents.push(child_path.join("src-tauri").join(".cursor").join("skills"));
                }
            }
        }
    }
    parents
}

#[tauri::command(rename = "workspaceSkills:list")]
pub async fn workspaceSkillsList(params: ListSkillsP) -> CommandResult<Vec<SkillR>> {
    let roots: Vec<PathBuf> = params
        .roots
        .iter()
        .filter_map(|root| validate_root(root))
        .collect();
    let skills = tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        for root in roots {
            for parent in skill_parent_candidates(&root) {
                if parent.is_dir() {
                    collect_from_skills_dir(&root, &parent, &mut out, &mut seen);
                }
            }
        }
        out.sort_by(|a, b| {
            a.name
                .to_ascii_lowercase()
                .cmp(&b.name.to_ascii_lowercase())
        });
        out
    })
    .await
    .map_err(|err| Exception::Internal(format!("skills 扫描失败：{err}")))?;
    Ok(skills)
}
