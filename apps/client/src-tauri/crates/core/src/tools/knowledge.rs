//! `app_knowledge_*`：知识库读取与 wiki 写入。
//!
//! 读：bases / docs / 单篇正文 / 检索（FTS5 trigram + 短词回退）。
//! 写：`write_doc` / `ingest` 经短暂 staging 缓冲后**立即发布**进库（Wiki 范式，无待发布 UI）。
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use serde_json::{Value, json};

use super::{Effect, ToolSpec, describe};
use crate::knowledge::{PublishMode, Service};
use cogito_database::entity::knowledge_base as base_schema;
use cogito_database::entity::knowledge_doc as doc_schema;

pub const LIST_BASES: &str = "app_knowledge_list_bases";
pub const LIST_DOCS: &str = "app_knowledge_list_docs";
pub const READ_DOC: &str = "app_knowledge_read_doc";
pub const READ_WIKI: &str = "app_knowledge_read_wiki";
pub const SEARCH: &str = "app_knowledge_search";
pub const LINT: &str = "app_knowledge_lint";
pub const INGEST: &str = "app_knowledge_ingest";
pub const WRITE_DOC: &str = "app_knowledge_write_doc";

/// 单篇正文默认/最大返回字符数：整篇倒进上下文没意义，也让模型学会分段读。
const DEFAULT_MAX_CHARS: usize = 8_000;
const HARD_MAX_CHARS: usize = 20_000;
/// 一次写 staging 的上限（字符）：更大的内容应该分章生成。
const HARD_MAX_WRITE_CHARS: usize = 200_000;
const DEFAULT_TOP_K: usize = 5;
const HARD_MAX_TOP_K: usize = 20;

#[must_use]
pub fn owns(name: &str) -> bool {
    name == LIST_BASES
        || name == LIST_DOCS
        || name == READ_DOC
        || name == READ_WIKI
        || name == SEARCH
        || name == LINT
        || name == INGEST
        || name == WRITE_DOC
}

#[must_use]
pub fn specs() -> Vec<ToolSpec> {
    vec![
        list_bases_spec(),
        list_docs_spec(),
        read_doc_spec(),
        read_wiki_spec(),
        search_spec(),
        lint_spec(),
        ingest_spec(),
        write_doc_spec(),
    ]
}

fn list_bases_spec() -> ToolSpec {
    describe(
        LIST_BASES,
        "列出本机知识库（base）及其文档数。撰写/整理文档前先用它确认目标库。",
        Effect::Read,
        json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false
        }),
    )
}

fn list_docs_spec() -> ToolSpec {
    describe(
        LIST_DOCS,
        "列出知识库文档（不含正文）。写新文档前用它做去重：同主题已有文档优先续写而不是新开一篇。",
        Effect::Read,
        json!({
            "type": "object",
            "properties": {
                "baseId": { "type": "string", "description": "只列该知识库；省略则列全部" }
            },
            "additionalProperties": false
        }),
    )
}

fn read_doc_spec() -> ToolSpec {
    describe(
        READ_DOC,
        "按 docID 或「baseId + title」读取一篇文档的正文（默认最多 8000 字符）。",
        Effect::Read,
        json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "文档 id（优先）" },
                "baseId": { "type": "string", "description": "配合 title 定位" },
                "title": { "type": "string", "description": "文档标题（精确匹配）" },
                "maxChars": { "type": "integer", "description": "返回上限，默认 8000，最大 20000" }
            },
            "additionalProperties": false
        }),
    )
}

fn read_wiki_spec() -> ToolSpec {
    describe(
        READ_WIKI,
        "读取 wiki/ 下的百科页（按相对路径或标题）。优先定位 wiki/ 前缀文档。",
        Effect::Read,
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "相对路径，如 wiki/index.md" },
                "title": { "type": "string", "description": "页面标题（精确匹配）" },
                "baseId": { "type": "string", "description": "配合 title/path 定位" },
                "maxChars": { "type": "integer", "description": "返回上限，默认 8000，最大 20000" }
            },
            "additionalProperties": false
        }),
    )
}

fn search_spec() -> ToolSpec {
    describe(
        SEARCH,
        "在本地知识库中检索（默认 FTS；返回 channels 元数据）。命中后再用 app_knowledge_read_doc / app_knowledge_read_wiki。",
        Effect::Read,
        json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "查询词；1–2 个字会走模糊匹配" },
                "baseId": { "type": "string", "description": "限定知识库；省略则全库检索" },
                "topK": { "type": "integer", "description": "返回条数，默认 5，最大 20" }
            },
            "required": ["query"],
            "additionalProperties": false
        }),
    )
}

