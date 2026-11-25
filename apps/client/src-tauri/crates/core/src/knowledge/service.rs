//! 空间服务：space/文档的增删查、staging 写入与发布、从磁盘回灌、检索。
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
    knowledge_space as space_schema, knowledge_doc as doc_schema,
    knowledge_index_state as index_schema,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, Set,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::search::{self, Hit};
use super::text::{count_words, find_title, hash_content, slugify};
use crate::dict::{
    knowledge_space_scope, knowledge_cloud_status, knowledge_doc_source, knowledge_doc_status,
};
use crate::exception::Exception;

/// 默认空间的固定 slug：启动时确保存在，用户不需要「先建一个库」。
const DEFAULT_SLUG: &str = "default";
const DEFAULT_NAME: &str = "默认空间";
/// staging 放在空间根目录下（各 space 目录的兄弟），发布才移进 space。
const STAGING_DIR: &str = ".staging";
/// 认作文档的扩展名。
const DOC_EXTENSIONS: [&str; 2] = ["md", "markdown"];

/// 确保 LLM Wiki 三层目录与聚合页种子（幂等；已有文件不覆盖）。
/// `purpose.md` / `schema.md` 由前端场景模板写入，这里不落空白占位。
fn ensure_wiki_layout(root: &Path) -> Result<(), Exception> {
    // 分段 join：避免 Windows 上 `"raw/sources"` 整段带斜杠进 `\\?\` 路径
    fs::create_dir_all(root.join("raw").join("sources"))?;
    fs::create_dir_all(root.join("raw").join("parsed"))?;
    fs::create_dir_all(root.join("wiki").join("media"))?;
    fs::create_dir_all(root.join(".agent"))?;
    // 类型目录与 `wiki::WIKI_TYPES` 同源：新建页面按 type 直接落位，不再散在库根
    for page_type in super::wiki::WIKI_TYPES {
        if let Some(name) = page_type.dir.strip_prefix("wiki/") {
            fs::create_dir_all(root.join("wiki").join(name))?;
        }
    }
    write_seed_if_missing(
        &root.join("wiki").join("index.md"),
        "---\ntitle: Index\ntype: index\n---\n\n# Index\n\n内容目录。ingest 后由助手维护。\n",
    )?;
    write_seed_if_missing(
        &root.join("wiki").join("log.md"),
        "---\ntitle: Log\ntype: log\n---\n\n# Log\n\n## 操作记录\n\n",
    )?;
    write_seed_if_missing(
        &root.join("wiki").join("overview.md"),
        "---\ntitle: Overview\ntype: overview\n---\n\n# Overview\n\n全局概要，随 ingest 更新。\n",
    )?;
    Ok(())
}

fn write_seed_if_missing(path: &Path, content: &str) -> Result<(), Exception> {
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, content)?;
    Ok(())
}

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
    pub space_id: String,
    pub path: String,
    pub title: String,
    pub slug: String,
    /// 规范化后的页面类型（决定发布落点目录）
    pub page_type: String,
    /// 发布后的相对路径预览，如 `wiki/concepts/本地优先.md`
    pub rel_path: String,
}

/// 文档摘要（列表页用，不带正文）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocSummary {
    pub id: String,
    pub space_id: String,
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
    pub space_id: String,
    pub path: String,
    /// 文件名（去掉 `.md`），界面展示用
    pub name: String,
    /// 会话目录名，便于按来源分组与清理
    pub session: String,
    pub size: i64,
    pub modified_at: i64,
    /// frontmatter 里的标题；没有就退回文件名
    pub title: Option<String>,
    /// frontmatter 里的 type；待发布区分组用
    pub page_type: Option<String>,
    /// 发布后的目标相对路径（按 type 推导）
    pub rel_path: Option<String>,
}

/// 归位报告里的一条搬迁。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageMove {
    pub from: String,
    pub to: String,
    pub page_type: String,
    pub title: String,
}

/// 无法归位的页面及原因（只在报告里出现，不改动文件）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedPage {
    pub path: String,
    pub reason: String,
}

/// 存量归位报告：`dry_run` 时只列计划，不动磁盘。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    pub dry_run: bool,
    pub moves: Vec<PageMove>,
    pub skipped: Vec<SkippedPage>,
}

/// 编辑器的文档引用：打开时取一次，保存时用 `hash` 判断期间是否被别人改过。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocRef {
    /// 文件是否落在某个空间目录下；false = 按普通文件处理（不落库）
    pub matched: bool,
    pub doc_id: Option<String>,
    pub space_id: Option<String>,
    pub rel_path: Option<String>,
    pub hash: Option<String>,
    pub revision: Option<i64>,
}

/// 编辑器保存的结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteDocOutcome {
    pub matched: bool,
    /// 期间库内已被别处更新（与编辑器打开时的 hash 不一致）；本次**没有写盘**
    pub conflict: bool,
    pub doc: Option<DocSummary>,
    /// 冲突时给出库内当前 hash / revision，便于界面提示后重试
    pub hash: Option<String>,
    pub revision: Option<i64>,
}

/// 一篇文档的云端索引坐标（本地 doc_id ↔ 云端 asset_id）。
///
/// 云端检索按资产 id 命中，本地按 doc_id 命中；两路要对齐才能去重，这里就是那张对照表。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudDoc {
    pub doc_id: String,
    pub asset_id: String,
}

/// 一篇文档的云端索引状态：界面据此显示角标，同步流程据此决定该不该重传。
///
/// `status` 取 `idle` / `pending` / `running` / `succeeded` / `failed`
/// （与 `knowledge_index_state.cloud_status` 同一套字面量）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudState {
    pub doc_id: String,
    pub status: String,
    pub asset_id: Option<String>,
    pub indexed_at: Option<i64>,
    pub error: Option<String>,
}

/// 云端状态的写入项。`None` 表示「这次不动这一列」的例外只有 `indexed_at` /
/// `error` —— 它们是**上一次尝试**的痕迹，没给就该清掉，否则失败原因会一直挂着。
pub struct CloudPatch {
    pub status: String,
    pub asset_id: Option<String>,
    pub indexed_at: Option<i64>,
    pub error: Option<String>,
}

pub struct Service;

impl Service {
    /// 确保默认空间存在（幂等）；`root` 是空间总目录（各 space 的父目录）。
    pub async fn toEnsureDefaultSpace(
        db: &DatabaseConnection,
        root: &Path,
    ) -> Result<space_schema::Model, Exception> {
        fs::create_dir_all(root)?;
        let root_path = fs::canonicalize(root)?;
        let existing = space_schema::Entity::find()
            .filter(space_schema::Column::Slug.eq(DEFAULT_SLUG))
            .one(db)
            .await?;
        let now = Utc::now().timestamp_millis();
        if let Some(existing) = existing {
            let wanted = root_path.join(DEFAULT_SLUG);
            fs::create_dir_all(&wanted)?;
            let _ = ensure_wiki_layout(&wanted);
            if existing.root_path != wanted.to_string_lossy() {
                // 应用数据目录搬过：以当前路径为准（旧文件不自动搬，回灌时再扫）
                let mut active: space_schema::ActiveModel = existing.clone().into();
                active.root_path = Set(wanted.to_string_lossy().into_owned());
                active.updated_at = Set(now);
                return Ok(active.update(db).await?);
            }
            return Ok(existing);
        }

        let dir = root_path.join(DEFAULT_SLUG);
        fs::create_dir_all(&dir)?;
        ensure_wiki_layout(&dir)?;
        let model = space_schema::Model {
            id: Uuid::new_v4().to_string(),
            name: DEFAULT_NAME.to_string(),
            slug: DEFAULT_SLUG.to_string(),
            description: None,
            scope: knowledge_space_scope::USER.to_string(),
            tenant_id: None,
            root_path: dir.to_string_lossy().into_owned(),
            auto_update: false,
            auto_export: false,
            citation: true,
            cloud_model: None,
            cloud_dimensions: None,
            archived_at: None,
            created_at: now,
            updated_at: now,
        };
        // 不用 `exec_with_returning`：TEXT 主键 + SQLite 下它要再发 SELECT，拿不到就报
        // "Failed to find inserted item"；直接把建好的 Model 返回更确定。
        space_schema::Entity::insert(space_schema::ActiveModel::from(model.clone()))
            .exec(db)
            .await?;
        Ok(model)
    }

    pub async fn toListSpaces(
        db: &DatabaseConnection,
    ) -> Result<Vec<space_schema::Model>, Exception> {
        Ok(space_schema::Entity::find()
            .filter(space_schema::Column::ArchivedAt.is_null())
            .order_by_asc(space_schema::Column::CreatedAt)
            .all(db)
            .await?)
    }

