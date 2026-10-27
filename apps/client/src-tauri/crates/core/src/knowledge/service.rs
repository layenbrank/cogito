//! 知识库服务：base/文档的增删查、staging 写入与发布、从磁盘回灌、检索。
//!
//! **不变量**
//! - 正文以**文件为准**：`knowledge_doc.content` 只是快照，`hash` 用来判断文件是否变过；
//! - 所有写入都经过本服务（app 是数据库唯一写者），agent 只能写 staging；
//! - 检索走 `search` 模块（FTS5 trigram + `<3` 字符 `LIKE` 回退）。
#![allow(non_snake_case)]

use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use chrono::Utc;
use cogito_database::entity::{
    knowledge_base as base_schema, knowledge_doc as doc_schema,
    knowledge_index_state as index_schema,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, Set,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::search::{self, Hit};
use super::text::{count_words, find_title, hash_content, slugify};
use crate::exception::Exception;

/// 默认知识库的固定 slug：启动时确保存在，用户不需要「先建一个库」。
const DEFAULT_SLUG: &str = "default";
const DEFAULT_NAME: &str = "默认知识库";
/// staging 放在知识库根目录下（各 base 目录的兄弟），发布才移进 base。
const STAGING_DIR: &str = ".staging";
/// 认作文档的扩展名。
const DOC_EXTENSIONS: [&str; 2] = ["md", "markdown"];

/// 发布冲突策略。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PublishMode {
    /// 覆盖同名文档（同一 slug）
    Replace,
    /// 保留两者：自动加 `-2` / `-3` 后缀
    #[serde(rename = "keepboth")]
    KeepBoth,
}

/// staging 里写好的一份草稿（还没进库、也没进正式目录）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedDoc {
    pub base_id: String,
    pub path: String,
    pub title: String,
    pub slug: String,
}

/// 文档摘要（列表页用，不带正文）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocSummary {
    pub id: String,
    pub base_id: String,
    pub title: String,
    pub rel_path: String,
    pub word_count: i64,
    pub revision: i64,
    pub status: String,
    pub source: String,
    pub updated_at: i64,
}

/// staging 目录里的一个草稿文件（待用户确认发布）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedFile {
    pub base_id: String,
    pub path: String,
    /// 文件名（去掉 `.md`），界面展示用
    pub name: String,
    /// 会话目录名，便于按来源分组与清理
    pub session: String,
    pub size: i64,
    pub modified_at: i64,
}

pub struct Service;

impl Service {
    /// 确保默认知识库存在（幂等）；`root` 是知识库总目录（各 base 的父目录）。
    pub async fn toEnsureDefaultBase(
        db: &DatabaseConnection,
        root: &Path,
    ) -> Result<base_schema::Model, Exception> {
        fs::create_dir_all(root)?;
        let root_path = fs::canonicalize(root)?;
        let existing = base_schema::Entity::find()
            .filter(base_schema::Column::Slug.eq(DEFAULT_SLUG))
            .one(db)
            .await?;
        let now = Utc::now().timestamp_millis();
        if let Some(existing) = existing {
            let wanted = root_path.join(DEFAULT_SLUG);
            fs::create_dir_all(&wanted)?;
            if existing.rootPath != wanted.to_string_lossy() {
                // 应用数据目录搬过：以当前路径为准（旧文件不自动搬，回灌时再扫）
                let mut active: base_schema::ActiveModel = existing.clone().into();
                active.rootPath = Set(wanted.to_string_lossy().into_owned());
                active.updatedAt = Set(now);
                return Ok(active.update(db).await?);
            }
            return Ok(existing);
        }

        let dir = root_path.join(DEFAULT_SLUG);
        fs::create_dir_all(&dir)?;
        let model = base_schema::Model {
            id: Uuid::new_v4().to_string(),
            name: DEFAULT_NAME.to_string(),
            slug: DEFAULT_SLUG.to_string(),
            description: None,
            scope: "user".to_string(),
            tenantID: None,
            rootPath: dir.to_string_lossy().into_owned(),
            autoUpdate: false,
            autoExport: false,
            citation: true,
            cloudModel: None,
            cloudDimensions: None,
            archivedAt: None,
            createdAt: now,
            updatedAt: now,
        };
        // 不用 `exec_with_returning`：TEXT 主键 + SQLite 下它要再发 SELECT，拿不到就报
        // "Failed to find inserted item"；直接把建好的 Model 返回更确定。
        base_schema::Entity::insert(base_schema::ActiveModel::from(model.clone()))
            .exec(db)
            .await?;
        Ok(model)
    }