fn lint_spec() -> ToolSpec {
    describe(
        LINT,
        "对知识库文档做结构 lint：扫描 [[wikilink]]，报告断链与孤儿页。",
        Effect::Read,
        json!({
            "type": "object",
            "properties": {
                "baseId": { "type": "string", "description": "限定知识库；省略则默认库" }
            },
            "additionalProperties": false
        }),
    )
}

fn ingest_spec() -> ToolSpec {
    describe(
        INGEST,
        "把 raw/sources 下的一份资料编译为 wiki 页并直接入库（写入 wiki/，覆盖同名）。",
        Effect::Write,
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "相对库根的源路径，如 raw/sources/foo.md" },
                "baseId": { "type": "string", "description": "目标知识库；省略用默认库" },
                "sessionId": { "type": "string", "description": "内部会话标识" }
            },
            "required": ["path"],
            "additionalProperties": false
        }),
    )
}

fn write_doc_spec() -> ToolSpec {
    describe(
        WRITE_DOC,
        "把一篇 Markdown 写入知识库 wiki（直接入库，覆盖同名 slug）。优先写 wiki 百科页，不要声称「仅草稿」。",
        Effect::Write,
        json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "文档名（用作文件名与标题回退）" },
                "content": { "type": "string", "description": "Markdown 正文" },
                "baseId": { "type": "string", "description": "目标知识库；省略用默认库" },
                "sessionId": { "type": "string", "description": "内部会话标识" }
            },
            "required": ["name", "content"],
            "additionalProperties": false
        }),
    )
}

pub async fn call(db: &DatabaseConnection, name: &str, arguments: &Value) -> Result<Value, String> {
    match name {
        LIST_BASES => list_bases(db).await,
        LIST_DOCS => list_docs(db, arguments).await,
        READ_DOC => read_doc(db, arguments).await,
        READ_WIKI => read_wiki(db, arguments).await,
        SEARCH => search(db, arguments).await,
        LINT => lint(db, arguments).await,
        INGEST => ingest(db, arguments).await,
        WRITE_DOC => write_doc(db, arguments).await,
        other => Err(format!("未知工具：{other}")),
    }
}

async fn list_bases(db: &DatabaseConnection) -> Result<Value, String> {
    let bases = Service::toListBases(db)
        .await
        .map_err(|error| error.to_string())?;
    let docs = doc_schema::Entity::find()
        .filter(doc_schema::Column::ArchivedAt.is_null())
        .all(db)
        .await
        .map_err(|error| error.to_string())?;

    let items: Vec<Value> = bases
        .into_iter()
        .map(|base| {
            let doc_count = docs.iter().filter(|doc| doc.baseID == base.id).count();
            json!({
                "id": base.id,
                "name": base.name,
                "slug": base.slug,
                "scope": base.scope,
                "rootPath": base.rootPath,
                "docCount": doc_count,
            })
        })
        .collect();
    Ok(json!({ "bases": items }))
}

async fn list_docs(db: &DatabaseConnection, arguments: &Value) -> Result<Value, String> {
    let base_id = arguments.get("baseId").and_then(Value::as_str);
    let docs = Service::toListDocs(db, base_id)
        .await
        .map_err(|error| error.to_string())?;
    let items: Vec<Value> = docs
        .into_iter()
        .map(|doc| {
            json!({
                "id": doc.id,
                "baseId": doc.baseID,
                "title": doc.title,
                "relPath": doc.relPath,
                "wordCount": doc.wordCount,
                "status": doc.status,
                "source": doc.source,
                "updatedAt": doc.updatedAt,
            })
        })
        .collect();
    Ok(json!({ "docs": items }))
}

