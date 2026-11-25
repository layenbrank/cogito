//! 图库服务：catalog / 详情 / 策展 / 检索 / facet / 相簿归属 / 智能相簿 / 根目录 / 回填。
//!
//! 三条硬约束（来自方案 §3、§4）：
//! 1. 图库自己的数据全在侧表，`asset` 表只读不写 —— 避免与 capture / clipboard / signboard
//!    共用 `asset:update`（全量覆盖）时互相清字段。
//! 2. 任何写操作都走 `to_forget_*` 之类的窄更新，不使用 `asset::Change`。
//! 3. catalog 一次返回全量紧凑行；检索、facet 聚合都在 Rust 侧算，渲染进程只做视图。

use std::collections::{HashMap, HashSet};

use chrono::Utc;
use cogito_database::entity::{
    album, asset, gallery_album_asset, gallery_asset, gallery_keyword, gallery_root,
    gallery_smart_album,
};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter,
    QueryOrder, TransactionTrait,
};
use serde_json::Value;
use uuid::Uuid;

use crate::exception::Exception;

use super::types::*;

pub struct Service;

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn to_kind(kind: Option<&str>, mime: &str) -> &'static str {
    match kind.map(|v| v.to_ascii_lowercase()) {
        Some(ref k) if k == "image" => "image",
        Some(ref k) if k == "video" => "video",
        _ => {
            if mime.starts_with("image/") {
                "image"
            } else if mime.starts_with("video/") {
                "video"
            } else {
                "other"
            }
        }
    }
}

fn meta_str(meta: &Value, key: &str) -> Option<String> {
    meta.get(key)?.as_str().map(|v| v.to_string())
}