    pub async fn toListBases(
        db: &DatabaseConnection,
    ) -> Result<Vec<base_schema::Model>, Exception> {
        Ok(base_schema::Entity::find()
            .filter(base_schema::Column::ArchivedAt.is_null())
            .order_by_asc(base_schema::Column::CreatedAt)
            .all(db)
            .await?)
    }

    /// 新建一个 base：目录 `<root>/<slug>`，slug 冲突时自动加 `-2`。
    pub async fn toCreateBase(
        db: &DatabaseConnection,
        name: &str,
        root: &Path,
    ) -> Result<base_schema::Model, Exception> {
        let name = name.trim();
        if name.is_empty() {
            return Err(Exception::Validation("知识库名称不能为空".to_string()));
        }
        fs::create_dir_all(root)?;
        let root_path = fs::canonicalize(root)?;
        let base_slug = slugify(name, 40);
        let mut slug = base_slug.clone();
        let mut attempt = 2;
        while base_schema::Entity::find()
            .filter(base_schema::Column::Slug.eq(slug.as_str()))
            .one(db)
            .await?
            .is_some()
        {
            slug = format!("{base_slug}-{attempt}");
            attempt += 1;
        }

        let dir = root_path.join(&slug);
        fs::create_dir_all(&dir)?;
        let now = Utc::now().timestamp_millis();
        let model = base_schema::Model {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            slug,
            description: None,
            scope: "user".to_string(),
            tenantID: None,
            rootPath: dir.to_string_lossy().into_owned(),
            autoUpdate: false,
            autoExport: false,
            citation: true,
            cloudModel: None,
            cloudDimensions: None,
            archivedAt: None,
            createdAt: now,
            updatedAt: now,
        };
        base_schema::Entity::insert(base_schema::ActiveModel::from(model.clone()))
            .exec(db)
            .await?;
        Ok(model)
    }

    pub async fn toListDocs(
        db: &DatabaseConnection,
        base_id: Option<&str>,
    ) -> Result<Vec<doc_schema::Model>, Exception> {
        let mut query = doc_schema::Entity::find()
            .filter(doc_schema::Column::ArchivedAt.is_null())
            .order_by_desc(doc_schema::Column::UpdatedAt);
        if let Some(base_id) = base_id {
            query = query.filter(doc_schema::Column::BaseId.eq(base_id));
        }
        Ok(query.all(db).await?)
    }

    pub async fn toReadDoc(
        db: &DatabaseConnection,
        id: &str,
    ) -> Result<Option<doc_schema::Model>, Exception> {
        Ok(doc_schema::Entity::find_by_id(id).one(db).await?)
    }

    pub async fn toFindDocByTitle(
        db: &DatabaseConnection,
        base_id: &str,
        title: &str,
    ) -> Result<Option<doc_schema::Model>, Exception> {
        Ok(doc_schema::Entity::find()
            .filter(doc_schema::Column::BaseId.eq(base_id))
            .filter(doc_schema::Column::Title.eq(title))
            .one(db)
            .await?)
    }

    /// 读正文：文件在就读文件（外部改过也立刻可见），读不到再退回快照。
    pub async fn toReadDocContent(
        db: &DatabaseConnection,
        doc: &doc_schema::Model,
    ) -> Result<String, Exception> {
        let base = Self::find_base(db, &doc.baseID).await?;
        let path = Path::new(&base.rootPath).join(&doc.relPath);
        match fs::read_to_string(&path) {
            Ok(content) => Ok(content),
            Err(_) => Ok(doc.content.clone()),
        }
    }

    pub async fn toSearch(
        db: &DatabaseConnection,
        query: &str,
        base_id: Option<&str>,
        top_k: usize,
    ) -> Result<Vec<Hit>, Exception> {
        search::search(db, query, base_id, top_k).await
    }