    /// 新建一个 space：目录 `<root>/<slug>`，slug 冲突时自动加 `-2`。
    pub async fn toCreateSpace(
        db: &DatabaseConnection,
        name: &str,
        root: &Path,
    ) -> Result<space_schema::Model, Exception> {
        let name = name.trim();
        if name.is_empty() {
            return Err(Exception::Validation("空间名称不能为空".to_string()));
        }
        fs::create_dir_all(root)?;
        let root_path = fs::canonicalize(root)?;
        let space_slug = slugify(name, 40);
        let mut slug = space_slug.clone();
        let mut attempt = 2;
        while space_schema::Entity::find()
            .filter(space_schema::Column::Slug.eq(slug.as_str()))
            .one(db)
            .await?
            .is_some()
        {
            slug = format!("{space_slug}-{attempt}");
            attempt += 1;
        }

        let dir = root_path.join(&slug);
        fs::create_dir_all(&dir)?;
        ensure_wiki_layout(&dir)?;
        let now = Utc::now().timestamp_millis();
        let model = space_schema::Model {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            slug,
            description: None,
            scope: knowledge_space_scope::USER.to_string(),
            tenant_id: None,
            root_path: dir.to_string_lossy().into_owned(),
            auto_update: false,
            auto_export: false,
            citation: true,
            cloud_model: None,
            cloud_dimensions: None,
            archived_at: None,
            created_at: now,
            updated_at: now,
        };
        space_schema::Entity::insert(space_schema::ActiveModel::from(model.clone()))
            .exec(db)
            .await?;
        Ok(model)
    }

    /// 改库级选项（`auto_update` / `auto_export` / `citation`）：三者都可缺省，传 `None` 表示不动。
    ///
    /// 这些选项眼下只影响**本机行为**（面板打开时自动回灌、发布后另存 HTML、生成带引用），
    /// 所以不触碰文档与索引，只更新这一行。
    pub async fn toUpdateSpace(
        db: &DatabaseConnection,
        space_id: &str,
        auto_update: Option<bool>,
        auto_export: Option<bool>,
        citation: Option<bool>,
    ) -> Result<space_schema::Model, Exception> {
        let existing = Self::find_space(db, space_id).await?;
        let mut active: space_schema::ActiveModel = existing.into();
        if let Some(value) = auto_update {
            active.auto_update = Set(value);
        }
        if let Some(value) = auto_export {
            active.auto_export = Set(value);
        }
        if let Some(value) = citation {
            active.citation = Set(value);
        }
        active.updated_at = Set(Utc::now().timestamp_millis());
        Ok(active.update(db).await?)
    }

    pub async fn toListDocs(
        db: &DatabaseConnection,
        space_id: Option<&str>,
    ) -> Result<Vec<doc_schema::Model>, Exception> {
        let mut query = doc_schema::Entity::find()
            .filter(doc_schema::Column::ArchivedAt.is_null())
            .order_by_desc(doc_schema::Column::UpdatedAt);
        if let Some(space_id) = space_id {
            query = query.filter(doc_schema::Column::SpaceId.eq(space_id));
        }
        Ok(query.all(db).await?)
    }