fn meta_flag(meta: &Value, key: &str) -> bool {
    meta.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

/// 检索文本 = 小写文件名 + 全拼 + 首字母 + 关键词。
///
/// 写成 SQL 可 `LIKE` 的一列，而不是每次查询现算：中文用户打 `gugong` 要能命中「故宫」，
/// 但这条能力不该让每次输入都遍历 10 万行做拼音转换。
fn build_search_text(name: &str, keyword_values: &[&str]) -> String {
    use pinyin::ToPinyin;

    let mut parts: Vec<String> = vec![name.to_lowercase()];
    let mut full = String::new();
    let mut initials = String::new();
    for ch in name.chars() {
        match ch.to_pinyin() {
            Some(py) => {
                let plain = py.plain().to_lowercase();
                full.push_str(&plain);
                if let Some(head) = plain.chars().next() {
                    initials.push(head);
                }
            }
            None => {
                let lower = ch.to_ascii_lowercase();
                full.push(lower);
                if ch.is_ascii_alphanumeric() {
                    initials.push(lower);
                }
            }
        }
    }
    if !full.is_empty() && full != name.to_lowercase() {
        parts.push(full);
    }
    if !initials.is_empty() && initials != name.to_lowercase() {
        parts.push(initials);
    }
    for value in keyword_values {
        parts.push(value.to_lowercase());
    }
    parts.join(" ")
}

fn to_active(row: &gallery_asset::Model) -> gallery_asset::ActiveModel {
    gallery_asset::ActiveModel {
        asset_id: Set(row.asset_id.clone()),
        rating: Set(row.rating),
        flag: Set(row.flag.clone()),
        label: Set(row.label.clone()),
        captured_at: Set(row.captured_at),
        date_source: Set(row.date_source.clone()),
        size_bytes: Set(row.size_bytes),
        mtime_ms: Set(row.mtime_ms),
        width: Set(row.width),
        height: Set(row.height),
        duration_ms: Set(row.duration_ms),
        stack_id: Set(row.stack_id.clone()),
        dup_group: Set(row.dup_group.clone()),
        content_hash: Set(row.content_hash.clone()),
        phash: Set(row.phash.clone()),
        missing: Set(row.missing),
        hidden: Set(row.hidden),
        search_text: Set(row.search_text.clone()),
        probed_at: Set(row.probed_at),
        embedded_at: Set(row.embedded_at),
        embed_model: Set(row.embed_model.clone()),
        created_at: Set(row.created_at),
        updated_at: Set(row.updated_at),
    }
}

fn blank_row(id: &str) -> gallery_asset::Model {
    let now = now_ms();
    gallery_asset::Model {
        asset_id: id.to_string(),
        rating: 0,
        flag: None,
        label: None,
        captured_at: None,
        date_source: None,
        size_bytes: None,
        mtime_ms: None,
        width: None,
        height: None,
        duration_ms: None,
        stack_id: None,
        dup_group: None,
        content_hash: None,
        phash: None,
        missing: 0,
        hidden: 0,
        search_text: None,
        probed_at: None,
        embedded_at: None,
        embed_model: None,
        created_at: now,
        updated_at: now,
    }
}

impl Service {
    // ── 读 ──────────────────────────────────────────────────────────────

    /// 构造检索文本（导入管线用：它手里已经有文件名，不该再回查一次库）。
    #[allow(non_snake_case)]
    pub fn toSearchText(name: &str, keywords: &[KeywordEntry]) -> String {
        let values: Vec<&str> = keywords.iter().map(|entry| entry.value.as_str()).collect();
        build_search_text(name, &values)
    }

    /// 全量紧凑 catalog。四张表各查一次再在内存合并，比 LEFT JOIN + 行映射更好读也更快。
    ///
    /// 只收**媒体行**（image / video）：`asset` 表是各域共用的，里面还有 PDF、文档、剪贴板图片等，
    /// 全量透传会让「全部」视图混进在图库里点不开的文件，也让前端白白排序、分组。
    #[allow(non_snake_case)]
    pub async fn toReadCatalog<C: ConnectionTrait + TransactionTrait>(
        db: &C,
    ) -> Result<CatalogPayload, Exception> {
        let assets = asset::Entity::find()
            .filter(asset::Column::ArchivedAt.is_null())
            .all(db)
            .await?;
        let metas = gallery_asset::Entity::find().all(db).await?;
        let links = gallery_album_asset::Entity::find().all(db).await?;
        let keywords = gallery_keyword::Entity::find().all(db).await?;

        let mut meta_by_id: HashMap<String, gallery_asset::Model> =
            HashMap::with_capacity(metas.len());
        for row in metas {
            meta_by_id.insert(row.asset_id.clone(), row);
        }
        let mut albums_by_id: HashMap<String, Vec<String>> = HashMap::new();
        for link in links {
            albums_by_id
                .entry(link.asset_id)
                .or_default()
                .push(link.album_id);
        }
        // 关键词进 catalog：筛选器的 `keywords` chip 与 facet 都要用它。
        // 单独一条查询 + 按 asset 分桶，比每行一次 EXISTS 便宜一个量级。
        let mut keywords_by_id: HashMap<String, Vec<KeywordEntry>> = HashMap::new();
        for row in keywords {
            keywords_by_id
                .entry(row.asset_id)
                .or_default()
                .push(KeywordEntry {
                    facet: row.facet,
                    value: row.value,
                });
        }

        let mut rows = Vec::with_capacity(assets.len());
        let mut probed_count = 0usize;
        for row in assets {
            let kind = to_kind(row.kind.as_deref(), &row.mime);
            if kind == "other" {
                continue;
            }
            let meta = meta_by_id.remove(&row.id);
            let metadata: Value = row
                .metadata
                .as_deref()
                .and_then(|raw| serde_json::from_str(raw).ok())
                .unwrap_or(Value::Null);
            let probed = meta
                .as_ref()
                .map(|m| m.probed_at.is_some())
                .unwrap_or(false);
            if probed {
                probed_count += 1;
            }
            rows.push(CatalogRow {
                id: row.id.clone(),
                kind: kind.to_string(),
                name: row.file_name.clone(),
                path: row.file_path.clone(),
                mime: row.mime.clone(),
                captured_at: meta
                    .as_ref()
                    .and_then(|m| m.captured_at)
                    .unwrap_or(row.created_at),
                date_source: meta.as_ref().and_then(|m| m.date_source.clone()),
                rating: meta.as_ref().map(|m| m.rating).unwrap_or(0),
                flag: meta.as_ref().and_then(|m| m.flag.clone()),
                label: meta.as_ref().and_then(|m| m.label.clone()),
                size: meta.as_ref().and_then(|m| m.size_bytes).or(row.size),
                width: meta.as_ref().and_then(|m| m.width),
                height: meta.as_ref().and_then(|m| m.height),
                duration_ms: meta.as_ref().and_then(|m| m.duration_ms),
                stack_id: meta.as_ref().and_then(|m| m.stack_id.clone()),
                dup_group: meta.as_ref().and_then(|m| m.dup_group.clone()),
                missing: meta.as_ref().map(|m| m.missing != 0).unwrap_or(false),
                hidden: meta.as_ref().map(|m| m.hidden != 0).unwrap_or(false)
                    || meta_flag(&metadata, "hidden"),
                album_ids: albums_by_id.remove(&row.id).unwrap_or_default(),
                keywords: keywords_by_id.remove(&row.id).unwrap_or_default(),
                source: meta_str(&metadata, "source"),
                capture_kind: meta_str(&metadata, "captureKind"),
                is_managed: meta_flag(&metadata, "isManaged"),
                keep: meta_flag(&metadata, "keep"),
                mtime_ms: meta.as_ref().and_then(|m| m.mtime_ms),
                probed,
            });
        }
        rows.sort_by(|a, b| {
            b.captured_at
                .cmp(&a.captured_at)
                .then_with(|| a.id.cmp(&b.id))
        });

        Ok(CatalogPayload {
            schema_ver: CATALOG_SCHEMA_VER,
            total: rows.len(),
            probed_count,
            rows,
        })
    }

    /// 详情：EXIF / GPS / 关键词 / 相簿 / 尺寸 / 哈希。检查器与灯箱按需取。
    #[allow(non_snake_case)]
    pub async fn toReadDetails<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        ids: Vec<String>,
    ) -> Result<Vec<GalleryDetails>, Exception> {
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let assets = asset::Entity::find()
            .filter(asset::Column::Id.is_in(ids.clone()))
            .all(db)
            .await?;
        let metas = gallery_asset::Entity::find()
            .filter(gallery_asset::Column::AssetId.is_in(ids.clone()))
            .all(db)
            .await?;
        let keywords = gallery_keyword::Entity::find()
            .filter(gallery_keyword::Column::AssetId.is_in(ids.clone()))
            .all(db)
            .await?;
        let links = gallery_album_asset::Entity::find()
            .filter(gallery_album_asset::Column::AssetId.is_in(ids))
            .all(db)
            .await?;

        let mut meta_by_id: HashMap<String, gallery_asset::Model> = metas
            .into_iter()
            .map(|row| (row.asset_id.clone(), row))
            .collect();
        let mut keywords_by_id: HashMap<String, Vec<KeywordEntry>> = HashMap::new();
        for row in keywords {
            keywords_by_id
                .entry(row.asset_id)
                .or_default()
                .push(KeywordEntry {
                    facet: row.facet,
                    value: row.value,
                });
        }
        let mut albums_by_id: HashMap<String, Vec<String>> = HashMap::new();
        for link in links {
            albums_by_id
                .entry(link.asset_id)
                .or_default()
                .push(link.album_id);
        }

        let mut out = Vec::with_capacity(assets.len());
        for row in assets {
            let meta = meta_by_id.remove(&row.id);
            let metadata: Value = row
                .metadata
                .as_deref()
                .and_then(|raw| serde_json::from_str(raw).ok())
                .unwrap_or(Value::Null);
            out.push(GalleryDetails {
                keywords: keywords_by_id.remove(&row.id).unwrap_or_default(),
                album_ids: albums_by_id.remove(&row.id).unwrap_or_default(),
                content_hash: meta.as_ref().and_then(|m| m.content_hash.clone()),
                mtime_ms: meta.as_ref().and_then(|m| m.mtime_ms),
                size_bytes: meta.as_ref().and_then(|m| m.size_bytes).or(row.size),
                width: meta.as_ref().and_then(|m| m.width),
                height: meta.as_ref().and_then(|m| m.height),
                captured_at: meta.as_ref().and_then(|m| m.captured_at),
                date_source: meta.as_ref().and_then(|m| m.date_source.clone()),
                exif: metadata.get("exif").cloned().filter(|v| !v.is_null()),
                gps: metadata.get("gps").cloned().filter(|v| !v.is_null()),
                id: row.id,
            });
        }
        Ok(out)
    }

    /// 检索：`searchText`（文件名/拼音/关键词）命中 + 相簿名命中。
    #[allow(non_snake_case)]
    pub async fn toSearch<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        text: &str,
    ) -> Result<Vec<String>, Exception> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Ok(vec![]);
        }
        let needle = format!("%{}%", trimmed.to_lowercase());
        let mut ids: HashSet<String> = HashSet::new();

        let hits = gallery_asset::Entity::find()
            .filter(gallery_asset::Column::SearchText.like(needle.clone()))
            .all(db)
            .await?;
        for hit in hits {
            ids.insert(hit.asset_id);
        }

        let albums = album::Entity::find()
            .filter(album::Column::Name.like(needle))
            .all(db)
            .await?;
        if !albums.is_empty() {
            let album_ids: Vec<String> = albums.into_iter().map(|row| row.id).collect();
            let links = gallery_album_asset::Entity::find()
                .filter(gallery_album_asset::Column::AlbumId.is_in(album_ids))
                .all(db)
                .await?;
            for link in links {
                ids.insert(link.asset_id);
            }
        }
        Ok(ids.into_iter().collect())
    }

    // ── 写 ──────────────────────────────────────────────────────────────

    #[allow(non_snake_case)]
    pub async fn toCurate<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        args: CurateArgs,
    ) -> Result<Vec<String>, Exception> {
        if args.ids.is_empty() {
            return Ok(vec![]);
        }
        if let Some(rating) = args.patch.rating {
            if !(0..=5).contains(&rating) {
                return Err(Exception::Validation("rating 必须是 0–5".into()));
            }
        }
        if let Some(Some(flag)) = &args.patch.flag {
            if flag != "rejected" && flag != "picked" {
                return Err(Exception::Validation(
                    "flag 只能是 rejected / picked".into(),
                ));
            }
        }
        if let Some(Some(label)) = &args.patch.label {
            if !matches!(
                label.as_str(),
                "red" | "yellow" | "green" | "blue" | "purple"
            ) {
                return Err(Exception::Validation("label 不合法".into()));
            }
        }
        if let Some(keywords) = &args.patch.keywords {
            for keyword in keywords {
                if !matches!(keyword.facet.as_str(), "people" | "places" | "themes") {
                    return Err(Exception::Validation(
                        "关键词 facet 只能是 people / places / themes".into(),
                    ));
                }
            }
        }

        let txn = db.begin().await?;
        let now = now_ms();

        // 去重：前端「按组展开」后可能带重复 id；重复 id 在批量 insert 里会直接撞主键
        let mut seen = HashSet::with_capacity(args.ids.len());
        let ids: Vec<String> = args
            .ids
            .into_iter()
            .filter(|id| seen.insert(id.clone()))
            .collect();

        // 批量：先一次取出已有的侧表行，再「已有的 update_many（字段全组一致）+ 没有的批量 insert」。
        // 逐 id 的 find_by_id + update 在「全选 1 万张改星级」时是 2 万次往返，
        // 而单连接（`max_connections(1)`）下这些往返会把其他命令全堵在后面。
        let existing_rows = gallery_asset::Entity::find()
            .filter(gallery_asset::Column::AssetId.is_in(ids.clone()))
            .all(&txn)
            .await?;
        let existing_ids: HashSet<String> = existing_rows
            .iter()
            .map(|row| row.asset_id.clone())
            .collect();

        if !existing_rows.is_empty() {
            let mut patch_model = gallery_asset::ActiveModel {
                updated_at: Set(now),
                ..Default::default()
            };
            if let Some(rating) = args.patch.rating {
                patch_model.rating = Set(rating);
            }
            if let Some(flag) = &args.patch.flag {
                patch_model.flag = Set(flag.clone());
            }
            if let Some(label) = &args.patch.label {
                patch_model.label = Set(label.clone());
            }
            if let Some(hidden) = args.patch.hidden {
                patch_model.hidden = Set(i64::from(hidden));
            }
            gallery_asset::Entity::update_many()
                .set(patch_model)
                .filter(gallery_asset::Column::AssetId.is_in(existing_ids.iter().cloned()))
                .exec(&txn)
                .await?;
        }

        // 没有侧表行的（capture / clipboard 刚写入的 asset）补建一条，否则这次改动会丢
        let mut fresh_rows = Vec::new();
        for id in &ids {
            if existing_ids.contains(id) {
                continue;
            }
            let mut row = blank_row(id);
            if let Some(rating) = args.patch.rating {
                row.rating = rating;
            }
            if let Some(flag) = &args.patch.flag {
                row.flag = flag.clone();
            }
            if let Some(label) = &args.patch.label {
                row.label = label.clone();
            }
            if let Some(hidden) = args.patch.hidden {
                row.hidden = i64::from(hidden);
            }
            row.updated_at = now;
            fresh_rows.push(to_active(&row));
        }
        // 分块：单条多行 INSERT 的参数有上限（24 列 × 行数），一次性塞几千行会被驱动拒绝
        for batch in fresh_rows.chunks(100) {
            gallery_asset::Entity::insert_many(batch.to_vec())
                .exec(&txn)
                .await?;
        }

        let mut touched = Vec::with_capacity(ids.len());
        for id in &ids {
            // keep / 关键词仍在 `asset.metadata` / 关键词表里，只在真给了的时候才动
            if let Some(keep) = args.patch.keep {
                Self::toWriteMetaFlag(&txn, id, "keep", keep).await?;
            }
            if let Some(keywords) = &args.patch.keywords {
                Self::toReplaceKeywords(&txn, id, keywords).await?;
                Self::toRefreshSearchText(&txn, id).await?;
            }
            touched.push(id.clone());
        }
        txn.commit().await?;
        Ok(touched)
    }

    /// 探测结果写回（导入管线 / 补探测共用）。
    #[allow(non_snake_case)]
    pub async fn toWriteProbe<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        id: &str,
        probe: ProbeResult,
    ) -> Result<(), Exception> {
        let existing = gallery_asset::Entity::find_by_id(id.to_string())
            .one(db)
            .await?;
        let mut row = existing.clone().unwrap_or_else(|| blank_row(id));
        if probe.captured_at.is_some() {
            row.captured_at = probe.captured_at;
        }
        if probe.date_source.is_some() {
            row.date_source = probe.date_source;
        }
        if probe.size_bytes.is_some() {
            row.size_bytes = probe.size_bytes;
        }
        if probe.mtime_ms.is_some() {
            row.mtime_ms = probe.mtime_ms;
        }
        if probe.width.is_some() {
            row.width = probe.width;
        }
        if probe.height.is_some() {
            row.height = probe.height;
        }
        if probe.duration_ms.is_some() {
            row.duration_ms = probe.duration_ms;
        }
        if probe.stack_id.is_some() {
            row.stack_id = probe.stack_id;
        }
        if probe.search_text.is_some() {
            row.search_text = probe.search_text.clone();
        }
        row.probed_at = Some(now_ms());
        row.updated_at = now_ms();
        let active = to_active(&row);
        if existing.is_some() {
            active.update(db).await?;
        } else {
            // 不用 `ActiveModelTrait::insert`：它会对 TEXT 主键做 RETURNING 回查，
            // 在这套 SQLite 驱动上直接报 `Failed to find inserted item` ——
            // 而这条路径是「每次导入新文件」都要走的。
            gallery_asset::Entity::insert(active).exec(db).await?;
        }
        if !probe.keywords.is_empty() {
            Self::toReplaceKeywords(db, id, &probe.keywords).await?;
        }
        // 已经有 searchText（导入侧算好的 / 只有关键词变化时才需要重算）就跳过
        if probe.search_text.is_none() || !probe.keywords.is_empty() {
            Self::toRefreshSearchText(db, id).await?;
        }
        Ok(())
    }

    /// 派生指纹写回（去重 / 相似图 / 位置失效）。
    ///
    /// **upsert**：侧表行不存在时补建。早期版本直接 `return Ok(())`，而 dedupe / phash / rescan
    /// 都是先写派生、后才轮到其他路径建行 —— 结果是这些派生数据被静默丢弃（功能看起来“没生效”）。
    #[allow(non_snake_case)]
    pub async fn toWriteDerived<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        id: &str,
        patch: DerivedPatch,
    ) -> Result<(), Exception> {
        let existing = gallery_asset::Entity::find_by_id(id.to_string())
            .one(db)
            .await?;
        let mut row = existing.clone().unwrap_or_else(|| blank_row(id));
        if patch.content_hash.is_some() {
            row.content_hash = patch.content_hash;
        }
        if patch.dup_group.is_some() {
            row.dup_group = patch.dup_group;
        }
        if patch.phash.is_some() {
            row.phash = patch.phash;
        }
        if let Some(missing) = patch.missing {
            row.missing = i64::from(missing);
        }
        row.updated_at = now_ms();
        let active = to_active(&row);
        if existing.is_some() {
            active.update(db).await?;
        } else {
            gallery_asset::Entity::insert(active).exec(db).await?;
        }
        Ok(())
    }

    /// 批量派生写入：逐条语句但**只 commit 一次**。
    ///
    /// 去重 / 感知哈希 / 重扫动辄上万行，逐条 autocommit 等于每行一次 WAL 提交
    /// （而且单连接会把 UI 的其他请求堵在后面）；包进一个事务后开销降一个量级。
    #[allow(non_snake_case)]
    pub async fn toWriteDerivedMany<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        patches: Vec<(String, DerivedPatch)>,
    ) -> Result<usize, Exception> {
        if patches.is_empty() {
            return Ok(0);
        }
        let txn = db.begin().await?;
        let mut written = 0usize;
        for (id, patch) in patches {
            Self::toWriteDerived(&txn, &id, patch).await?;
            written += 1;
        }
        txn.commit().await?;
        Ok(written)
    }

    /// 相簿加入。相簿是派生视图，照片本身不动。
    ///
    /// 先一次查出已有的（assetID, albumID），只插缺的那几条 —— 旧实现逐 id `find_by_id`。
    #[allow(non_snake_case)]
    pub async fn toAttachAlbum<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        args: AlbumLinkArgs,
    ) -> Result<usize, Exception> {
        if args.ids.is_empty() {
            return Ok(0);
        }
        let now = now_ms();
        let txn = db.begin().await?;
        let existing: HashSet<String> = gallery_album_asset::Entity::find()
            .filter(gallery_album_asset::Column::AlbumId.eq(args.album_id.clone()))
            .filter(gallery_album_asset::Column::AssetId.is_in(args.ids.clone()))
            .all(&txn)
            .await?
            .into_iter()
            .map(|row| row.asset_id)
            .collect();

        let mut fresh = Vec::new();
        for id in &args.ids {
            if existing.contains(id) {
                continue;
            }
            fresh.push(gallery_album_asset::ActiveModel {
                asset_id: Set(id.clone()),
                album_id: Set(args.album_id.clone()),
                added_at: Set(now),
            });
        }
        let written = fresh.len();
        if !fresh.is_empty() {
            gallery_album_asset::Entity::insert_many(fresh)
                .exec(&txn)
                .await?;
        }
        txn.commit().await?;
        Ok(written)
    }

    #[allow(non_snake_case)]
    pub async fn toDetachAlbum<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        args: AlbumLinkArgs,
    ) -> Result<usize, Exception> {
        if args.ids.is_empty() {
            return Ok(0);
        }
        let result = gallery_album_asset::Entity::delete_many()
            .filter(gallery_album_asset::Column::AlbumId.eq(args.album_id))
            .filter(gallery_album_asset::Column::AssetId.is_in(args.ids))
            .exec(db)
            .await?;
        Ok(result.rows_affected as usize)
    }

    /// 标记「位置失效」（移动盘拔掉 / 文件被挪走）。不删行、不删策展数据。
    #[allow(non_snake_case)]
    pub async fn toMarkMissing<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        ids: Vec<String>,
        missing: bool,
    ) -> Result<usize, Exception> {
        if ids.is_empty() {
            return Ok(0);
        }
        let txn = db.begin().await?;
        let mut touched = 0usize;
        for id in ids {
            let existing = gallery_asset::Entity::find_by_id(id.clone())
                .one(&txn)
                .await?;
            let mut row = existing.clone().unwrap_or_else(|| blank_row(&id));
            row.missing = i64::from(missing);
            row.updated_at = now_ms();
            let active = to_active(&row);
            if existing.is_some() {
                active.update(&txn).await?;
            } else {
                gallery_asset::Entity::insert(active).exec(&txn).await?;
            }
            touched += 1;
        }
        txn.commit().await?;
        Ok(touched)
    }

    // ── 智能相簿 ────────────────────────────────────────────────────────

    #[allow(non_snake_case)]
    pub async fn toReadSmartAlbums<C: ConnectionTrait + TransactionTrait>(
        db: &C,
    ) -> Result<Vec<SmartAlbumRow>, Exception> {
        let rows = gallery_smart_album::Entity::find()
            .order_by_asc(gallery_smart_album::Column::Index)
            .order_by_desc(gallery_smart_album::Column::CreatedAt)
            .all(db)
            .await?;
        Ok(rows.into_iter().map(to_smart_row).collect())
    }

    #[allow(non_snake_case)]
    pub async fn toSaveSmartAlbum<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        input: SmartAlbumInput,
    ) -> Result<String, Exception> {
        let name = input.name.trim();
        if name.is_empty() {
            return Err(Exception::Validation("智能相簿需要名称".into()));
        }
        let now = now_ms();
        let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let existing = gallery_smart_album::Entity::find_by_id(id.clone())
            .one(db)
            .await?;
        match existing {
            Some(row) => {
                let mut active: gallery_smart_album::ActiveModel = row.into();
                active.name = Set(name.to_string());
                active.query = Set(input.query);
                active.index = Set(input.index);
                active.updated_at = Set(now);
                active.update(db).await?;
            }
            None => {
                gallery_smart_album::Entity::insert(gallery_smart_album::ActiveModel {
                    id: Set(id.clone()),
                    name: Set(name.to_string()),
                    query: Set(input.query),
                    index: Set(input.index),
                    created_at: Set(now),
                    updated_at: Set(now),
                })
                .exec(db)
                .await?;
            }
        }
        Ok(id)
    }

    #[allow(non_snake_case)]
    pub async fn toRemoveSmartAlbum<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        id: String,
    ) -> Result<bool, Exception> {
        let result = gallery_smart_album::Entity::delete_by_id(id)
            .exec(db)
            .await?;
        Ok(result.rows_affected > 0)
    }

    // ── 根目录 ──────────────────────────────────────────────────────────

    #[allow(non_snake_case)]
    pub async fn toReadRoots<C: ConnectionTrait + TransactionTrait>(
        db: &C,
    ) -> Result<Vec<RootRow>, Exception> {
        let rows = gallery_root::Entity::find()
            .order_by_asc(gallery_root::Column::AddedAt)
            .all(db)
            .await?;
        Ok(rows
            .into_iter()
            .map(|row| RootRow {
                id: row.id,
                path: row.path,
                added_at: row.added_at,
                last_scan_at: row.last_scan_at,
                is_watching: row.is_watching != 0,
            })
            .collect())
    }

    /// 加根目录。路径已存在则返回既有 id（幂等，重复导入同一目录不会长两条）。
    #[allow(non_snake_case)]
    pub async fn toAddRoot<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        path: &str,
    ) -> Result<String, Exception> {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return Err(Exception::Validation("根目录路径不能为空".into()));
        }
        if let Some(row) = gallery_root::Entity::find()
            .filter(gallery_root::Column::Path.eq(trimmed))
            .one(db)
            .await?
        {
            return Ok(row.id);
        }
        let id = Uuid::new_v4().to_string();
        gallery_root::Entity::insert(gallery_root::ActiveModel {
            id: Set(id.clone()),
            path: Set(trimmed.to_string()),
            added_at: Set(now_ms()),
            last_scan_at: Set(None),
            is_watching: Set(1),
        })
        .exec(db)
        .await?;
        Ok(id)
    }

    #[allow(non_snake_case)]
    pub async fn toRemoveRoot<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        id: String,
    ) -> Result<bool, Exception> {
        let result = gallery_root::Entity::delete_by_id(id).exec(db).await?;
        Ok(result.rows_affected > 0)
    }

    #[allow(non_snake_case)]
    pub async fn toTouchRoot<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        id: &str,
    ) -> Result<(), Exception> {
        let Some(row) = gallery_root::Entity::find_by_id(id.to_string())
            .one(db)
            .await?
        else {
            return Ok(());
        };
        let mut active: gallery_root::ActiveModel = row.into();
        active.last_scan_at = Set(Some(now_ms()));
        active.update(db).await?;
        Ok(())
    }

    // ── 回填与清理 ──────────────────────────────────────────────────────

    /// 一次性回填：把老库 `asset.metadata` 里的 hidden / capturedAt / albums 搬进新表。
    ///
    /// 用 `seedMark` 做幂等标记（与 `ensure_wallpaper_tile` 同一套做法）：
    /// 回填过的行 `probedAt` 留空，下次后台重探会补齐宽高/时长/哈希。
    #[allow(non_snake_case)]
    pub async fn toBackfill<C: ConnectionTrait + TransactionTrait>(
        db: &C,
    ) -> Result<usize, Exception> {
        db.execute_unprepared("CREATE TABLE IF NOT EXISTS seedMark (id TEXT PRIMARY KEY NOT NULL)")
            .await?;
        let marked = db
            .execute_unprepared(
                "INSERT OR IGNORE INTO seedMark (id) VALUES ('gallery-backfill-v1')",
            )
            .await?;
        if marked.rows_affected() == 0 {
            return Ok(0);
        }

        let assets = asset::Entity::find()
            .filter(asset::Column::ArchivedAt.is_null())
            .all(db)
            .await?;
        // 一次取出现有侧表 id 与相簿归属：回填只在第一次开图库时跑，
        // 但那次也可能面对 5 万张照片 —— 逐行 `find_by_id` 就是 5 万次往返。
        let known_ids: HashSet<String> = gallery_asset::Entity::find()
            .all(db)
            .await?
            .into_iter()
            .map(|row| row.asset_id)
            .collect();
        let known_links: HashSet<(String, String)> = gallery_album_asset::Entity::find()
            .all(db)
            .await?
            .into_iter()
            .map(|row| (row.asset_id, row.album_id))
            .collect();
        let txn = db.begin().await?;
        let mut written = 0usize;
        for row in assets {
            let metadata: Value = row
                .metadata
                .as_deref()
                .and_then(|raw| serde_json::from_str(raw).ok())
                .unwrap_or(Value::Null);

            if !known_ids.contains(&row.id) {
                let mut fresh = blank_row(&row.id);
                fresh.captured_at = metadata
                    .get("capturedAt")
                    .and_then(|v| v.as_i64())
                    .or(Some(row.created_at));
                fresh.date_source = meta_str(&metadata, "dateSource");
                fresh.hidden = i64::from(meta_flag(&metadata, "hidden"));
                fresh.search_text = Some(build_search_text(&row.file_name, &[]));
                gallery_asset::Entity::insert(to_active(&fresh))
                    .exec(&txn)
                    .await?;
                written += 1;
            }

            if let Some(albums) = metadata.get("albums").and_then(|v| v.as_array()) {
                for album_id in albums.iter().filter_map(|v| v.as_str()) {
                    if known_links.contains(&(row.id.clone(), album_id.to_string())) {
                        continue;
                    }
                    gallery_album_asset::Entity::insert(gallery_album_asset::ActiveModel {
                        asset_id: Set(row.id.clone()),
                        album_id: Set(album_id.to_string()),
                        added_at: Set(now_ms()),
                    })
                    .exec(&txn)
                    .await?;
                }
            }
        }
        txn.commit().await?;
        Ok(written)
    }

    /// 孤儿清扫：asset 行被别的域删掉后，侧表可能留下悬挂行。
    ///
    /// 不依赖「每个连接都开了 foreign_keys」这个前提，启动时显式跑一次。
    #[allow(non_snake_case)]
    pub async fn toCleanupOrphans<C: ConnectionTrait + TransactionTrait>(
        db: &C,
    ) -> Result<u64, Exception> {
        let mut total = 0u64;
        for table in ["galleryAsset", "galleryAlbumAsset", "galleryKeyword"] {
            let result = db
                .execute_unprepared(&format!(
                    "DELETE FROM {table} WHERE \"assetID\" NOT IN (SELECT id FROM asset)"
                ))
                .await?;
            total += result.rows_affected();
        }
        Ok(total)
    }

    // ── 内部工具 ────────────────────────────────────────────────────────

    #[allow(non_snake_case)]
    async fn toWriteMetaFlag<C: ConnectionTrait>(
        db: &C,
        id: &str,
        key: &str,
        value: bool,
    ) -> Result<(), Exception> {
        let Some(row) = asset::Entity::find_by_id(id.to_string()).one(db).await? else {
            return Ok(());
        };
        let mut metadata: Value = row
            .metadata
            .as_deref()
            .and_then(|raw| serde_json::from_str(raw).ok())
            .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
        if !metadata.is_object() {
            metadata = Value::Object(serde_json::Map::new());
        }
        if let Value::Object(map) = &mut metadata {
            map.insert(key.to_string(), Value::Bool(value));
        }
        let mut active: asset::ActiveModel = row.into();
        active.metadata = Set(Some(metadata.to_string()));
        active.update(db).await?;
        Ok(())
    }

    #[allow(non_snake_case)]
    async fn toReplaceKeywords<C: ConnectionTrait>(
        db: &C,
        id: &str,
        keywords: &[KeywordEntry],
    ) -> Result<(), Exception> {
        gallery_keyword::Entity::delete_many()
            .filter(gallery_keyword::Column::AssetId.eq(id))
            .exec(db)
            .await?;
        let mut seen = HashSet::new();
        for keyword in keywords {
            let value = keyword.value.trim();
            if value.is_empty() {
                continue;
            }
            if !seen.insert((keyword.facet.clone(), value.to_string())) {
                continue;
            }
            gallery_keyword::Entity::insert(gallery_keyword::ActiveModel {
                asset_id: Set(id.to_string()),
                facet: Set(keyword.facet.clone()),
                value: Set(value.to_string()),
            })
            .exec(db)
            .await?;
        }
        Ok(())
    }

    #[allow(non_snake_case)]
    async fn toRefreshSearchText<C: ConnectionTrait>(db: &C, id: &str) -> Result<(), Exception> {
        let Some(asset_row) = asset::Entity::find_by_id(id.to_string()).one(db).await? else {
            return Ok(());
        };
        let keywords = gallery_keyword::Entity::find()
            .filter(gallery_keyword::Column::AssetId.eq(id))
            .all(db)
            .await?;
        let values: Vec<&str> = keywords.iter().map(|row| row.value.as_str()).collect();
        let text = build_search_text(&asset_row.file_name, &values);
        let Some(existing) = gallery_asset::Entity::find_by_id(id.to_string())
            .one(db)
            .await?
        else {
            return Ok(());
        };
        let mut row = existing.clone();
        row.search_text = Some(text);
        to_active(&row).update(db).await?;
        Ok(())
    }
}