async fn read_doc(db: &DatabaseConnection, arguments: &Value) -> Result<Value, String> {
    let limit = arguments
        .get("maxChars")
        .and_then(Value::as_u64)
        .map_or(DEFAULT_MAX_CHARS, |value| value as usize)
        .clamp(1, HARD_MAX_CHARS);

    let doc = match arguments.get("id").and_then(Value::as_str) {
        Some(id) => Service::toReadDoc(db, id)
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("文档不存在：{id}"))?,
        None => {
            let title = arguments
                .get("title")
                .and_then(Value::as_str)
                .ok_or_else(|| "需要 id 或 title".to_string())?;
            let base_id =
                resolve_base_id(db, arguments.get("baseId").and_then(Value::as_str)).await?;
            Service::toFindDocByTitle(db, &base_id, title)
                .await
                .map_err(|error| error.to_string())?
                .ok_or_else(|| format!("该知识库里没有标题为「{title}」的文档"))?
        }
    };

    let content = Service::toReadDocContent(db, &doc)
        .await
        .map_err(|error| error.to_string())?;
    let total_chars = content.chars().count();
    let truncated = total_chars > limit;
    let body: String = if truncated {
        content.chars().take(limit).collect()
    } else {
        content
    };

    Ok(json!({
        "id": doc.id,
        "baseId": doc.baseID,
        "title": doc.title,
        "relPath": doc.relPath,
        "wordCount": doc.wordCount,
        "revision": doc.revision,
        "totalChars": total_chars,
        "truncated": truncated,
        "content": body,
    }))
}

async fn search(db: &DatabaseConnection, arguments: &Value) -> Result<Value, String> {
    let query = arguments
        .get("query")
        .and_then(Value::as_str)
        .ok_or_else(|| "缺少参数 query".to_string())?;
    let top_k = arguments
        .get("topK")
        .and_then(Value::as_u64)
        .map_or(DEFAULT_TOP_K, |value| value as usize)
        .clamp(1, HARD_MAX_TOP_K);
    let hits = Service::toSearch(
        db,
        query,
        arguments.get("baseId").and_then(Value::as_str),
        top_k,
    )
    .await
    .map_err(|error| error.to_string())?;
    let mode = hits.first().map(|hit| hit.mode.clone()).unwrap_or_default();
    Ok(json!({
        "mode": mode,
        "channels": ["fts"],
        "vectorEnabled": false,
        "hits": hits
    }))
}

async fn read_wiki(db: &DatabaseConnection, arguments: &Value) -> Result<Value, String> {
    let limit = arguments
        .get("maxChars")
        .and_then(Value::as_u64)
        .map_or(DEFAULT_MAX_CHARS, |value| value as usize)
        .clamp(1, HARD_MAX_CHARS);

    if let Some(path) = arguments.get("path").and_then(Value::as_str) {
        let base_id = resolve_base_id(db, arguments.get("baseId").and_then(Value::as_str)).await?;
        let docs = Service::toListDocs(db, Some(&base_id))
            .await
            .map_err(|error| error.to_string())?;
        let needle = path.replace('\\', "/");
        let doc = docs
            .into_iter()
            .find(|doc| {
                let rel = doc.relPath.replace('\\', "/");
                rel.eq_ignore_ascii_case(&needle) || rel.ends_with(&needle)
            })
            .ok_or_else(|| format!("找不到 wiki 路径：{path}"))?;
        return read_doc(db, &json!({ "id": doc.id, "maxChars": limit as u64 })).await;
    }

    let mut args = arguments.clone();
    if let Some(obj) = args.as_object_mut() {
        obj.insert("maxChars".into(), json!(limit));
    }
    let mut result = read_doc(db, &args).await?;
    if let Some(rel) = result.get("relPath").and_then(Value::as_str) {
        let normalized = rel.replace('\\', "/");
        if !normalized.starts_with("wiki/") {
            return Err(format!("文档不在 wiki/ 下：{normalized}"));
        }
    }
    if let Some(obj) = result.as_object_mut() {
        obj.insert("layer".into(), json!("wiki"));
    }
    Ok(result)
}

async fn lint(db: &DatabaseConnection, arguments: &Value) -> Result<Value, String> {
    let base_id = resolve_base_id(db, arguments.get("baseId").and_then(Value::as_str)).await?;
    let docs = Service::toListDocs(db, Some(&base_id))
        .await
        .map_err(|error| error.to_string())?;

    let mut titles = std::collections::HashSet::new();
    let mut pages: Vec<(String, String, String)> = Vec::new();
    for doc in docs {
        let content = Service::toReadDocContent(db, &doc)
            .await
            .map_err(|error| error.to_string())?;
        titles.insert(doc.title.trim().to_lowercase());
        pages.push((doc.relPath.clone(), doc.title.clone(), content));
    }

    let mut issues = Vec::new();
    let mut inbound: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    for (rel, _title, content) in &pages {
        for link in parse_wikilinks(content) {
            let key = link.to_lowercase();
            *inbound.entry(key.clone()).or_insert(0) += 1;
            if !titles.contains(&key) {
                issues.push(json!({
                    "kind": "broken-link",
                    "page": rel,
                    "detail": format!("断链 [[{link}]]"),
                }));
            }
        }
    }

    for (rel, title, _) in &pages {
        let key = title.trim().to_lowercase();
        let is_index = rel.replace('\\', "/").ends_with("wiki/index.md")
            || title.eq_ignore_ascii_case("index");
        if inbound.get(&key).copied().unwrap_or(0) == 0 && !is_index {
            issues.push(json!({
                "kind": "orphan",
                "page": rel,
                "detail": "无入链（可能是孤儿页）",
            }));
        }
    }

    Ok(json!({ "issueCount": issues.len(), "issues": issues }))
}

