//! 聚合页维护：`wiki/index.md`、`wiki/log.md`、`wiki/overview.md`。
//!
//! 聚合页由**应用**维护，模型不得写入。发布、归位、重建都调这里，
//! 保证 index 始终与磁盘上的页面一致（不再依赖前端单独实现一套）。

use std::fs;
use std::path::Path;

use chrono::Utc;

use super::wiki::WIKI_TYPES;
use crate::exception::Exception;

const INDEX_HEADER: &str =
    "---\ntitle: Index\ntype: index\n---\n\n# Index\n\n内容目录。由应用维护，按类型分组。\n";
const LOG_SEED: &str = "---\ntitle: Log\ntype: log\n---\n\n# Log\n\n## 操作记录\n";
const OVERVIEW_SEED: &str = "---\ntitle: Overview\ntype: overview\n---\n\n# Overview\n\n全局概要，随发布更新。\n\n## 最近更新\n";

/// index 里的一行。
pub struct IndexEntry {
    pub title: String,
    pub rel_path: String,
    pub page_type: String,
}

fn write_file(path: &Path, content: &str) -> Result<(), Exception> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, content)?;
    Ok(())
}

fn read_or_seed(path: &Path, seed: &str) -> Result<String, Exception> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(_) => {
            write_file(path, seed)?;
            Ok(seed.to_string())
        }
    }
}

/// 追加一条时序日志（幂等：同一条不重复写）。
pub fn to_append_log(root: &Path, line: &str) -> Result<(), Exception> {
    let path = root.join("wiki").join("log.md");
    let existing = read_or_seed(&path, LOG_SEED)?;
    let bullet = format!(
        "- {} {}",
        Utc::now().format("%Y-%m-%d %H:%M"),
        line.trim()
    );
    if existing.contains(&bullet) {
        return Ok(());
    }
    write_file(&path, &format!("{}\n{bullet}\n", existing.trim_end()))
}

/// 在 overview 的「最近更新」里挂一条链接（同一页不重复）。
pub fn to_touch_overview(root: &Path, title: &str) -> Result<(), Exception> {
    let path = root.join("wiki").join("overview.md");
    let mut existing = read_or_seed(&path, OVERVIEW_SEED)?;
    if !existing.contains("## 最近更新") {
        existing = format!("{}\n\n## 最近更新\n", existing.trim_end());
    }
    if existing.contains(&format!("[[{title}]]")) {
        return Ok(());
    }
    let line = format!("- {} [[{}]]", Utc::now().format("%Y-%m-%d"), title.trim());
    write_file(&path, &format!("{}\n{line}\n", existing.trim_end()))
}

fn type_order(page_type: &str) -> usize {
    WIKI_TYPES
        .iter()
        .position(|item| item.name == page_type)
        .unwrap_or(WIKI_TYPES.len())
}

/// 按「类型 → 标题」重建 index（整份覆盖，天然去重）。
pub fn to_rebuild_index(root: &Path, entries: &[IndexEntry]) -> Result<(), Exception> {
    let mut rows: Vec<(usize, &str, &IndexEntry)> = entries
        .iter()
        .map(|entry| {
            let order = type_order(&entry.page_type);
            let name = WIKI_TYPES
                .get(order)
                .map_or("other", |item| item.name);
            (order, name, entry)
        })
        .collect();
    rows.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then_with(|| left.2.title.cmp(&right.2.title))
    });

    let mut out = String::from(INDEX_HEADER);
    let mut current: Option<&str> = None;
    for (_, name, entry) in rows {
        if current != Some(name) {
            out.push_str(&format!("\n## {name}\n\n"));
            current = Some(name);
        }
        out.push_str(&format!(
            "- [[{}]] (`{}`)\n",
            entry.title,
            entry.rel_path.replace('\\', "/")
        ));
    }
    write_file(&root.join("wiki").join("index.md"), &out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "cogito-wiki-index-{tag}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&dir).expect("临时目录");
        dir
    }

    #[test]
    fn rebuild_groups_by_type_and_sorts() {
        let root = temp_root("rebuild");
        let entries = vec![
            IndexEntry {
                title: "Beta".into(),
                rel_path: "wiki/concepts/beta.md".into(),
                page_type: "concept".into(),
            },
            IndexEntry {
                title: "Alpha".into(),
                rel_path: "wiki/concepts/alpha.md".into(),
                page_type: "concept".into(),
            },
            IndexEntry {
                title: "OpenAI".into(),
                rel_path: "wiki/entities/openai.md".into(),
                page_type: "entity".into(),
            },
        ];
        to_rebuild_index(&root, &entries).expect("rebuild");
        let content = fs::read_to_string(root.join("wiki").join("index.md")).expect("index");
        assert!(content.contains("## entity"));
        assert!(content.contains("- [[OpenAI]] (`wiki/entities/openai.md`)"));
        let concept_block = &content[content.find("## concept").expect("concept")..];
        assert!(
            concept_block.find("[[Alpha]]").unwrap() < concept_block.find("[[Beta]]").unwrap()
        );
    }

    #[test]
    fn log_append_is_idempotent() {
        let root = temp_root("log");
        to_append_log(&root, "发布 [[甲]]").expect("log");
        let first = fs::read_to_string(root.join("wiki").join("log.md")).expect("log");
        to_append_log(&root, "发布 [[甲]]").expect("log again");
        let second = fs::read_to_string(root.join("wiki").join("log.md")).expect("log");
        assert_eq!(first, second);
    }
}