    /// 已建好云端索引的文档（`cloud_status=succeeded` 且有 asset_id）。
    ///
    /// 只给**可用**的那些：在途、失败、「模型换了」的文档进不去云端召回，
    /// 把它们混进来只会让 `assetIDs` 变长而召回不变。
    pub async fn toListCloudDocs(
        db: &DatabaseConnection,
        space_id: Option<&str>,
    ) -> Result<Vec<CloudDoc>, Exception> {
        let mut query = index_schema::Entity::find()
            .filter(index_schema::Column::CloudStatus.eq(knowledge_cloud_status::SUCCEEDED))
            .filter(index_schema::Column::CloudAssetId.is_not_null());
        if let Some(space_id) = space_id {
            query = query.filter(index_schema::Column::SpaceId.eq(space_id));
        }
        let rows = query.all(db).await?;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                row.cloud_asset_id.map(|asset_id| CloudDoc {
                    doc_id: row.doc_id,
                    asset_id,
                })
            })
            .collect())
    }

    pub async fn toReadDoc(
        db: &DatabaseConnection,
        id: &str,
    ) -> Result<Option<doc_schema::Model>, Exception> {
        Ok(doc_schema::Entity::find_by_id(id).one(db).await?)
    }

    pub async fn toFindDocByTitle(
        db: &DatabaseConnection,
        space_id: &str,
        title: &str,
    ) -> Result<Option<doc_schema::Model>, Exception> {
        Ok(doc_schema::Entity::find()
            .filter(doc_schema::Column::SpaceId.eq(space_id))
            .filter(doc_schema::Column::Title.eq(title))
            .one(db)
            .await?)
    }

    /// 读正文：文件在就读文件（外部改过也立刻可见），读不到再退回快照。
    pub async fn toReadDocContent(
        db: &DatabaseConnection,
        doc: &doc_schema::Model,
    ) -> Result<String, Exception> {
        let space = Self::find_space(db, &doc.space_id).await?;
        let path = Path::new(&space.root_path).join(&doc.rel_path);
        match fs::read_to_string(&path) {
            Ok(content) => Ok(content),
            Err(_) => Ok(doc.content.clone()),
        }
    }

    pub async fn toSearch(
        db: &DatabaseConnection,
        query: &str,
        space_id: Option<&str>,
        top_k: usize,
    ) -> Result<Vec<Hit>, Exception> {
        search::search(db, query, space_id, top_k).await
    }

    /// 整包导出：把一个库的 Markdown 打成一个 zip，写到 `<库目录>/exports/` 下。
    ///
    /// 正文取**文件**（读不到再用快照），与「文件为准」的不变量一致；
    /// 不压缩（store-only）：库里多是文本，压缩收益有限，而 store 模式任何工具都能打开。
    pub async fn toExportBundle(
        db: &DatabaseConnection,
        space_id: &str,
    ) -> Result<PathBuf, Exception> {
        let space = Self::find_space(db, space_id).await?;
        let root = Self::knowledge_root(&space)?;
        let dir = root.join("exports");
        fs::create_dir_all(&dir)?;

        let docs = doc_schema::Entity::find()
            .filter(doc_schema::Column::SpaceId.eq(space_id))
            .order_by_asc(doc_schema::Column::RelPath)
            .all(db)
            .await?;
        if docs.is_empty() {
            return Err(Exception::Validation("这个库还没有文档可导出".to_string()));
        }

        let stamp = Utc::now().format("%Y%m%d-%H%M%S");
        let path = dir.join(format!("{}-{stamp}.zip", space.slug));
        let file = fs::File::create(&path)?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);

        for doc in &docs {
            // 压缩包内用相对路径还原目录结构，解压后与库目录同形
            let entry = doc.rel_path.replace('\\', "/");
            let content = match fs::read_to_string(Path::new(&space.root_path).join(&doc.rel_path)) {
                Ok(content) => content,
                Err(_) => doc.content.clone(),
            };
            zip.start_file(entry, options)
                .map_err(|error| Exception::Internal(format!("写压缩包失败：{error}")))?;
            use std::io::Write;
            zip.write_all(content.as_bytes())?;
        }
        zip.finish()
            .map_err(|error| Exception::Internal(format!("收尾压缩包失败：{error}")))?;
        Ok(path)
    }

    /// 写 staging（agent 唯一被允许的写入点）：不落库、不进正式目录。
    ///
    /// 写盘前先过 `wiki::normalize`：frontmatter（type/title/updated）与标题层级
    /// 在这一步就补齐，待发布区才能按 type 分组，发布时也不会再出现「无 type / untitled」。
    pub async fn toWriteStaging(
        db: &DatabaseConnection,
        space_id: &str,
        session: &str,
        name: &str,
        content: &str,
        type_hint: Option<&str>,
        title_hint: Option<&str>,
    ) -> Result<StagedDoc, Exception> {
        let space = Self::find_space(db, space_id).await?;
        let root = Self::knowledge_root(&space)?;
        let page = super::wiki::normalize(super::wiki::PageInput {
            name,
            content,
            type_hint,
            title_hint,
        })?;

        let dir = if session.trim().is_empty() {
            root.join(STAGING_DIR).join("agent")
        } else {
            root.join(STAGING_DIR).join(slugify(session, 40))
        };
        fs::create_dir_all(&dir)?;

        let short = Uuid::new_v4().simple().to_string();
        let path = dir.join(format!("{}-{}.md", page.slug, &short[..8]));
        fs::write(&path, &page.content)?;

        Ok(StagedDoc {
            space_id: space.id,
            path: path.to_string_lossy().into_owned(),
            title: page.title,
            slug: page.slug,
            page_type: page.page_type,
            rel_path: page.rel_path,
        })
    }

    /// 发布 staging → 正式目录 + 落库。只接受 staging 下的文件（越界直接拒）。
    ///
    /// 落点是 `wiki/<type>/<slug>.md`（由 `wiki::normalize` 推导），
    /// 同名页视为**更新该页**；发布后维护 index / log / overview。
    pub async fn toPublish(
        db: &DatabaseConnection,
        space_id: &str,
        staging_path: &str,
        mode: PublishMode,
        source: &str,
    ) -> Result<doc_schema::Model, Exception> {
        let space = Self::find_space(db, space_id).await?;
        let doc = Self::to_publish_page(db, &space, staging_path, mode, source).await?;
        Self::toRebuildIndex(db, &space.id).await?;
        Ok(doc)
    }

    /// 批量发布：逐页落盘，索引只重建一次（多章生成的主路径）。
    pub async fn toPublishBatch(
        db: &DatabaseConnection,
        space_id: &str,
        staging_paths: &[String],
        mode: PublishMode,
        source: &str,
    ) -> Result<Vec<doc_schema::Model>, Exception> {
        if staging_paths.is_empty() {
            return Err(Exception::Validation("没有可发布的草稿".to_string()));
        }
        let space = Self::find_space(db, space_id).await?;
        let mut docs = Vec::with_capacity(staging_paths.len());
        for path in staging_paths {
            docs.push(Self::to_publish_page(db, &space, path, mode, source).await?);
        }
        Self::toRebuildIndex(db, &space.id).await?;
        Ok(docs)
    }

    async fn to_publish_page(
        db: &DatabaseConnection,
        space: &space_schema::Model,
        staging_path: &str,
        mode: PublishMode,
        source: &str,
    ) -> Result<doc_schema::Model, Exception> {
        let staging_root = Self::staging_root(space)?;
        let staging = fs::canonicalize(staging_path)
            .map_err(|error| Exception::Validation(format!("草稿不存在：{error}")))?;
        if !staging.starts_with(&staging_root) {
            return Err(Exception::Validation(
                "只能发布 staging 目录下的草稿".to_string(),
            ));
        }

        let raw = fs::read_to_string(&staging)?;
        let stem = staging
            .file_stem()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_default();
        let page = super::wiki::normalize(super::wiki::PageInput {
            name: &stem,
            content: &raw,
            type_hint: None,
            title_hint: None,
        })?;

        let root = Path::new(&space.root_path);
        let rel_path = Self::unique_rel_path(db, space, &page.rel_path, mode).await?;
        let target = root.join(&rel_path);
        ensure_inside(&target, root)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target, &page.content)?;
        // 草稿已落正式目录，staging 副本清理失败不影响结果
        let _ = fs::remove_file(&staging);

        let doc = Self::upsert_from_content(db, space, &rel_path, &page.content, source).await?;
        super::wiki_index::to_append_log(root, &format!("发布 [[{}]] (`{rel_path}`)", page.title))?;
        super::wiki_index::to_touch_overview(root, &page.title)?;
        Ok(doc)
    }

    /// 按 DB 现状整份重建 `wiki/index.md`（发布 / 归位后调用）。
    pub async fn toRebuildIndex(
        db: &DatabaseConnection,
        space_id: &str,
    ) -> Result<usize, Exception> {
        let space = Self::find_space(db, space_id).await?;
        let docs = Self::toListDocs(db, Some(space_id)).await?;
        let entries: Vec<super::wiki_index::IndexEntry> = docs
            .into_iter()
            .filter(|doc| !super::wiki::is_aggregate_path(&doc.rel_path))
            .filter(|doc| doc.rel_path.replace('\\', "/").starts_with("wiki/"))
            .map(|doc| {
                let (page_type, _) = super::wiki::to_read_meta(&doc.content);
                super::wiki_index::IndexEntry {
                    title: doc.title,
                    rel_path: doc.rel_path,
                    page_type: page_type.unwrap_or_else(|| super::wiki::DEFAULT_TYPE.to_string()),
                }
            })
            .collect();
        super::wiki_index::to_rebuild_index(Path::new(&space.root_path), &entries)?;
        Ok(entries.len())
    }

    /// 存量归位：把库根散落的页面、放错类型目录的页，挪进 `wiki/<type>/`。
    ///
    /// `dry_run` 只出报告、不动磁盘。执行时顺手按规范规范化 frontmatter，
    /// 然后重建 index —— 老版本 agent 直接把页面写在库根，不归位会一直是孤儿页。
    pub async fn toMigrateLayout(
        db: &DatabaseConnection,
        space_id: &str,
        dry_run: bool,
    ) -> Result<MigrationReport, Exception> {
        let space = Self::find_space(db, space_id).await?;
        let root = PathBuf::from(&space.root_path);
        let docs = Self::toListDocs(db, Some(space_id)).await?;
        let fallback_type = super::wiki::find_wiki_type(super::wiki::DEFAULT_TYPE)
            .ok_or_else(|| Exception::Internal("默认类型缺失".to_string()))?;
        let mut report = MigrationReport {
            dry_run,
            ..MigrationReport::default()
        };

        for doc in docs {
            let rel = doc.rel_path.replace('\\', "/");
            if super::wiki::is_aggregate_path(&rel) {
                continue;
            }
            let lower = rel.to_ascii_lowercase();
            if !lower.ends_with(".md") && !lower.ends_with(".markdown") {
                report.skipped.push(SkippedPage {
                    path: rel,
                    reason: "不是 Markdown，归位只管 wiki 页".to_string(),
                });
                continue;
            }
            if rel.starts_with("raw/") || rel.starts_with(".agent/") || rel.starts_with("exports/")
            {
                continue;
            }

            let path = root.join(&doc.rel_path);
            let content = fs::read_to_string(&path).unwrap_or_else(|_| doc.content.clone());
            let (hint_type, meta_title) = super::wiki::to_read_meta(&content);
            let in_wiki = rel.starts_with("wiki/");
            let page_type = hint_type
                .as_deref()
                .and_then(super::wiki::find_wiki_type)
                .or_else(|| find_type_by_dir(&rel))
                .unwrap_or(fallback_type);

            let title = meta_title
                .or_else(|| Some(doc.title.trim().to_string()).filter(|value| !value.is_empty()))
                .unwrap_or_else(|| rel.clone());
            let stem = if in_wiki {
                Path::new(&rel)
                    .file_stem()
                    .map(|value| value.to_string_lossy().into_owned())
                    .unwrap_or_else(|| slugify(&title, 60))
            } else {
                slugify(&title, 60)
            };
            if format!("{}/{stem}.md", page_type.dir) == rel {
                continue;
            }

            let page = match super::wiki::normalize(super::wiki::PageInput {
                name: &stem,
                content: &content,
                type_hint: Some(page_type.name),
                title_hint: Some(title.as_str()),
            }) {
                Ok(page) => page,
                Err(error) => {
                    report.skipped.push(SkippedPage {
                        path: rel,
                        reason: error.to_string(),
                    });
                    continue;
                }
            };

            let target =
                Self::unique_rel_path(db, &space, &page.rel_path, PublishMode::KeepBoth).await?;
            report.moves.push(PageMove {
                from: rel.clone(),
                to: target.clone(),
                page_type: page.page_type.clone(),
                title: page.title.clone(),
            });
            if dry_run {
                continue;
            }

            let target_path = root.join(&target);
            ensure_inside(&target_path, &root)?;
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&target_path, &page.content)?;
            if path != target_path {
                let _ = fs::remove_file(&path);
            }

            let mut active: doc_schema::ActiveModel = doc.into();
            active.rel_path = Set(target);
            active.title = Set(page.title);
            active.updated_at = Set(Utc::now().timestamp_millis());
            active.update(db).await?;
        }

        if !dry_run {
            Self::toRebuildIndex(db, space_id).await?;
        }
        Ok(report)
    }

    /// 从磁盘回灌：新增/改动入库，文件已消失的行删掉。返回处理的文件数。
    pub async fn toRescanSpace(db: &DatabaseConnection, space_id: &str) -> Result<usize, Exception> {
        let space = Self::find_space(db, space_id).await?;
        let root = PathBuf::from(&space.root_path);
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
            Self::upsert_from_content(db, &space, &rel_path, &content, knowledge_doc_source::IMPORT)
                .await?;
            handled += 1;
        }

        let rows = doc_schema::Entity::find()
            .filter(doc_schema::Column::SpaceId.eq(space_id))
            .all(db)
            .await?;
        for row in rows {
            if seen.contains(&row.rel_path) {
                continue;
            }
            if root.join(&row.rel_path).exists() {
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
        if let Ok(space) = Self::find_space(db, &doc.space_id).await {
            let path = Path::new(&space.root_path).join(&doc.rel_path);
            let _ = fs::remove_file(path);
        }
        index_schema::Entity::delete_by_id(doc.id.clone())
            .exec(db)
            .await?;
        let result = doc_schema::Entity::delete_by_id(doc.id).exec(db).await?;
        Ok(result.rows_affected)
    }

    /// 删除整个空间：索引状态 + 文档行 + 库行；`purge_files` 为真时连目录一起删。
    ///
    /// 文件默认**保留**：空间正文是用户磁盘上的 Markdown，误点一次就把整个目录清掉
    /// 是不可接受的风险。要连文件一起删必须由调用方显式传 `purge_files`，UI 侧再二次确认。
    pub async fn toRemoveKnowledge(
        db: &DatabaseConnection,
        space_id: &str,
        purge_files: bool,
    ) -> Result<u64, Exception> {
        let space = Self::find_space(db, space_id).await?;
        index_schema::Entity::delete_many()
            .filter(index_schema::Column::SpaceId.eq(space_id))
            .exec(db)
            .await?;
        doc_schema::Entity::delete_many()
            .filter(doc_schema::Column::SpaceId.eq(space_id))
            .exec(db)
            .await?;
        let result = space_schema::Entity::delete_by_id(space.id).exec(db).await?;
        if purge_files {
            // 删目录失败（占用 / 权限）不阻断入库清理
            let _ = fs::remove_dir_all(&space.root_path);
        }
        Ok(result.rows_affected)
    }

    /// 一篇文档的云端索引状态；没有行就是 `idle`（从未同步过）。
    ///
    /// 与 `toListCloudStates` 的区别：那个给列表画角标，这个给单篇回写之后确认结果。
    pub async fn toFindCloudState(
        db: &DatabaseConnection,
        doc_id: &str,
    ) -> Result<Option<CloudState>, Exception> {
        let row = index_schema::Entity::find_by_id(doc_id.to_string())
            .one(db)
            .await?;
        Ok(row.map(Self::to_cloud_state))
    }

    /// 一个库（或全部）的云端索引状态。
    ///
    /// 只回**有状态行**的文档：没有行就是 `idle`，让界面自己当默认值，
    /// 免得每次列表都把每篇文档撮一遍可能不存在的记录。
    pub async fn toListCloudStates(
        db: &DatabaseConnection,
        space_id: Option<&str>,
    ) -> Result<Vec<CloudState>, Exception> {
        let mut query = index_schema::Entity::find();
        if let Some(space_id) = space_id {
            query = query.filter(index_schema::Column::SpaceId.eq(space_id));
        }
        let rows = query.all(db).await?;
        Ok(rows.into_iter().map(Self::to_cloud_state).collect())
    }

    /// 写回一篇文档的云端索引状态（没有行就建）。
    ///
    /// 不从入参拿 `space_id`：它由文档行决定，客户端传错只会把状态挂到别的库上。
    pub async fn toSetCloudState(
        db: &DatabaseConnection,
        doc_id: &str,
        patch: CloudPatch,
    ) -> Result<CloudState, Exception> {
        let doc = doc_schema::Entity::find_by_id(doc_id)
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("文档不存在：{doc_id}")))?;
        let now = Utc::now().timestamp_millis();
        let existing = index_schema::Entity::find_by_id(doc_id.to_string())
            .one(db)
            .await?;

        let row = match existing {
            Some(current) => {
                let mut active: index_schema::ActiveModel = current.into();
                active.cloud_status = Set(patch.status);
                active.cloud_asset_id = Set(patch.asset_id);
                active.cloud_indexed_at = Set(patch.indexed_at);
                active.last_error = Set(patch.error);
                active.updated_at = Set(now);
                active.update(db).await?
            }
            None => {
                let model = index_schema::Model {
                    doc_id: doc_id.to_string(),
                    space_id: doc.space_id.clone(),
                    tenant_id: None,
                    local_indexed_at: None,
                    cloud_status: patch.status,
                    cloud_asset_id: patch.asset_id,
                    cloud_asset_hash: None,
                    cloud_model: None,
                    cloud_dimensions: None,
                    cloud_indexed_at: patch.indexed_at,
                    last_error: patch.error,
                    created_at: now,
                    updated_at: now,
                };
                index_schema::Entity::insert(index_schema::ActiveModel::from(model.clone()))
                    .exec(db)
                    .await?;
                model
            }
        };
        Ok(Self::to_cloud_state(row))
    }

    fn to_cloud_state(row: index_schema::Model) -> CloudState {
        CloudState {
            doc_id: row.doc_id,
            status: row.cloud_status,
            asset_id: row.cloud_asset_id,
            indexed_at: row.cloud_indexed_at,
            error: row.last_error,
        }
    }

    /// 文档摘要：列表页只要元数据，不把整篇正文带进渲染进程。
    pub async fn toListDocSummaries(
        db: &DatabaseConnection,
        space_id: Option<&str>,
    ) -> Result<Vec<DocSummary>, Exception> {
        let docs = Self::toListDocs(db, space_id).await?;
        Ok(docs.into_iter().map(Self::to_summary).collect())
    }

    /// 把整行模型转成摘要（发布返回走这里，避免把正文过 IPC）。
    #[must_use]
    pub fn to_summaries(docs: Vec<doc_schema::Model>) -> Vec<DocSummary> {
        docs.into_iter().map(Self::to_summary).collect()
    }

    /// 打开文档时取引用：不在任何 space 目录下就返回 `matched = false`。
    ///
    /// 前端保存时要带回这里的 `hash`，服务端据此判断「编辑器打开之后，库内是否又被别处改过」。
    pub async fn toResolveDoc(db: &DatabaseConnection, path: &str) -> Result<DocRef, Exception> {
        let Some((space, rel_path, _)) = Self::find_space_by_path(db, path).await? else {
            return Ok(DocRef {
                matched: false,
                doc_id: None,
                space_id: None,
                rel_path: None,
                hash: None,
                revision: None,
            });
        };
        let row = doc_schema::Entity::find()
            .filter(doc_schema::Column::SpaceId.eq(space.id.as_str()))
            .filter(doc_schema::Column::RelPath.eq(rel_path.as_str()))
            .one(db)
            .await?;
        Ok(DocRef {
            matched: true,
            doc_id: row.as_ref().map(|doc| doc.id.clone()),
            hash: row.as_ref().map(|doc| doc.hash.clone()),
            revision: row.as_ref().map(|doc| doc.revision),
            space_id: Some(space.id),
            rel_path: Some(rel_path),
        })
    }

    /// 编辑器保存：**写正式文件 + 落库**（app 是唯一写者）。
    ///
    /// 冲突规则：`expected_hash` 与库内当前 hash 不一致（且未 `force`）→ 直接返回冲突、
    /// **不写盘**，让界面先问「保留我的 / 重载」。文件不在任何 space 下时 `matched = false`，
    /// 调用方按普通文件自己写。
    pub async fn toWriteDoc(
        db: &DatabaseConnection,
        path: &str,
        content: &str,
        expected_hash: Option<&str>,
        force: bool,
    ) -> Result<WriteDocOutcome, Exception> {
        let Some((space, rel_path, target)) = Self::find_space_by_path(db, path).await? else {
            return Ok(WriteDocOutcome {
                matched: false,
                conflict: false,
                doc: None,
                hash: None,
                revision: None,
            });
        };

        let existing = doc_schema::Entity::find()
            .filter(doc_schema::Column::SpaceId.eq(space.id.as_str()))
            .filter(doc_schema::Column::RelPath.eq(rel_path.as_str()))
            .one(db)
            .await?;

        if !force
            && let (Some(expected), Some(row)) = (expected_hash, existing.as_ref())
            && row.hash != expected
        {
            return Ok(WriteDocOutcome {
                matched: true,
                conflict: true,
                doc: None,
                hash: Some(row.hash.clone()),
                revision: Some(row.revision),
            });
        }

        ensure_inside(&target, Path::new(&space.root_path))?;
        fs::write(&target, content)?;

        let doc = Self::upsert_from_content(
            db,
            &space,
            &rel_path,
            content,
            knowledge_doc_source::AUTHORED,
        )
        .await?;
        Ok(WriteDocOutcome {
            matched: true,
            conflict: false,
            hash: Some(doc.hash.clone()),
            revision: Some(doc.revision),
            doc: Some(Self::to_summary(doc)),
        })
    }

    /// 找到 `path` 所属的 space（取最深的那个，嵌套库时不会认错），
    /// 返回 `(space, "/" 分隔的相对路径, 目标绝对路径)`。
    async fn find_space_by_path(
        db: &DatabaseConnection,
        path: &str,
    ) -> Result<Option<(space_schema::Model, String, PathBuf)>, Exception> {
        let raw = Path::new(path);
        // 新文件还不存在：canonicalize 父目录后拼文件名，避免「另存为」被当成越界
        let target = match fs::canonicalize(raw) {
            Ok(target) => target,
            Err(_) => {
                let (Some(parent), Some(name)) = (raw.parent(), raw.file_name()) else {
                    return Ok(None);
                };
                fs::canonicalize(parent)?.join(name)
            }
        };

        let mut best: Option<(space_schema::Model, String)> = None;
        for space in Self::toListSpaces(db).await? {
            let Ok(root) = fs::canonicalize(&space.root_path) else {
                continue;
            };
            let Ok(rel) = target.strip_prefix(&root) else {
                continue;
            };
            let rel = rel.to_string_lossy().replace('\\', "/");
            if rel.is_empty() {
                continue;
            }
            // 相对路径越短 = 所属目录越深
            if best
                .as_ref()
                .is_none_or(|(_, current)| rel.len() < current.len())
            {
                best = Some((space, rel));
            }
        }
        Ok(best.map(|(space, rel)| (space, rel, target)))
    }

    fn to_summary(doc: doc_schema::Model) -> DocSummary {
        DocSummary {
            id: doc.id,
            space_id: doc.space_id,
            title: doc.title,
            rel_path: doc.rel_path,
            word_count: doc.word_count,
            revision: doc.revision,
            status: doc.status,
            source: doc.source,
            updated_at: doc.updated_at,
        }
    }

    /// 空间总目录（各 space 的父目录）。固定为传入的 `knowledge_root`，不依赖 default 行。
    pub fn toResolveRoot(knowledge_root: &Path) -> Result<PathBuf, Exception> {
        fs::create_dir_all(knowledge_root)?;
        Ok(fs::canonicalize(knowledge_root)?)
    }

    /// 列出 staging 里的草稿（agent 生成、等用户确认发布）。
    pub async fn toListStaging(
        db: &DatabaseConnection,
        space_id: Option<&str>,
    ) -> Result<Vec<StagedFile>, Exception> {
        let spaces = match space_id {
            Some(space_id) => vec![Self::find_space(db, space_id).await?],
            None => Self::toListSpaces(db).await?,
        };

        let mut files = Vec::new();
        for space in spaces {
            let staging = Self::knowledge_root(&space)?.join(STAGING_DIR);
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
                    .unwrap_or_else(|| knowledge_doc_source::AGENT.to_string());
                let name = path
                    .file_stem()
                    .map(|stem| stem.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let stem = to_display_stem(&name).to_string();
                let content = fs::read_to_string(&path).unwrap_or_default();
                let (page_type, title) = super::wiki::to_read_meta(&content);
                let rel_path = page_type
                    .as_deref()
                    .and_then(super::wiki::find_wiki_type)
                    .map(|kind| super::wiki::to_rel_path(kind, title.as_deref().unwrap_or(&stem)));
                files.push(StagedFile {
                    space_id: space.id.clone(),
                    path: path.to_string_lossy().into_owned(),
                    name: stem,
                    session,
                    size: metadata.len() as i64,
                    modified_at: modified,
                    title,
                    page_type,
                    rel_path,
                });
            }
        }
        files.sort_by(|left, right| right.modified_at.cmp(&left.modified_at));
        Ok(files)
    }

    /// 丢弃 staging 草稿（只允许删 staging 内的文件）。
    pub async fn toDiscardStaging(db: &DatabaseConnection, path: &str) -> Result<bool, Exception> {
        let target = fs::canonicalize(path)
            .map_err(|error| Exception::Validation(format!("草稿不存在：{error}")))?;
        for space in Self::toListSpaces(db).await? {
            let staging = Self::knowledge_root(&space)?.join(STAGING_DIR);
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

    /// 合并分章：把 staging 里的多份草稿按路径顺序拼成一份，**留在 staging** 等用户发布。
    ///
    /// 模型只负责分章内容；拼接是确定性动作，不该让模型自己「复述一遍全文」。
    /// 只接受 staging 内的文件；成功后删除分片，失败时不动任何东西。
    pub async fn toMergeStaging(
        db: &DatabaseConnection,
        space_id: &str,
        paths: &[String],
        title: &str,
    ) -> Result<StagedDoc, Exception> {
        let title = title.trim();
        if title.is_empty() {
            return Err(Exception::Validation("合并后的标题不能为空".to_string()));
        }
        if paths.is_empty() {
            return Err(Exception::Validation("没有可合并的分章".to_string()));
        }

        let space = Self::find_space(db, space_id).await?;
        let staging_root = Self::staging_root(&space)?;

        let mut parts: Vec<(PathBuf, String)> = Vec::with_capacity(paths.len());
        for raw in paths {
            let path = fs::canonicalize(raw)
                .map_err(|error| Exception::Validation(format!("分章不存在：{error}")))?;
            if !path.starts_with(&staging_root) {
                return Err(Exception::Validation(
                    "只能合并 staging 目录下的草稿".to_string(),
                ));
            }
            let content = fs::read_to_string(&path)?;
            parts.push((path, content));
        }
        // 合并顺序按调用方传入（待发布区里的勾选顺序）；不再依赖 01-/02- 文件名前缀
        let page_type = parts
            .first()
            .and_then(|(_, content)| super::wiki::to_read_meta(content).0);

        let mut sections: Vec<String> = Vec::with_capacity(parts.len());
        for (_, content) in &parts {
            // 分章自带 frontmatter：先剥掉，再把原标题变成二级标题
            let document = super::front_matter::Document::parse(content);
            let body = document.body.trim();
            if body.is_empty() {
                continue;
            }
            let (_, part_title) = super::wiki::to_read_meta(content);
            match part_title {
                Some(part_title) => sections.push(format!("## {part_title}\n\n{body}")),
                None => sections.push(body.to_string()),
            }
        }
        if sections.is_empty() {
            return Err(Exception::Validation("分章没有正文，无法合并".to_string()));
        }

        let dir = parts[0]
            .0
            .parent()
            .ok_or_else(|| Exception::Validation("分章缺少所在目录".to_string()))?
            .to_path_buf();
        let page = super::wiki::normalize(super::wiki::PageInput {
            name: title,
            content: &sections.join("\n\n"),
            type_hint: page_type.as_deref(),
            title_hint: Some(title),
        })?;

        let short = Uuid::new_v4().simple().to_string();
        let target = dir.join(format!("{}-{}.md", page.slug, &short[..8]));
        fs::write(&target, &page.content)?;
        for (path, _) in &parts {
            // 合并结果已落盘；分片删不掉不阻断
            let _ = fs::remove_file(path);
        }

        Ok(StagedDoc {
            space_id: space.id,
            path: target.to_string_lossy().into_owned(),
            title: page.title,
            slug: page.slug,
            page_type: page.page_type,
            rel_path: page.rel_path,
        })
    }

    async fn find_space(
        db: &DatabaseConnection,
        space_id: &str,
    ) -> Result<space_schema::Model, Exception> {
        space_schema::Entity::find_by_id(space_id)
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("空间不存在：{space_id}")))
    }

    /// 空间总目录 = 某个 space 目录的父目录（staging 与各 space 平级）。
    fn knowledge_root(space: &space_schema::Model) -> Result<PathBuf, Exception> {
        Path::new(&space.root_path)
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| Exception::Validation("空间目录缺少父目录".to_string()))
    }

    fn staging_root(space: &space_schema::Model) -> Result<PathBuf, Exception> {
        let root = Self::knowledge_root(space)?.join(STAGING_DIR);
        fs::create_dir_all(&root)?;
        fs::canonicalize(root).map_err(Exception::from)
    }

    /// 目标相对路径去重：`Replace` 直接复用（同名页 = 更新同一页），`KeepBoth` 自动加 `-2`。
    async fn unique_rel_path(
        db: &DatabaseConnection,
        space: &space_schema::Model,
        desired: &str,
        mode: PublishMode,
    ) -> Result<String, Exception> {
        let desired = desired.replace('\\', "/");
        if mode == PublishMode::Replace {
            return Ok(desired);
        }
        let path = Path::new(&desired);
        let dir = path
            .parent()
            .map(|parent| parent.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let stem = path
            .file_stem()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| "page".to_string());
        let mut attempt = 1;
        loop {
            let file = if attempt == 1 {
                format!("{stem}.md")
            } else {
                format!("{stem}-{attempt}.md")
            };
            let candidate = if dir.is_empty() {
                file
            } else {
                format!("{dir}/{file}")
            };
            let taken = doc_schema::Entity::find()
                .filter(doc_schema::Column::SpaceId.eq(space.id.as_str()))
                .filter(doc_schema::Column::RelPath.eq(candidate.as_str()))
                .one(db)
                .await?
                .is_some();
            if !taken && !Path::new(&space.root_path).join(&candidate).exists() {
                return Ok(candidate);
            }
            attempt += 1;
            if attempt > 99 {
                return Err(Exception::Validation(
                    "同名文档过多，请改名后再发布".to_string(),
                ));
            }
        }
    }

    /// 落库（按 `spaceID + relPath` 幂等）。hash 未变时不动 revision —— 回灌不该制造假变更。
    async fn upsert_from_content(
        db: &DatabaseConnection,
        space: &space_schema::Model,
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
            .filter(doc_schema::Column::SpaceId.eq(space.id.as_str()))
            .filter(doc_schema::Column::RelPath.eq(rel_path))
            .one(db)
            .await?;

        let model = match existing {
            Some(existing) => {
                if existing.hash == hash && existing.rel_path == rel_path {
                    return Ok(existing);
                }
                let revision = existing.revision + 1;
                let mut active: doc_schema::ActiveModel = existing.into();
                active.title = Set(title);
                active.hash = Set(hash);
                active.content = Set(content.to_string());
                active.size = Set(size);
                active.word_count = Set(words);
                active.revision = Set(revision);
                active.status = Set(knowledge_doc_status::PUBLISHED.to_string());
                active.source = Set(source.to_string());
                active.error = Set(None);
                active.updated_at = Set(now);
                active.update(db).await?
            }
            None => {
                let model = doc_schema::Model {
                    id: Uuid::new_v4().to_string(),
                    space_id: space.id.clone(),
                    title,
                    rel_path: rel_path.to_string(),
                    hash,
                    content: content.to_string(),
                    size,
                    word_count: words,
                    revision: 1,
                    status: knowledge_doc_status::PUBLISHED.to_string(),
                    source: source.to_string(),
                    error: None,
                    session_id: None,
                    asset_id: None,
                    asset_hash: None,
                    archived_at: None,
                    created_at: now,
                    updated_at: now,
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
                active.local_indexed_at = Set(Some(now));
                active.updated_at = Set(now);
                active.update(db).await?;
            }
            None => {
                let model = index_schema::ActiveModel {
                    doc_id: Set(doc.id.clone()),
                    space_id: Set(doc.space_id.clone()),
                    tenant_id: Set(None),
                    local_indexed_at: Set(Some(now)),
                    cloud_status: Set(knowledge_cloud_status::IDLE.to_string()),
                    cloud_asset_id: Set(None),
                    cloud_asset_hash: Set(None),
                    cloud_model: Set(None),
                    cloud_dimensions: Set(None),
                    cloud_indexed_at: Set(None),
                    last_error: Set(None),
                    created_at: Set(now),
                    updated_at: Set(now),
                };
                index_schema::Entity::insert(model).exec(db).await?;
            }
        }
        Ok(())
    }
}