async fn ingest(db: &DatabaseConnection, arguments: &Value) -> Result<Value, String> {
    let path = arguments
        .get("path")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "缺少参数 path".to_string())?;
    let base_id = resolve_base_id(db, arguments.get("baseId").and_then(Value::as_str)).await?;
    let bases = Service::toListBases(db)
        .await
        .map_err(|error| error.to_string())?;
    let base = bases
        .into_iter()
        .find(|item| item.id == base_id)
        .ok_or_else(|| format!("知识库不存在：{base_id}"))?;

    let absolute = std::path::PathBuf::from(&base.rootPath).join(path);
    if !absolute.is_file() {
        return Err(format!("源文件不存在：{}", absolute.display()));
    }
    let raw = std::fs::read_to_string(&absolute).map_err(|error| error.to_string())?;
    let title = absolute
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("ingest")
        .to_string();
    let summary: String = raw
        .chars()
        .filter(|ch| !ch.is_control() || *ch == '\n')
        .take(400)
        .collect();
    let content = format!(
        "---\ntitle: \"{title}\"\ntype: concept\nsources: [\"{path}\"]\n---\n\n# {title}\n\n> 由 app_knowledge_ingest 从 `{path}` 编译\n\n{summary}\n"
    );
    let session = arguments
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or("ingest");
    let staged = Service::toWriteStaging(db, &base_id, session, &title, &content)
        .await
        .map_err(|error| error.to_string())?;
    let published = publish(db, &base_id, &staged.path, PublishMode::Replace).await?;
    Ok(json!({
        "baseId": published.baseID,
        "docId": published.id,
        "title": published.title,
        "relPath": published.relPath,
        "source": path,
        "status": "published",
        "layer": "wiki",
    }))
}

async fn write_doc(db: &DatabaseConnection, arguments: &Value) -> Result<Value, String> {
    let name = arguments
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "缺少参数 name".to_string())?;
    let content = arguments
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| "缺少参数 content".to_string())?;
    if content.trim().is_empty() {
        return Err("content 不能为空".to_string());
    }
    if content.chars().count() > HARD_MAX_WRITE_CHARS {
        return Err(format!(
            "内容过长（> {HARD_MAX_WRITE_CHARS} 字符）：请分章生成，或先写大纲再逐章追加"
        ));
    }
    let base_id = resolve_base_id(db, arguments.get("baseId").and_then(Value::as_str)).await?;
    let session = arguments
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or("agent");

    let staged = Service::toWriteStaging(db, &base_id, session, name, content)
        .await
        .map_err(|error| error.to_string())?;
    let published = publish(db, &base_id, &staged.path, PublishMode::Replace).await?;
    Ok(json!({
        "baseId": published.baseID,
        "docId": published.id,
        "title": published.title,
        "relPath": published.relPath,
        "slug": staged.slug,
        "status": "published",
        "layer": "wiki",
    }))
}

fn parse_wikilinks(content: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes = content.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            i += 2;
            let start = i;
            while i + 1 < bytes.len() && !(bytes[i] == b']' && bytes[i + 1] == b']') {
                i += 1;
            }
            if i + 1 >= bytes.len() {
                break;
            }
            let inner = &content[start..i];
            let title = inner
                .split(['|', '#'])
                .next()
                .unwrap_or("")
                .trim();
            if !title.is_empty() {
                out.push(title.to_string());
            }
            i += 2;
            continue;
        }
        i += 1;
    }
    out
}