    /// 写 staging（agent 唯一被允许的写入点）：不落库、不进正式目录。
    pub async fn toWriteStaging(
        db: &DatabaseConnection,
        base_id: &str,
        session: &str,
        name: &str,
        content: &str,
    ) -> Result<StagedDoc, Exception> {
        let base = Self::find_base(db, base_id).await?;
        let root = Self::knowledge_root(&base)?;
        let dir = if session.trim().is_empty() {
            root.join(STAGING_DIR).join("agent")
        } else {
            root.join(STAGING_DIR).join(slugify(session, 40))
        };
        fs::create_dir_all(&dir)?;

        let slug = slugify(name, 60);
        let short = Uuid::new_v4().simple().to_string();
        let path = dir.join(format!("{slug}-{}.md", &short[..8]));
        fs::write(&path, content)?;

        Ok(StagedDoc {
            base_id: base.id,
            path: path.to_string_lossy().into_owned(),
            title: find_title(content, name),
            slug,
        })
    }

    /// 发布 staging → 正式目录 + 落库。只接受 staging 下的文件（越界直接拒）。
    pub async fn toPublish(
        db: &DatabaseConnection,
        base_id: &str,
        staging_path: &str,
        mode: PublishMode,
        source: &str,
    ) -> Result<doc_schema::Model, Exception> {
        let base = Self::find_base(db, base_id).await?;
        let staging_root = Self::staging_root(&base)?;
        let staging = fs::canonicalize(staging_path)
            .map_err(|error| Exception::Validation(format!("草稿不存在：{error}")))?;
        if !staging.starts_with(&staging_root) {
            return Err(Exception::Validation(
                "只能发布 staging 目录下的草稿".to_string(),
            ));
        }
        let content = fs::read_to_string(&staging)?;
        let title = find_title(&content, &base.name);
        let rel_path = Self::unique_rel_path(db, &base, &title, mode).await?;
        let target = Path::new(&base.rootPath).join(&rel_path);
        ensure_inside(&target, Path::new(&base.rootPath))?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target, &content)?;
        // 草稿已落正式目录，staging 副本清理失败不影响结果
        let _ = fs::remove_file(&staging);