/// `wiki/<dir>/x.md` → 对应类型（按目录反推；`wiki/` 根级页返回 None）。
fn find_type_by_dir(rel_path: &str) -> Option<&'static super::wiki::WikiType> {
    let rest = rel_path.strip_prefix("wiki/")?;
    let dir = rest.split('/').next()?;
    super::wiki::WIKI_TYPES.iter().find(|item| {
        item.dir
            .strip_prefix("wiki/")
            .is_some_and(|name| name.eq_ignore_ascii_case(dir))
    })
}

/// staging 文件名是 `<slug>-<8hex>`；给用户看的名字去掉随机后缀。
fn to_display_stem(name: &str) -> &str {
    if name.len() > 9 {
        let (stem, tail) = name.split_at(name.len() - 9);
        if let Some(hex) = tail.strip_prefix('-')
            && !hex.is_empty()
            && hex.chars().all(|ch| ch.is_ascii_hexdigit())
        {
            return stem;
        }
    }
    name
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
            "{} 不在空间目录内",
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

    /// 库级选项是「按需改动」：没传的那几项必须保持原值。
    #[tokio::test]
    async fn update_space_keeps_fields_that_were_not_given() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("space-flags");
        let space = Service::toEnsureDefaultSpace(db, &root)
            .await
            .expect("默认库");
        assert!(!space.auto_update);
        assert!(space.citation, "默认库生成带引用");

        let changed = Service::toUpdateSpace(db, &space.id, Some(true), Some(true), None)
            .await
            .expect("更新");
        assert!(changed.auto_update);
        assert!(changed.auto_export);
        assert!(changed.citation, "没传的 citation 不该被改");

        let reloaded = Service::toListSpaces(db).await.expect("列表");
        let row = reloaded
            .into_iter()
            .find(|item| item.id == space.id)
            .expect("应还在列表里");
        assert!(row.auto_update && row.auto_export && row.citation);
    }

    /// 云端召回只认「已建好索引」的文档：在途与失败的文档混进来只会让 assetIDs 变长。
    #[tokio::test]
    async fn cloud_docs_lists_only_succeeded_assets() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("cloud-docs");
        let space = Service::toEnsureDefaultSpace(db, &root)
            .await
            .expect("默认库");
        let now = Utc::now().timestamp_millis();
        for (doc_id, status, asset) in [
            (
                "doc-ok",
                knowledge_cloud_status::SUCCEEDED,
                Some("asset-ok"),
            ),
            (
                "doc-running",
                knowledge_cloud_status::RUNNING,
                Some("asset-running"),
            ),
            ("doc-failed", knowledge_cloud_status::FAILED, None),
        ] {
            index_schema::Entity::insert(index_schema::ActiveModel {
                doc_id: Set(doc_id.to_string()),
                space_id: Set(space.id.clone()),
                tenant_id: Set(None),
                local_indexed_at: Set(Some(now)),
                cloud_status: Set(status.to_string()),
                cloud_asset_id: Set(asset.map(str::to_string)),
                cloud_asset_hash: Set(None),
                cloud_model: Set(None),
                cloud_dimensions: Set(None),
                cloud_indexed_at: Set(None),
                last_error: Set(None),
                created_at: Set(now),
                updated_at: Set(now),
            })
            .exec(db)
            .await
            .expect("写索引状态");
        }

        let docs = Service::toListCloudDocs(db, Some(&space.id))
            .await
            .expect("列表");
        assert_eq!(docs.len(), 1, "只有 succeeded 且有 assetID 的文档算");
        assert_eq!(docs[0].doc_id, "doc-ok");
        assert_eq!(docs[0].asset_id, "asset-ok");
    }

    /// 云端状态是 upsert：第一次写要建行，第二次写要把上一次的失败原因清掉。
    #[tokio::test]
    async fn cloud_state_upsert_keeps_the_row_consistent() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("cloud-state");
        let space = Service::toEnsureDefaultSpace(db, &root)
            .await
            .expect("默认库");
        let now = Utc::now().timestamp_millis();
        doc_schema::Entity::insert(doc_schema::ActiveModel {
            id: Set("doc-1".to_string()),
            space_id: Set(space.id.clone()),
            title: Set("第一篇".to_string()),
            rel_path: Set("第一篇.md".to_string()),
            hash: Set("h".to_string()),
            content: Set("正文".to_string()),
            size: Set(6),
            word_count: Set(2),
            revision: Set(1),
            status: Set(knowledge_doc_status::PUBLISHED.to_string()),
            source: Set(knowledge_doc_source::AUTHORED.to_string()),
            error: Set(None),
            session_id: Set(None),
            asset_id: Set(None),
            asset_hash: Set(None),
            archived_at: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
        })
        .exec(db)
        .await
        .expect("写文档");

        let started = Service::toSetCloudState(
            db,
            "doc-1",
            CloudPatch {
                status: knowledge_cloud_status::RUNNING.to_string(),
                asset_id: Some("asset-1".to_string()),
                indexed_at: None,
                error: None,
            },
        )
        .await
        .expect("首次写");
        assert_eq!(started.status, knowledge_cloud_status::RUNNING);
        assert_eq!(started.asset_id.as_deref(), Some("asset-1"));

        let failed = Service::toSetCloudState(
            db,
            "doc-1",
            CloudPatch {
                status: knowledge_cloud_status::FAILED.to_string(),
                asset_id: Some("asset-1".to_string()),
                indexed_at: None,
                error: Some("compute 不可用".to_string()),
            },
        )
        .await
        .expect("写失败态");
        assert_eq!(failed.error.as_deref(), Some("compute 不可用"));

        let done = Service::toSetCloudState(
            db,
            "doc-1",
            CloudPatch {
                status: knowledge_cloud_status::SUCCEEDED.to_string(),
                asset_id: Some("asset-1".to_string()),
                indexed_at: Some(now),
                error: None,
            },
        )
        .await
        .expect("写成功态");
        assert_eq!(done.status, knowledge_cloud_status::SUCCEEDED);
        assert!(done.error.is_none(), "成功之后不该还挂着上一次的失败原因");
        assert_eq!(done.indexed_at, Some(now));

        let states = Service::toListCloudStates(db, Some(&space.id))
            .await
            .expect("列表");
        assert_eq!(states.len(), 1, "upsert 不该写出第二行");
    }

    /// 状态行挂在文档上：文档不存在时不建孤儿行（否则永远是查不到主人的垃圾）。
    #[tokio::test]
    async fn cloud_state_requires_an_existing_doc() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let error = Service::toSetCloudState(
            db,
            "missing",
            CloudPatch {
                status: knowledge_cloud_status::RUNNING.to_string(),
                asset_id: None,
                indexed_at: None,
                error: None,
            },
        )
        .await
        .expect_err("文档不存在应报错");
        assert!(error.to_string().contains("文档不存在"), "{error}");
    }

    #[tokio::test]
    async fn ensure_default_space_is_idempotent() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("ensure");

        let first = Service::toEnsureDefaultSpace(db, &root).await.expect("首次");
        let second = Service::toEnsureDefaultSpace(db, &root).await.expect("再次");
        assert_eq!(first.id, second.id);
        assert_eq!(first.slug, "default");
        assert!(Path::new(&first.root_path).is_dir());
    }

    #[tokio::test]
    async fn publish_then_search_hits_fts_and_like_fallback() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("search");
        let space = Service::toEnsureDefaultSpace(db, &root)
            .await
            .expect("默认库");
        let content = "# 空间设计\n\n本文说明空间的目录结构与写入不变量。";

        let staged = Service::toWriteStaging(db, &space.id, "s1", "空间设计", content, None, None)
            .await
            .expect("写 staging");
        assert!(staged.path.replace('\\', "/").contains("/.staging/"));
        assert_eq!(staged.title, "空间设计");
        assert_eq!(staged.page_type, super::super::wiki::DEFAULT_TYPE);
        assert_eq!(staged.rel_path, "wiki/notes/空间设计.md");

        let doc = Service::toPublish(
            db,
            &space.id,
            &staged.path,
            PublishMode::Replace,
            knowledge_doc_source::AGENT,
        )
        .await
        .expect("发布");
        assert_eq!(doc.status, knowledge_doc_status::PUBLISHED);
        assert_eq!(doc.rel_path, "wiki/notes/空间设计.md");
        assert!(Path::new(&space.root_path).join(&doc.rel_path).exists());
        // 发布后聚合页跟着更新（index 里能找到这页）
        let index = fs::read_to_string(Path::new(&space.root_path).join("wiki").join("index.md"))
            .expect("index");
        assert!(index.contains("[[空间设计]]"), "index 应包含新页");
        // staging 副本已清理
        assert!(!Path::new(&staged.path).exists());

        // 4 个字：FTS5 trigram 命中
        let hits = Service::toSearch(db, "说明空间", None, 5)
            .await
            .expect("检索");
        assert_eq!(hits.len(), 1, "FTS 应命中 1 篇");
        assert_eq!(hits[0].mode, "fts");
        assert_eq!(hits[0].doc_id, doc.id);
        assert!(!hits[0].snippet.is_empty());

        // 2 个字：trigram 查不到，必须回退 LIKE
        let short = Service::toSearch(db, "空间", None, 5)
            .await
            .expect("短词检索");
        assert_eq!(short.len(), 1, "短词应靠 LIKE 命中");
        assert_eq!(short[0].mode, "like");
        assert!(short[0].snippet.contains("空间"));
    }

    #[tokio::test]
    async fn publish_rejects_paths_outside_staging() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("escape");
        let space = Service::toEnsureDefaultSpace(db, &root)
            .await
            .expect("默认库");

        let outside = root.join("escape.md");
        fs::write(&outside, "# 越界\n\n不在 staging 里").expect("写文件");
        let error = Service::toPublish(
            db,
            &space.id,
            &outside.to_string_lossy(),
            PublishMode::Replace,
            knowledge_doc_source::AGENT,
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
        let space = Service::toEnsureDefaultSpace(db, &root)
            .await
            .expect("默认库");
        // ensure_wiki_layout 会落种子文档，先把它们入库存成基线
        Service::toRescanSpace(db, &space.id).await.expect("种子回灌");
        let seeded = Service::toListDocs(db, Some(&space.id))
            .await
            .expect("种子列表")
            .len();
        assert!(seeded >= 3, "默认库应带种子文档");

        let file = Path::new(&space.root_path).join("外部写入.md");
        fs::write(&file, "# 外部写入\n\n由编辑器直接落盘。").expect("写文件");
        let handled = Service::toRescanSpace(db, &space.id).await.expect("回灌");
        assert_eq!(handled, seeded + 1);
        let docs = Service::toListDocs(db, Some(&space.id))
            .await
            .expect("列文档");
        assert_eq!(docs.len(), seeded + 1);
        let hit = docs
            .iter()
            .find(|doc| doc.rel_path == "外部写入.md")
            .expect("新文件应入库");
        assert_eq!(hit.title, "外部写入");
        assert_eq!(hit.source, knowledge_doc_source::IMPORT);

        fs::remove_file(&file).expect("删文件");
        Service::toRescanSpace(db, &space.id).await.expect("再回灌");
        let docs = Service::toListDocs(db, Some(&space.id))
            .await
            .expect("列文档");
        assert_eq!(docs.len(), seeded, "文件消失后行应被清掉");
        assert!(!docs.iter().any(|doc| doc.rel_path == "外部写入.md"));
    }

    #[tokio::test]
    async fn unchanged_content_does_not_bump_revision() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("revision");
        let space = Service::toEnsureDefaultSpace(db, &root)
            .await
            .expect("默认库");
        let file = Path::new(&space.root_path).join("稳定.md");
        fs::write(&file, "# 稳定\n\n内容不变。").expect("写文件");

        Service::toRescanSpace(db, &space.id).await.expect("首次回灌");
        Service::toRescanSpace(db, &space.id).await.expect("再次回灌");
        let docs = Service::toListDocs(db, Some(&space.id))
            .await
            .expect("列文档");
        let doc = docs
            .iter()
            .find(|doc| doc.rel_path == "稳定.md")
            .expect("稳定.md 应入库");
        assert_eq!(doc.revision, 1, "内容没变不该制造新版本");

        fs::write(&file, "# 稳定\n\n内容变了。").expect("改写文件");
        Service::toRescanSpace(db, &space.id)
            .await
            .expect("第三次回灌");
        let docs = Service::toListDocs(db, Some(&space.id))
            .await
            .expect("列文档");
        let doc = docs
            .iter()
            .find(|doc| doc.rel_path == "稳定.md")
            .expect("稳定.md 应还在");
        assert_eq!(doc.revision, 2);
    }

    #[tokio::test]
    async fn staging_listing_groups_by_session_and_discard_only_inside_staging() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("staging-list");
        let space = Service::toEnsureDefaultSpace(db, &root)
            .await
            .expect("默认库");

        Service::toWriteStaging(db, &space.id, "s-alpha", "甲", "# 甲\n\n正文甲", None, None)
            .await
            .expect("写甲");
        Service::toWriteStaging(db, &space.id, "s-beta", "乙", "# 乙\n\n正文乙", None, None)
            .await
            .expect("写乙");

        let files = Service::toListStaging(db, Some(&space.id))
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
        assert!(
            Service::toDiscardStaging(db, &victim.path)
                .await
                .expect("丢弃")
        );
        assert!(!Path::new(&victim.path).exists());
        assert_eq!(
            Service::toListStaging(db, Some(&space.id))
                .await
                .expect("再列草稿")
                .len(),
            1
        );

        // staging 之外的文件不允许「丢弃」
        let outside = Path::new(&space.root_path).join("正式.md");
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
        let space = Service::toEnsureDefaultSpace(db, &root)
            .await
            .expect("默认库");
        let file = Path::new(&space.root_path).join("摘要.md");
        fs::write(&file, "# 摘要标题\n\n正文内容。").expect("写文件");
        Service::toRescanSpace(db, &space.id).await.expect("回灌");

        let summaries = Service::toListDocSummaries(db, Some(&space.id))
            .await
            .expect("摘要");
        let summary = summaries
            .iter()
            .find(|item| item.rel_path == "摘要.md")
            .expect("新文件应有摘要");
        assert_eq!(summary.title, "摘要标题");
        assert_eq!(summary.rel_path, "摘要.md");
        assert_eq!(summary.status, knowledge_doc_status::PUBLISHED);
        assert!(summary.word_count > 0);
        // 摘要结构里根本没有正文字段：编不出来也就传不出去
        let json = serde_json::to_value(summary).expect("序列化");
        assert!(json.get("content").is_none());
    }

    #[tokio::test]
    async fn write_doc_creates_then_updates_snapshot() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("write");
        let space = Service::toEnsureDefaultSpace(db, &root)
            .await
            .expect("默认库");
        let file = Path::new(&space.root_path).join("手写.md");
        let path = file.to_string_lossy().into_owned();

        // 新文件：create 一次，revision 从 1 起
        let created = Service::toWriteDoc(db, &path, "# 手写\n\n第一版", None, false)
            .await
            .expect("首次保存");
        assert!(created.matched);
        assert!(!created.conflict);
        let doc = created.doc.expect("应有摘要");
        assert_eq!(doc.title, "手写");
        assert_eq!(doc.revision, 1);
        assert_eq!(doc.source, knowledge_doc_source::AUTHORED);
        assert!(file.exists());

        // 内容变了：revision 递增，文件与快照同步
        let updated = Service::toWriteDoc(
            db,
            &path,
            "# 手写\n\n第二版",
            created.hash.as_deref(),
            false,
        )
        .await
        .expect("再次保存");
        assert!(!updated.conflict);
        assert_eq!(updated.revision, Some(2));
        assert_eq!(
            fs::read_to_string(&file).expect("读文件"),
            "# 手写\n\n第二版"
        );

        // 打开时拿到的引用能对上库内行
        let reference = Service::toResolveDoc(db, &path).await.expect("解析引用");
        assert!(reference.matched);
        assert_eq!(reference.hash, updated.hash);
        assert_eq!(reference.revision, Some(2));
    }

    #[tokio::test]
    async fn write_doc_conflicts_when_snapshot_moved_on() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("conflict");
        let space = Service::toEnsureDefaultSpace(db, &root)
            .await
            .expect("默认库");
        let file = Path::new(&space.root_path).join("冲突.md");
        let path = file.to_string_lossy().into_owned();

        let opened = Service::toWriteDoc(db, &path, "# 冲突\n\n我的版本", None, false)
            .await
            .expect("首次保存");
        let opened_hash = opened.hash.expect("hash");

        // 别处（agent 发布 / 回灌）更新了同一篇：磁盘与库内都必须变
        fs::write(&file, "# 冲突\n\n别处的版本").expect("模拟外部写盘");
        Service::upsert_from_content(
            db,
            &space,
            "冲突.md",
            "# 冲突\n\n别处的版本",
            knowledge_doc_source::IMPORT,
        )
        .await
        .expect("模拟别处更新");

        // 用打开时的 hash 保存 → 冲突，且**不写盘**
        let conflict =
            Service::toWriteDoc(db, &path, "# 冲突\n\n我的版本", Some(&opened_hash), false)
                .await
                .expect("保存应返回冲突而不是报错");
        assert!(conflict.conflict);
        assert!(conflict.doc.is_none());
        assert_eq!(
            fs::read_to_string(&file).expect("读文件"),
            "# 冲突\n\n别处的版本"
        );

        // force 才允许覆盖
        let forced = Service::toWriteDoc(db, &path, "# 冲突\n\n我的版本", Some(&opened_hash), true)
            .await
            .expect("强制保存");
        assert!(!forced.conflict);
        assert_eq!(
            fs::read_to_string(&file).expect("读文件"),
            "# 冲突\n\n我的版本"
        );
    }

    #[tokio::test]
    async fn write_doc_outside_any_space_is_not_matched() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("outside");
        Service::toEnsureDefaultSpace(db, &root)
            .await
            .expect("默认库");

        let outside = temp_root("outside-file").join("普通.md");
        let outcome =
            Service::toWriteDoc(db, &outside.to_string_lossy(), "# 普通文件\n", None, false)
                .await
                .expect("不在库内不算错误");
        assert!(!outcome.matched);
        assert!(!outcome.conflict);
        // 不匹配时服务层不写盘：由调用方按普通文件处理
        assert!(!outside.exists());
    }

    #[tokio::test]
    async fn merge_staging_joins_parts_in_selection_order() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("merge");
        let space = Service::toEnsureDefaultSpace(db, &root)
            .await
            .expect("默认库");
        let dir = Path::new(&space.root_path)
            .parent()
            .expect("父目录")
            .join(".staging")
            .join("s-merge");
        fs::create_dir_all(&dir).expect("建会话目录");
        // 分章顺序按调用方传入（待发布区勾选顺序），不再依赖文件名前缀
        let third = dir.join("03-c.md");
        let first = dir.join("01-a.md");
        let second = dir.join("02-b.md");
        fs::write(&third, "## 第三章\n\n丙").expect("写 3");
        fs::write(&first, "## 第一章\n\n甲").expect("写 1");
        fs::write(&second, "## 第二章\n\n乙").expect("写 2");

        let paths = vec![
            third.to_string_lossy().into_owned(),
            first.to_string_lossy().into_owned(),
            second.to_string_lossy().into_owned(),
        ];
        let merged = Service::toMergeStaging(db, &space.id, &paths, "年度总结")
            .await
            .expect("合并");

        let merged_path = PathBuf::from(&merged.path);
        assert!(merged_path.starts_with(&dir), "合并结果应留在同一会话目录");
        assert_eq!(merged.page_type, super::super::wiki::DEFAULT_TYPE);
        assert_eq!(merged.rel_path, "wiki/notes/年度总结.md");
        let content = fs::read_to_string(&merged_path).expect("读合并结果");
        assert!(content.contains("title: 年度总结"), "{content}");
        let a = content.find("## 第三章").expect("有第三章");
        let b = content.find("## 第一章").expect("有第一章");
        let c = content.find("## 第二章").expect("有第二章");
        assert!(a < b && b < c, "分章顺序应按传入顺序：{content}");

        // 分片已清理
        for path in [&first, &second, &third] {
            assert!(!path.exists(), "{} 应已删除", path.display());
        }
    }

    #[tokio::test]
    async fn merge_staging_rejects_files_outside_staging() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("merge-escape");
        let space = Service::toEnsureDefaultSpace(db, &root)
            .await
            .expect("默认库");
        let outside = Path::new(&space.root_path).join("正文.md");
        fs::write(&outside, "# 正文\n").expect("写正式文件");

        let error = Service::toMergeStaging(
            db,
            &space.id,
            &[outside.to_string_lossy().into_owned()],
            "越界",
        )
        .await
        .expect_err("必须拒绝 staging 之外的文件");
        assert!(error.to_string().contains("staging"), "{error}");
        assert!(outside.exists(), "被拒时不得动原文件");
    }

    #[tokio::test]
    async fn publish_uses_type_directory_and_upserts_same_page() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("publish-typed");
        let space = Service::toEnsureDefaultSpace(db, &root)
            .await
            .expect("默认库");

        let staged = Service::toWriteStaging(
            db,
            &space.id,
            "s",
            "本地优先",
            "---\ntype: concept\n---\n\n本地优先是一种架构取向。",
            Some("concept"),
            None,
        )
        .await
        .expect("写 staging");
        assert_eq!(staged.rel_path, "wiki/concepts/本地优先.md");

        let first = Service::toPublish(
            db,
            &space.id,
            &staged.path,
            PublishMode::Replace,
            knowledge_doc_source::AGENT,
        )
        .await
        .expect("发布");
        assert_eq!(first.rel_path, "wiki/concepts/本地优先.md");
        let file = Path::new(&space.root_path).join(&first.rel_path);
        let content = fs::read_to_string(&file).expect("读文件");
        assert!(content.contains("type: concept"));
        assert!(content.contains("title: 本地优先"));
        let created = first.created_at;

        // 同名再发布 = 更新同一页，不新增
        let staged = Service::toWriteStaging(
            db,
            &space.id,
            "s",
            "本地优先",
            "## 补充\n\n第二次发布",
            Some("concept"),
            None,
        )
        .await
        .expect("再写 staging");
        let second = Service::toPublish(
            db,
            &space.id,
            &staged.path,
            PublishMode::Replace,
            knowledge_doc_source::AGENT,
        )
        .await
        .expect("再发布");
        assert_eq!(second.id, first.id);
        assert_eq!(second.rel_path, "wiki/concepts/本地优先.md");
        assert_eq!(second.created_at, created, "更新不该重置 created");
        assert!(
            fs::read_to_string(&file)
                .expect("读文件")
                .contains("第二次发布")
        );

        let docs = Service::toListDocs(db, Some(&space.id))
            .await
            .expect("列文档");
        let pages = docs
            .iter()
            .filter(|doc| doc.rel_path.starts_with("wiki/concepts/"))
            .count();
        assert_eq!(pages, 1, "同一页不该出现两条记录");
    }

    #[tokio::test]
    async fn publish_batch_lands_separate_typed_pages() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("publish-batch");
        let space = Service::toEnsureDefaultSpace(db, &root)
            .await
            .expect("默认库");

        let first = Service::toWriteStaging(
            db,
            &space.id,
            "s",
            "甲",
            "## 甲的内容",
            Some("concept"),
            None,
        )
        .await
        .expect("写甲");
        let second =
            Service::toWriteStaging(db, &space.id, "s", "乙", "## 乙的内容", Some("entity"), None)
                .await
                .expect("写乙");
        let paths = vec![first.path.clone(), second.path.clone()];

        let docs = Service::toPublishBatch(
            db,
            &space.id,
            &paths,
            PublishMode::Replace,
            knowledge_doc_source::AGENT,
        )
        .await
        .expect("批量发布");
        assert_eq!(docs.len(), 2);
        assert_eq!(docs[0].rel_path, "wiki/concepts/甲.md");
        assert_eq!(docs[1].rel_path, "wiki/entities/乙.md");

        let index = fs::read_to_string(Path::new(&space.root_path).join("wiki").join("index.md"))
            .expect("index");
        assert!(index.contains("[[甲]]"));
        assert!(index.contains("[[乙]]"));
    }

    #[tokio::test]
    async fn migrate_layout_moves_root_pages_into_type_dirs() {
        let conn = fresh_db().await;
        let db = conn.as_ref();
        let root = temp_root("migrate");
        let space = Service::toEnsureDefaultSpace(db, &root)
            .await
            .expect("默认库");

        // 老版本 agent 产物：直接写在库根
        let legacy = Path::new(&space.root_path).join("旧页.md");
        fs::write(&legacy, "---\ntype: concept\ntitle: 旧页\n---\n\n正文").expect("写旧页");
        Service::toRescanSpace(db, &space.id).await.expect("回灌");

        let dry = Service::toMigrateLayout(db, &space.id, true)
            .await
            .expect("dry run");
        assert_eq!(dry.moves.len(), 1);
        assert_eq!(dry.moves[0].to, "wiki/concepts/旧页.md");
        assert!(legacy.exists(), "dry-run 不得动磁盘");

        let report = Service::toMigrateLayout(db, &space.id, false)
            .await
            .expect("归位");
        assert_eq!(report.moves.len(), 1);
        assert!(!legacy.exists(), "旧文件应已挪走");
        assert!(
            Path::new(&space.root_path)
                .join("wiki/concepts/旧页.md")
                .exists()
        );
        let docs = Service::toListDocs(db, Some(&space.id))
            .await
            .expect("列文档");
        assert!(
            docs.iter()
                .any(|doc| doc.rel_path == "wiki/concepts/旧页.md"),
            "DB 里的 rel_path 应同步"
        );
    }
}
