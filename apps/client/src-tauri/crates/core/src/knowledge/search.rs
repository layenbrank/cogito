//! 本地检索：FTS5 trigram + BM25，`<3` 字符回退 `LIKE`。
//!
//! 为什么要回退：trigram 分词器要求查询至少 3 个字符，中文「周报」「会议」这种
//! 两字词在 FTS 里**必然 0 命中**，不是排序问题而是根本查不到。
//! 回退路径不排序（按更新时间），够用且可控；后续要更准再上 jieba + 倒排。
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement, Value};
use serde::{Deserialize, Serialize};

use crate::exception::Exception;

/// trigram 分词器能吃下的最小查询长度（字符数）。
const TRIGRAM_MIN_CHARS: usize = 3;
/// 查询长度上限：再长也没有区分度，只会拖慢 `LIKE`。
const MAX_QUERY_CHARS: usize = 128;
/// 摘要窗口：命中位置前后各取多少字符。
const SNIPPET_RADIUS: usize = 40;

/// 一条检索命中。`score` 为 bm25（越小越相关），`LIKE` 回退时恒为 0。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub doc_id: String,
    pub base_id: String,
    pub title: String,
    pub rel_path: String,
    pub snippet: String,
    pub score: f64,
    /// fts | like（前端可据此提示「短词走模糊匹配」）
    pub mode: String,
}

/// 清洗查询：去控制字符、压空白、限长。
#[must_use]
pub fn sanitize(query: &str) -> String {
    let collapsed = query
        .chars()
        .filter(|ch| !ch.is_control())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    collapsed.chars().take(MAX_QUERY_CHARS).collect()
}

/// 以命中位置为中心的摘要（`LIKE` 回退用）。
#[must_use]
pub fn make_snippet(content: &str, query: &str) -> String {
    let chars: Vec<char> = content.chars().collect();
    let needle: Vec<char> = query.to_lowercase().chars().collect();
    let hay: Vec<char> = content.to_lowercase().chars().collect();
    let position = if needle.is_empty() || hay.len() < needle.len() {
        None
    } else {
        hay.windows(needle.len())
            .position(|window| window == needle)
    };
    let start = position
        .map(|index| index.saturating_sub(SNIPPET_RADIUS))
        .unwrap_or(0);
    let end = start.saturating_add(SNIPPET_RADIUS * 2).min(chars.len());
    if start >= end {
        return String::new();
    }
    let mut snippet: String = chars[start..end].iter().collect();
    snippet = snippet.replace(['\n', '\r'], " ").trim().to_string();
    if start > 0 {
        snippet.insert(0, '…');
    }
    if end < chars.len() {
        snippet.push('…');
    }
    snippet
}

/// 搜一把：先 FTS，命中为空再 `LIKE`。
pub async fn search(
    db: &DatabaseConnection,
    query: &str,
    base_id: Option<&str>,
    top_k: usize,
) -> Result<Vec<Hit>, Exception> {
    let cleaned = sanitize(query);
    if cleaned.is_empty() || top_k == 0 {
        return Ok(Vec::new());
    }
    if cleaned.chars().count() >= TRIGRAM_MIN_CHARS {
        let hits = search_fts(db, &cleaned, base_id, top_k).await?;
        if !hits.is_empty() {
            return Ok(hits);
        }
    }
    search_like(db, &cleaned, base_id, top_k).await
}

async fn search_fts(
    db: &DatabaseConnection,
    query: &str,
    base_id: Option<&str>,
    top_k: usize,
) -> Result<Vec<Hit>, Exception> {
    // 包成短语：否则 FTS5 会把 `AND` / 引号当语法
    let phrase = format!("\"{}\"", query.replace('"', "\"\""));
    let mut sql = String::from(
        "SELECT d.id AS id, d.\"baseId\" AS baseId, d.title AS title, d.\"relPath\" AS relPath, \
         snippet(knowledge_doc_fts, -1, '', '', '…', 16) AS snippet, \
         bm25(knowledge_doc_fts) AS score \
         FROM knowledge_doc_fts \
         JOIN knowledge_doc d ON d.rowid = knowledge_doc_fts.rowid \
         WHERE knowledge_doc_fts MATCH ? AND d.\"archivedAt\" IS NULL",
    );
    let mut values = vec![Value::from(phrase)];
    if let Some(base_id) = base_id {
        sql.push_str(" AND d.\"baseId\" = ?");
        values.push(Value::from(base_id.to_string()));
    }
    sql.push_str(" ORDER BY score ASC LIMIT ?");
    values.push(Value::from(top_k as i64));

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Sqlite,
            sql,
            values,
        ))
        .await?;

    let mut hits = Vec::with_capacity(rows.len());
    for row in rows {
        hits.push(Hit {
            doc_id: row.try_get("", "id")?,
            base_id: row.try_get("", "baseId")?,
            title: row.try_get("", "title")?,
            rel_path: row.try_get("", "relPath")?,
            snippet: row.try_get("", "snippet").unwrap_or_default(),
            score: row.try_get("", "score").unwrap_or(0.0),
            mode: "fts".to_string(),
        });
    }
    Ok(hits)
}

async fn search_like(
    db: &DatabaseConnection,
    query: &str,
    base_id: Option<&str>,
    top_k: usize,
) -> Result<Vec<Hit>, Exception> {
    let pattern = format!(
        "%{}%",
        query
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    let mut sql = String::from(
        "SELECT id, \"baseId\" AS baseId, title, \"relPath\" AS relPath, content \
         FROM knowledge_doc WHERE \"archivedAt\" IS NULL",
    );
    let mut values: Vec<Value> = Vec::new();
    if let Some(base_id) = base_id {
        sql.push_str(" AND \"baseId\" = ?");
        values.push(Value::from(base_id.to_string()));
    }
    sql.push_str(" AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')");
    values.push(Value::from(pattern.clone()));
    values.push(Value::from(pattern));
    sql.push_str(" ORDER BY \"updatedAt\" DESC LIMIT ?");
    values.push(Value::from(top_k as i64));

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Sqlite,
            sql,
            values,
        ))
        .await?;

    let mut hits = Vec::with_capacity(rows.len());
    for row in rows {
        let content: String = row.try_get("", "content").unwrap_or_default();
        hits.push(Hit {
            doc_id: row.try_get("", "id")?,
            base_id: row.try_get("", "baseId")?,
            title: row.try_get("", "title")?,
            rel_path: row.try_get("", "relPath")?,
            snippet: make_snippet(&content, query),
            score: 0.0,
            mode: "like".to_string(),
        });
    }
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_collapses_and_truncates() {
        assert_eq!(sanitize("  周报 \n 2026 "), "周报 2026");
        assert_eq!(sanitize("\u{0}\u{7}").len(), 0);
        assert_eq!(sanitize(&"a".repeat(300)).chars().count(), MAX_QUERY_CHARS);
    }

    #[test]
    fn snippet_centers_on_hit() {
        let content = format!("{}命中{}", "前言".repeat(50), "后记".repeat(50));
        let snippet = make_snippet(&content, "命中");
        assert!(snippet.starts_with('…') && snippet.ends_with('…'));
        assert!(snippet.contains("命中"));
        assert!(snippet.chars().count() <= SNIPPET_RADIUS * 2 + 2);
    }

    #[test]
    fn snippet_without_hit_falls_back_to_head() {
        let snippet = make_snippet("只有一点点内容", "不存在的词");
        assert_eq!(snippet, "只有一点点内容");
    }
}