        Self::upsert_from_content(db, &base, &rel_path, &content, source).await
    }

    /// 从磁盘回灌：新增/改动入库，文件已消失的行删掉。返回处理的文件数。
    pub async fn toRescanBase(
        db: &DatabaseConnection,
        base_id: &str,
    ) -> Result<usize, Exception> {
        let base = Self::find_base(db, base_id).await?;
        let root = PathBuf::from(&base.rootPath);
        fs::create_dir_all(&root)?;

        let mut seen: HashSet<String> = HashSet::new();
        let mut handled = 0;
        for path in collect_doc_files(&root)? {
            let Ok(rel_path) = path.strip_prefix(&root) else {
                continue;
            };
            let rel_path = rel_path.to_string_lossy().replace('\\', "/");
            let Ok(content) = fs::read_to_string(&path) else {
                // 非 UTF-8 / 读不动：跳过但保留旧快照
                continue;
            };
            seen.insert(rel_path.clone());
            Self::upsert_from_content(db, &base, &rel_path, &content, "import").await?;
            handled += 1;
        }

        let rows = doc_schema::Entity::find()
            .filter(doc_schema::Column::BaseId.eq(base_id))
            .all(db)
            .await?;
        for row in rows {
            if seen.contains(&row.relPath) {
                continue;
            }
            if root.join(&row.relPath).exists() {
                continue;
            }
            doc_schema::Entity::delete_by_id(row.id.clone())
                .exec(db)
                .await?;
        }
        Ok(handled)
    }

    /// 删除文档：文件 + 索引状态 + 行。文件删不掉（占用/权限）不阻断入库清理。
    pub async fn toRemoveDoc(db: &DatabaseConnection, id: &str) -> Result<u64, Exception> {
        let Some(doc) = Self::toReadDoc(db, id).await? else {
            return Ok(0);
        };
        if let Ok(base) = Self::find_base(db, &doc.baseID).await {
            let path = Path::new(&base.rootPath).join(&doc.relPath);
            let _ = fs::remove_file(path);
        }
        index_schema::Entity::delete_by_id(doc.id.clone())
            .exec(db)
            .await?;
        let result = doc_schema::Entity::delete_by_id(doc.id)
            .exec(db)
            .await?;
        Ok(result.rows_affected)
    }

    /// 文档摘要：列表页只要元数据，不把整篇正文带进渲染进程。
    pub async fn toListDocSummaries(
        db: &DatabaseConnection,
        base_id: Option<&str>,
    ) -> Result<Vec<DocSummary>, Exception> {
        let docs = Self::toListDocs(db, base_id).await?;
        Ok(docs
            .into_iter()
            .map(|doc| DocSummary {
                id: doc.id,
                base_id: doc.baseID,
                title: doc.title,
                rel_path: doc.relPath,
                word_count: doc.wordCount,
                revision: doc.revision,
                status: doc.status,
                source: doc.source,
                updated_at: doc.updatedAt,
            })
            .collect())
    }

    /// 知识库总目录（默认库目录的父目录）；新建 base 时用。
    pub async fn toResolveRoot(db: &DatabaseConnection) -> Result<PathBuf, Exception> {
        let bases = Self::toListBases(db).await?;
        if let Some(base) = bases.iter().find(|base| base.slug == DEFAULT_SLUG) {
            return Self::knowledge_root(base);
        }
        match bases.first() {
            Some(base) => Self::knowledge_root(base),
            None => Err(Exception::NotFound("还没有知识库".to_string())),
        }
    }

    /// 列出 staging 里的草稿（agent 生成、等用户确认发布）。
    pub async fn toListStaging(
        db: &DatabaseConnection,
        base_id: Option<&str>,
    ) -> Result<Vec<StagedFile>, Exception> {
        let bases = match base_id {
            Some(base_id) => vec![Self::find_base(db, base_id).await?],
            None => Self::toListBases(db).await?,
        };

        let mut files = Vec::new();
        for base in bases {
            let staging = Self::knowledge_root(&base)?.join(STAGING_DIR);
            if !staging.is_dir() {
                continue;
            }
            for path in collect_doc_files(&staging)? {
                let metadata = match fs::metadata(&path) {
                    Ok(metadata) => metadata,
                    Err(_) => continue,
                };
                let modified = metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map_or(0, |elapsed| elapsed.as_millis() as i64);
                // 会话目录名：`.staging/<session>/x.md`；直接放在 `.staging/` 下的归到 agent
                let session = path
                    .strip_prefix(&staging)
                    .ok()
                    .and_then(|rest| {
                        let mut parts = rest.components();
                        let first = parts.next()?.as_os_str().to_string_lossy().into_owned();
                        // 只剩文件本身一层时，它不是一个会话目录
                        parts.next().map(|_| first)
                    })
                    .unwrap_or_else(|| "agent".to_string());
                files.push(StagedFile {
                    base_id: base.id.clone(),
                    path: path.to_string_lossy().into_owned(),
                    name: path
                        .file_stem()
                        .map(|stem| stem.to_string_lossy().into_owned())
                        .unwrap_or_default(),
                    session,
                    size: metadata.len() as i64,
                    modified_at: modified,
                });
            }
        }
        files.sort_by(|left, right| right.modified_at.cmp(&left.modified_at));
        Ok(files)
    }

    /// 丢弃 staging 草稿（只允许删 staging 内的文件）。
    pub async fn toDiscardStaging(
        db: &DatabaseConnection,
        path: &str,
    ) -> Result<bool, Exception> {
        let target = fs::canonicalize(path)
            .map_err(|error| Exception::Validation(format!("草稿不存在：{error}")))?;
        for base in Self::toListBases(db).await? {
            let staging = Self::knowledge_root(&base)?.join(STAGING_DIR);
            let Ok(staging) = fs::canonicalize(staging) else {
                continue;
            };
            if target.starts_with(&staging) {
                fs::remove_file(&target)?;
                return Ok(true);
            }
        }
        Err(Exception::Validation(
            "只能丢弃 staging 目录下的草稿".to_string(),
        ))
    }

    async fn find_base(
        db: &DatabaseConnection,
        base_id: &str,
    ) -> Result<base_schema::Model, Exception> {
        base_schema::Entity::find_by_id(base_id)
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("知识库不存在：{base_id}")))
    }

    /// 知识库总目录 = 某个 base 目录的父目录（staging 与各 base 平级）。
    fn knowledge_root(base: &base_schema::Model) -> Result<PathBuf, Exception> {
        Path::new(&base.rootPath)
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| Exception::Validation("知识库目录缺少父目录".to_string()))
    }

    fn staging_root(base: &base_schema::Model) -> Result<PathBuf, Exception> {
        let root = Self::knowledge_root(base)?.join(STAGING_DIR);
        fs::create_dir_all(&root)?;
        fs::canonicalize(root).map_err(Exception::from)
    }

    async fn unique_rel_path(
        db: &DatabaseConnection,
        base: &base_schema::Model,
        title: &str,
        mode: PublishMode,
    ) -> Result<String, Exception> {
        let slug = slugify(title, 60);
        if mode == PublishMode::Replace {
            return Ok(format!("{slug}.md"));
        }
        let mut attempt = 1;
        loop {
            let candidate = if attempt == 1 {
                format!("{slug}.md")
            } else {
                format!("{slug}-{attempt}.md")
            };
            let taken = doc_schema::Entity::find()
                .filter(doc_schema::Column::BaseId.eq(base.id.as_str()))
                .filter(doc_schema::Column::RelPath.eq(candidate.as_str()))
                .one(db)
                .await?
                .is_some();
            if !taken && !Path::new(&base.rootPath).join(&candidate).exists() {
                return Ok(candidate);
            }
            attempt += 1;
            if attempt > 99 {
                return Err(Exception::Validation("同名文档过多，请改名后再发布".to_string()));
            }
        }
    }

    /// 落库（按 `baseId + relPath` 幂等）。hash 未变时不动 revision —— 回灌不该制造假变更。
    async fn upsert_from_content(
        db: &DatabaseConnection,
        base: &base_schema::Model,
        rel_path: &str,
        content: &str,
        source: &str,
    ) -> Result<doc_schema::Model, Exception> {
        let hash = hash_content(content.as_bytes());
        let now = Utc::now().timestamp_millis();
        let title = find_title(content, rel_path);
        let words = count_words(content);
        let size = content.len() as i64;

        let existing = doc_schema::Entity::find()
            .filter(doc_schema::Column::BaseId.eq(base.id.as_str()))
            .filter(doc_schema::Column::RelPath.eq(rel_path))
            .one(db)
            .await?;

        let model = match existing {
            Some(existing) => {
                if existing.hash == hash && existing.relPath == rel_path {
                    return Ok(existing);
                }
                let revision = existing.revision + 1;
                let mut active: doc_schema::ActiveModel = existing.into();
                active.title = Set(title);
                active.hash = Set(hash);
                active.content = Set(content.to_string());
                active.size = Set(size);
                active.wordCount = Set(words);
                active.revision = Set(revision);
                active.status = Set("published".to_string());
                active.source = Set(source.to_string());
                active.error = Set(None);
                active.updatedAt = Set(now);
                active.update(db).await?
            }
            None => {
                let model = doc_schema::Model {
                    id: Uuid::new_v4().to_string(),
                    baseID: base.id.clone(),
                    title,
                    relPath: rel_path.to_string(),
                    hash,
                    content: content.to_string(),
                    size,
                    wordCount: words,
                    revision: 1,
                    status: "published".to_string(),
                    source: source.to_string(),
                    error: None,
                    sessionID: None,
                    assetID: None,
                    assetHash: None,
                    archivedAt: None,
                    createdAt: now,
                    updatedAt: now,
                };
                doc_schema::Entity::insert(doc_schema::ActiveModel::from(model.clone()))
                    .exec(db)
                    .await?;
                model
            }
        };

        Self::touch_local_index_state(db, &model, now).await?;
        Ok(model)
    }

    async fn touch_local_index_state(
        db: &DatabaseConnection,
        doc: &doc_schema::Model,
        now: i64,
    ) -> Result<(), Exception> {
        let existing = index_schema::Entity::find_by_id(doc.id.clone())
            .one(db)
            .await?;
        match existing {
            Some(existing) => {
                let mut active: index_schema::ActiveModel = existing.into();
                active.localIndexedAt = Set(Some(now));
                active.updatedAt = Set(now);
                active.update(db).await?;
            }
            None => {
                let model = index_schema::ActiveModel {
                    docID: Set(doc.id.clone()),
                    baseID: Set(doc.baseID.clone()),
                    tenantID: Set(None),
                    localIndexedAt: Set(Some(now)),
                    cloudStatus: Set("idle".to_string()),
                    cloudAssetID: Set(None),
                    cloudAssetHash: Set(None),
                    cloudModel: Set(None),
                    cloudDimensions: Set(None),
                    cloudIndexedAt: Set(None),
                    lastError: Set(None),
                    createdAt: Set(now),
                    updatedAt: Set(now),
                };
                index_schema::Entity::insert(model).exec(db).await?;
            }
        }
        Ok(())
    }
}