/// baseId 缺省时用默认库（slug=`default`，启动时已确保存在）。
async fn resolve_base_id(db: &DatabaseConnection, base_id: Option<&str>) -> Result<String, String> {
    if let Some(base_id) = base_id {
        return Ok(base_id.to_string());
    }
    base_schema::Entity::find()
        .filter(base_schema::Column::Slug.eq("default"))
        .one(db)
        .await
        .map_err(|error| error.to_string())?
        .map(|base| base.id)
        .ok_or_else(|| "还没有默认知识库（应用启动时会自动创建，请重启后再试）".to_string())
}

/// 供 UI 侧复用的发布入口（写正式目录 + 落库）。工具面**不**暴露它。
pub async fn publish(
    db: &DatabaseConnection,
    base_id: &str,
    staging_path: &str,
    mode: PublishMode,
) -> Result<doc_schema::Model, String> {
    use crate::dict::knowledge_doc_source;
    Service::toPublish(db, base_id, staging_path, mode, knowledge_doc_source::AGENT)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use sea_orm::Database;
    use uuid::Uuid;

    use super::*;

    /// 每个用例一套「内存库 + 独立知识库目录 + 默认库」。
    async fn setup(tag: &str) -> (Arc<DatabaseConnection>, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "cogito-tools-knowledge-{tag}-{}",
            Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&root).expect("临时目录");
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        let conn = Arc::new(db);
        cogito_database::migration::run(&conn)
            .await
            .expect("迁移应成功");
        Service::toEnsureDefaultBase(conn.as_ref(), &root)
            .await
            .expect("默认库");
        (conn, root)
    }

    #[tokio::test]
    async fn list_bases_exposes_default_with_doc_count() {
        let (conn, _root) = setup("bases").await;
        let db = conn.as_ref();
        let value = call(db, LIST_BASES, &json!({})).await.expect("列库");
        let bases = value.get("bases").and_then(Value::as_array).expect("bases");
        assert_eq!(bases.len(), 1);
        assert_eq!(bases[0]["slug"], "default");
        assert_eq!(bases[0]["docCount"], 0);
    }

    #[tokio::test]
    async fn write_doc_publishes_into_wiki() {
        let (conn, _root) = setup("publish-direct").await;
        let db = conn.as_ref();
        let value = call(
            db,
            WRITE_DOC,
            &json!({
                "name": "周报模板",
                "content": "# 周报模板\n\n## 本周完成\n",
                "sessionId": "s-1",
            }),
        )
        .await
        .expect("写 wiki");

        assert_eq!(value["status"], "published");
        assert_eq!(value["title"], "周报模板");
        let listed = call(db, LIST_DOCS, &json!({})).await.expect("列文档");
        assert_eq!(listed["docs"].as_array().expect("docs").len(), 1);
    }

    #[tokio::test]
    async fn search_and_read_after_write() {
        let (conn, _root) = setup("publish").await;
        let db = conn.as_ref();
        let base_id = Service::toListBases(db).await.expect("列库")[0].id.clone();
        let written = call(
            db,
            WRITE_DOC,
            &json!({
                "name": "发布契约",
                "content": "# 发布契约\n\n知识库正文以文件为准，数据库只存快照。",
                "baseId": base_id,
            }),
        )
        .await
        .expect("写 wiki");
        assert_eq!(written["status"], "published");

        let hits = call(db, SEARCH, &json!({ "query": "发布契约" }))
            .await
            .expect("检索");
        let list = hits["hits"].as_array().expect("hits");
        assert_eq!(list.len(), 1);
        assert_eq!(hits["mode"], "fts");

        let doc_id = list[0]["docId"].as_str().expect("docId");
        let doc = call(db, READ_DOC, &json!({ "id": doc_id, "maxChars": 12 }))
            .await
            .expect("读正文");
        assert_eq!(doc["truncated"], true);
        assert_eq!(
            doc["content"].as_str().expect("content").chars().count(),
            12
        );
        assert_eq!(doc["title"], "发布契约");
    }

    #[tokio::test]
    async fn short_query_still_hits_via_like() {
        let (conn, _root) = setup("short").await;
        let db = conn.as_ref();
        let base_id = Service::toListBases(db).await.expect("列库")[0].id.clone();
        call(
            db,
            WRITE_DOC,
            &json!({ "name": "会议纪要", "content": "# 会议纪要\n\n讨论了知识库方案。", "baseId": base_id }),
        )
        .await
        .expect("写 wiki");

        let hits = call(db, SEARCH, &json!({ "query": "知识" }))
            .await
            .expect("短词检索");
        assert_eq!(hits["mode"], "like");
        assert_eq!(hits["hits"].as_array().expect("hits").len(), 1);
    }
}