fn to_smart_row(row: gallery_smart_album::Model) -> SmartAlbumRow {
    SmartAlbumRow {
        id: row.id,
        name: row.name,
        query: row.query,
        index: row.index,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_text_includes_pinyin_and_initials() {
        let text = build_search_text("故宫-2026.jpg", &[]);
        assert!(text.contains("gugong"), "全拼缺失：{text}");
        assert!(text.contains("gg"), "首字母缺失：{text}");
    }

    #[test]
    fn search_text_keeps_ascii_names() {
        let text = build_search_text("IMG_4521.JPG", &[]);
        assert!(text.contains("img_4521.jpg"), "文件名应小写保留：{text}");
    }

    #[test]
    fn kind_falls_back_to_mime() {
        assert_eq!(to_kind(None, "image/jpeg"), "image");
        assert_eq!(to_kind(Some("video"), "application/octet-stream"), "video");
        assert_eq!(to_kind(None, "application/pdf"), "other");
    }

    // ── 真实 SQLite 上的行为验证（批量写是这一轮的主要改动，值得钉住）──

    async fn fresh_db() -> cogito_database::Connection {
        let db = cogito_database::initialize("sqlite::memory:")
            .await
            .expect("建库失败");
        cogito_database::migration::run(&db)
            .await
            .expect("迁移失败");
        db
    }

    async fn insert_asset(db: &cogito_database::Connection, id: &str, mime: &str, name: &str) {
        asset::Entity::insert(asset::ActiveModel {
            id: Set(id.to_string()),
            tenant_id: Set(None),
            kind: Set(match mime {
                m if m.starts_with("image/") => Some("image".to_string()),
                m if m.starts_with("video/") => Some("video".to_string()),
                _ => None,
            }),
            hash: Set(None),
            sha: Set(String::new()),
            size: Set(Some(1024)),
            index: Set(0),
            mime: Set(mime.to_string()),
            extension: Set(Some("jpg".into())),
            file_name: Set(name.to_string()),
            file_path: Set(format!("C:/photos/{name}")),
            metadata: Set(None),
            status: Set("029".into()),
            device_id: Set(None),
            archived_at: Set(None),
            created_at: Set(1),
            updated_at: Set(1),
        })
        .exec(&**db)
        .await
        .expect("插入 asset 失败");
    }

    #[tokio::test]
    async fn curate_updates_existing_and_creates_missing_rows() {
        let db = fresh_db().await;
        insert_asset(&db, "a", "image/jpeg", "a.jpg").await;
        insert_asset(&db, "b", "image/jpeg", "b.jpg").await;

        // 先给 a 造一条带 searchText 的侧表行：批量 update 只该动 patch 里的列
        let mut seeded = blank_row("a");
        seeded.search_text = Some("keep-me".into());
        gallery_asset::Entity::insert(to_active(&seeded))
            .exec(&*db)
            .await
            .expect("seed");

        let touched = Service::toCurate(
            &*db,
            CurateArgs {
                ids: vec!["a".into(), "b".into(), "b".into()],
                patch: CuratePatch {
                    rating: Some(5),
                    ..Default::default()
                },
            },
        )
        .await
        .expect("策展失败");
        // 重复 id 只算一次
        assert_eq!(touched, vec!["a".to_string(), "b".to_string()]);

        let a = gallery_asset::Entity::find_by_id("a".to_string())
            .one(&*db)
            .await
            .expect("查询失败")
            .expect("a 应存在");
        assert_eq!(a.rating, 5);
        assert_eq!(
            a.search_text.as_deref(),
            Some("keep-me"),
            "未提供的列不能被清"
        );

        let b = gallery_asset::Entity::find_by_id("b".to_string())
            .one(&*db)
            .await
            .expect("查询失败")
            .expect("b 应被补建");
        assert_eq!(b.rating, 5);
    }

    #[tokio::test]
    async fn derived_write_upserts_missing_side_row() {
        let db = fresh_db().await;
        insert_asset(&db, "a", "image/jpeg", "a.jpg").await;

        Service::toWriteDerived(
            &*db,
            "a",
            DerivedPatch {
                content_hash: Some("hash".into()),
                ..Default::default()
            },
        )
        .await
        .expect("写派生失败");

        let row = gallery_asset::Entity::find_by_id("a".to_string())
            .one(&*db)
            .await
            .expect("查询失败")
            .expect("侧表行应被补建");
        assert_eq!(row.content_hash.as_deref(), Some("hash"));
    }

    /// 导入热路径：asset 刚插入、侧表还没有行时，`toWriteProbe` 必须能建行。
    /// （这条路径曾因 `ActiveModelTrait::insert` 的 RETURNING 回查直接报错。）
    #[tokio::test]
    async fn probe_write_creates_side_row() {
        let db = fresh_db().await;
        insert_asset(&db, "a", "image/jpeg", "故宫.jpg").await;

        Service::toWriteProbe(
            &*db,
            "a",
            ProbeResult {
                captured_at: Some(123),
                date_source: Some("exif".into()),
                size_bytes: Some(2048),
                search_text: Some(Service::toSearchText("故宫.jpg", &[])),
                ..Default::default()
            },
        )
        .await
        .expect("写探针失败");

        let row = gallery_asset::Entity::find_by_id("a".to_string())
            .one(&*db)
            .await
            .expect("查询失败")
            .expect("侧表行应被建出来");
        assert_eq!(row.captured_at, Some(123));
        assert_eq!(row.size_bytes, Some(2048));
        assert!(row.probed_at.is_some());
        assert!(
            row.search_text
                .as_deref()
                .unwrap_or_default()
                .contains("gugong")
        );

        // 再写一次走 update 分支，不能报错
        Service::toWriteProbe(
            &*db,
            "a",
            ProbeResult {
                width: Some(4),
                ..Default::default()
            },
        )
        .await
        .expect("更新探针失败");
    }

    #[tokio::test]
    async fn catalog_only_returns_media_with_keywords() {
        let db = fresh_db().await;
        insert_asset(&db, "img", "image/jpeg", "故宫.jpg").await;
        insert_asset(&db, "vid", "video/mp4", "clip.mp4").await;
        insert_asset(&db, "pdf", "application/pdf", "doc.pdf").await;

        Service::toCurate(
            &*db,
            CurateArgs {
                ids: vec!["img".into()],
                patch: CuratePatch {
                    keywords: Some(vec![KeywordEntry {
                        facet: "people".into(),
                        value: "妈妈".into(),
                    }]),
                    ..Default::default()
                },
            },
        )
        .await
        .expect("写关键词失败");

        let payload = Service::toReadCatalog(&*db).await.expect("catalog 失败");
        let ids: Vec<&str> = payload.rows.iter().map(|row| row.id.as_str()).collect();
        assert_eq!(payload.total, 2);
        assert!(!ids.contains(&"pdf"), "非媒体行不该进图库：{ids:?}");

        let image = payload
            .rows
            .iter()
            .find(|row| row.id == "img")
            .expect("缺 img");
        assert_eq!(image.keywords.len(), 1);
        // 关键词要进检索文本，否则拼音/关键词搜索都搜不到
        let searched = Service::toSearch(&*db, "妈妈").await.expect("搜索失败");
        assert_eq!(searched, vec!["img".to_string()]);
    }
}