/// 目标必须落在 root 内（父目录先 canonicalize，挡住 `..` 与 symlink 越界）。
fn ensure_inside(target: &Path, root: &Path) -> Result<(), Exception> {
    let root = fs::canonicalize(root)?;
    let Some(parent) = target.parent() else {
        return Err(Exception::Validation("目标路径缺少父目录".to_string()));
    };
    fs::create_dir_all(parent)?;
    let parent = fs::canonicalize(parent)?;
    let Some(name) = target.file_name() else {
        return Err(Exception::Validation("目标路径缺少文件名".to_string()));
    };
    if !parent.join(name).starts_with(&root) {
        return Err(Exception::Validation(format!(
            "{} 不在知识库目录内",
            target.display()
        )));
    }
    Ok(())
}

fn is_doc_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            DOC_EXTENSIONS
                .iter()
                .any(|known| known.eq_ignore_ascii_case(ext))
        })
}

/// 递归收集文档（跳过 staging：草稿不该被当成正文回灌）。
fn collect_doc_files(root: &Path) -> Result<Vec<PathBuf>, Exception> {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                if path.file_name().and_then(|name| name.to_str()) == Some(STAGING_DIR) {
                    continue;
                }
                stack.push(path);
                continue;
            }
            if is_doc_file(&path) {
                files.push(path);
            }
        }
    }
    files.sort();
    Ok(files)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use sea_orm::Database;

    use super::*;

    /// 每个用例独立目录：不共享磁盘状态，失败时也方便看现场。
    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "cogito-knowledge-{tag}-{}",
            Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&dir).expect("创建临时目录");
        dir
    }

    async fn fresh_db() -> Arc<DatabaseConnection> {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        let connection = Arc::new(db);
        cogito_database::migration::run(&connection)
            .await
            .expect("迁移应成功");
        connection
    }

    #[tokio::test]
    async fn ensure_default_base_is_idempotent() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("ensure");

        let first = Service::toEnsureDefaultBase(db, &root).await.expect("首次");
        let second = Service::toEnsureDefaultBase(db, &root).await.expect("再次");
        assert_eq!(first.id, second.id);
        assert_eq!(first.slug, "default");
        assert!(Path::new(&first.rootPath).is_dir());
    }

    #[tokio::test]
    async fn publish_then_search_hits_fts_and_like_fallback() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("search");
        let base = Service::toEnsureDefaultBase(db, &root).await.expect("默认库");
        let content = "# 知识库设计\n\n本文说明知识库的目录结构与写入不变量。";

        let staged = Service::toWriteStaging(db, &base.id, "s1", "知识库设计", content)
            .await
            .expect("写 staging");
        assert!(staged.path.replace('\\', "/").contains("/.staging/"));
        assert_eq!(staged.title, "知识库设计");

        let doc = Service::toPublish(db, &base.id, &staged.path, PublishMode::Replace, "agent")
            .await
            .expect("发布");
        assert_eq!(doc.status, "published");
        assert!(Path::new(&base.rootPath).join(&doc.relPath).exists());
        // staging 副本已清理
        assert!(!Path::new(&staged.path).exists());

        // 3 个字：FTS5 trigram 命中
        let hits = Service::toSearch(db, "知识库", None, 5).await.expect("检索");
        assert_eq!(hits.len(), 1, "FTS 应命中 1 篇");
        assert_eq!(hits[0].mode, "fts");
        assert_eq!(hits[0].doc_id, doc.id);
        assert!(!hits[0].snippet.is_empty());

        // 2 个字：trigram 查不到，必须回退 LIKE
        let short = Service::toSearch(db, "知识", None, 5).await.expect("短词检索");
        assert_eq!(short.len(), 1, "短词应靠 LIKE 命中");
        assert_eq!(short[0].mode, "like");
        assert!(short[0].snippet.contains("知识"));
    }

    #[tokio::test]
    async fn publish_rejects_paths_outside_staging() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("escape");
        let base = Service::toEnsureDefaultBase(db, &root).await.expect("默认库");

        let outside = root.join("escape.md");
        fs::write(&outside, "# 越界\n\n不在 staging 里").expect("写文件");
        let error = Service::toPublish(
            db,
            &base.id,
            &outside.to_string_lossy(),
            PublishMode::Replace,
            "agent",
        )
        .await
        .expect_err("必须拒绝 staging 之外的文件");
        assert!(error.to_string().contains("staging"));
    }

    #[tokio::test]
    async fn rescan_adds_new_file_and_drops_deleted() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("rescan");
        let base = Service::toEnsureDefaultBase(db, &root).await.expect("默认库");

        let file = Path::new(&base.rootPath).join("外部写入.md");
        fs::write(&file, "# 外部写入\n\n由编辑器直接落盘。").expect("写文件");
        let handled = Service::toRescanBase(db, &base.id).await.expect("回灌");
        assert_eq!(handled, 1);
        let docs = Service::toListDocs(db, Some(&base.id)).await.expect("列文档");
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].title, "外部写入");
        assert_eq!(docs[0].source, "import");

        fs::remove_file(&file).expect("删文件");
        Service::toRescanBase(db, &base.id).await.expect("再回灌");
        let docs = Service::toListDocs(db, Some(&base.id)).await.expect("列文档");
        assert!(docs.is_empty(), "文件消失后行应被清掉");
    }

    #[tokio::test]
    async fn unchanged_content_does_not_bump_revision() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("revision");
        let base = Service::toEnsureDefaultBase(db, &root).await.expect("默认库");
        let file = Path::new(&base.rootPath).join("稳定.md");
        fs::write(&file, "# 稳定\n\n内容不变。").expect("写文件");

        Service::toRescanBase(db, &base.id).await.expect("首次回灌");
        Service::toRescanBase(db, &base.id).await.expect("再次回灌");
        let docs = Service::toListDocs(db, Some(&base.id)).await.expect("列文档");
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].revision, 1, "内容没变不该制造新版本");

        fs::write(&file, "# 稳定\n\n内容变了。").expect("改写文件");
        Service::toRescanBase(db, &base.id).await.expect("第三次回灌");
        let docs = Service::toListDocs(db, Some(&base.id)).await.expect("列文档");
        assert_eq!(docs[0].revision, 2);
    }

    #[tokio::test]
    async fn staging_listing_groups_by_session_and_discard_only_inside_staging() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("staging-list");
        let base = Service::toEnsureDefaultBase(db, &root).await.expect("默认库");

        Service::toWriteStaging(db, &base.id, "s-alpha", "甲", "# 甲\n")
            .await
            .expect("写甲");
        Service::toWriteStaging(db, &base.id, "s-beta", "乙", "# 乙\n")
            .await
            .expect("写乙");

        let files = Service::toListStaging(db, Some(&base.id))
            .await
            .expect("列草稿");
        assert_eq!(files.len(), 2);
        let sessions: Vec<&str> = files.iter().map(|file| file.session.as_str()).collect();
        assert!(sessions.contains(&"s-alpha"));
        assert!(sessions.contains(&"s-beta"));
        assert!(files.iter().all(|file| file.size > 0));

        let victim = files
            .iter()
            .find(|file| file.session == "s-alpha")
            .expect("找到甲的草稿")
            .clone();
        assert!(Service::toDiscardStaging(db, &victim.path).await.expect("丢弃"));
        assert!(!Path::new(&victim.path).exists());
        assert_eq!(
            Service::toListStaging(db, Some(&base.id))
                .await
                .expect("再列草稿")
                .len(),
            1
        );

        // staging 之外的文件不允许「丢弃」
        let outside = Path::new(&base.rootPath).join("正式.md");
        fs::write(&outside, "# 正式\n").expect("写正式文件");
        let error = Service::toDiscardStaging(db, &outside.to_string_lossy())
            .await
            .expect_err("必须拒绝 staging 之外的文件");
        assert!(error.to_string().contains("staging"));
    }

    #[tokio::test]
    async fn doc_summaries_skip_content() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("summary");
        let base = Service::toEnsureDefaultBase(db, &root).await.expect("默认库");
        let file = Path::new(&base.rootPath).join("摘要.md");
        fs::write(&file, "# 摘要标题\n\n正文内容。").expect("写文件");
        Service::toRescanBase(db, &base.id).await.expect("回灌");

        let summaries = Service::toListDocSummaries(db, Some(&base.id))
            .await
            .expect("摘要");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].title, "摘要标题");
        assert_eq!(summaries[0].rel_path, "摘要.md");
        assert_eq!(summaries[0].status, "published");
        assert!(summaries[0].word_count > 0);
        // 摘要结构里根本没有正文字段：编不出来也就传不出去
        let json = serde_json::to_value(&summaries[0]).expect("序列化");
        assert!(json.get("content").is_none());
    }
}
