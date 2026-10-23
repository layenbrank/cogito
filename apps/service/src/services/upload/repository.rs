use std::path::Path;

use chrono::{Duration, Utc};
use entity::{asset, chunk};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, DatabaseBackend,
    DatabaseTransaction, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set,
    Statement,
};
use uuid::Uuid;

use crate::services::upload::error::UploadError;
use crate::services::upload::schema::{
    AssetR, PrepareP, UploadStatus, UploadedChunk, Visibility, viewers_from_json,
};
use crate::services::upload::validation::{
    ASSET_URL_PREFIX, EXPIRE_HOURS, FILE_URL_PREFIX, KIND, normalize_hash, visibility_for_insert,
};

pub async fn find_completed(
    tx: &DatabaseTransaction,
    hash: &str,
) -> Result<Option<asset::Model>, UploadError> {
    if normalize_hash(Some(hash)).is_none() {
        return Ok(None);
    }
    asset::Entity::find()
        .filter(asset::Column::Hash.eq(hash))
        .filter(asset::Column::Status.eq(UploadStatus::Completed.as_str()))
        .filter(asset::Column::ArchivedAt.is_null())
        .order_by_desc(asset::Column::CreatedAt)
        .limit(1)
        .one(tx)
        .await
        .map_err(|e| UploadError::Database(e.to_string()))
}

pub async fn find_completed_owned(
    tx: &DatabaseTransaction,
    hash: &str,
    creator: &str,
) -> Result<Option<asset::Model>, UploadError> {
    if normalize_hash(Some(hash)).is_none() {
        return Ok(None);
    }
    let creator = UploadError::parse_user_id(creator)?;
    asset::Entity::find()
        .filter(asset::Column::Hash.eq(hash))
        .filter(asset::Column::Creator.eq(creator))
        .filter(asset::Column::Status.eq(UploadStatus::Completed.as_str()))
        .filter(asset::Column::ArchivedAt.is_null())
        .order_by_desc(asset::Column::CreatedAt)
        .limit(1)
        .one(tx)
        .await
        .map_err(|e| UploadError::Database(e.to_string()))
}

pub async fn find_file_for_download(
    tx: &DatabaseTransaction,
    hash: &str,
    user_id: &str,
) -> Result<Option<asset::Model>, UploadError> {
    find_completed_owned(tx, hash, user_id).await
}

pub async fn find_pending(
    tx: &DatabaseTransaction,
    hash: &str,
    creator: Option<&str>,
) -> Result<Option<asset::Model>, UploadError> {
    if normalize_hash(Some(hash)).is_none() {
        return Ok(None);
    }
    let Some(creator) = creator else {
        return Ok(None);
    };
    let creator = UploadError::parse_user_id(creator)?;
    let now = Utc::now().fixed_offset();

    asset::Entity::find()
        .filter(asset::Column::Hash.eq(hash))
        .filter(asset::Column::Creator.eq(creator))
        .filter(asset::Column::ArchivedAt.is_null())
        .filter(asset::Column::Status.is_in([
            UploadStatus::Pending.as_str(),
            UploadStatus::Uploading.as_str(),
        ]))
        .filter(
            Condition::any()
                .add(asset::Column::ExpiresAt.is_null())
                .add(asset::Column::ExpiresAt.gt(now)),
        )
        .order_by_desc(asset::Column::CreatedAt)
        .limit(1)
        .one(tx)
        .await
        .map_err(|e| UploadError::Database(e.to_string()))
}

pub async fn find_by_id(tx: &DatabaseTransaction, id: &str) -> Result<asset::Model, UploadError> {
    let id = UploadError::parse_asset_id(id)?;
    asset::Entity::find_by_id(id)
        .one(tx)
        .await
        .map_err(|e| UploadError::Database(e.to_string()))?
        .ok_or(UploadError::NotFound)
}

pub fn build_record(
    req: PrepareP,
    creator: Option<String>,
) -> Result<asset::ActiveModel, UploadError> {
    let total = (req.size + req.chunk as u64 - 1) / req.chunk as u64;
    let now = Utc::now().fixed_offset();
    let creator = match creator.as_deref() {
        Some(id) => Some(UploadError::parse_user_id(id)?),
        None => None,
    };
    let extension = Path::new(&req.name)
        .extension()
        .map(|e| e.to_string_lossy().into_owned());
    let hash = normalize_hash(req.hash.as_deref())
        .unwrap_or("")
        .to_string();
    let (visibility, viewers) = visibility_for_insert(&req)?;

    Ok(asset::ActiveModel {
        id: Set(Uuid::new_v4()),
        tenant_id: Set(req.tenant_id),
        kind: Set(Some(KIND.to_string())),
        hash: Set(hash),
        sha: Set(None),
        size: Set(req.size as i64),
        index: Set(req.index.unwrap_or(0)),
        mime: Set(req.mime),
        extension: Set(extension),
        name: Set(req.name),
        status: Set(UploadStatus::Pending.as_str().to_string()),
        visibility: Set(visibility),
        viewers: Set(viewers),
        chunk: Set(req.chunk as i32),
        total: Set(total as i32),
        archived_at: Set(None),
        created_at: Set(now),
        creator: Set(creator),
        updated_at: Set(now),
        updater: Set(creator),
        expires_at: Set(Some(now + Duration::hours(EXPIRE_HOURS))),
        ..Default::default()
    })
}

pub async fn insert(
    tx: &DatabaseTransaction,
    record: asset::ActiveModel,
) -> Result<asset::Model, UploadError> {
    record
        .insert(tx)
        .await
        .map_err(|e| UploadError::Database(e.to_string()))
}

/// 全局秒传：为当前用户克隆 COMPLETED 资产 + chunk 行（共享 CAS，不拷贝字节）。
/// `name` 使用当前会话/请求文件名，不用源用户文件名。
pub async fn clone_completed_for(
    tx: &DatabaseTransaction,
    source: &asset::Model,
    creator: &str,
    name: &str,
) -> Result<asset::Model, UploadError> {
    let creator_id = UploadError::parse_user_id(creator)?;
    let now = Utc::now().fixed_offset();
    let extension = std::path::Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .or_else(|| source.extension.clone());
    let record = asset::ActiveModel {
        id: Set(Uuid::new_v4()),
        tenant_id: Set(None),
        kind: Set(source.kind.clone()),
        hash: Set(source.hash.clone()),
        sha: Set(source.sha.clone()),
        size: Set(source.size),
        index: Set(0),
        mime: Set(source.mime.clone()),
        extension: Set(extension),
        name: Set(name.to_string()),
        status: Set(UploadStatus::Completed.as_str().to_string()),
        visibility: Set(Visibility::Private.as_str().to_string()),
        viewers: Set(None),
        chunk: Set(source.chunk),
        total: Set(source.total),
        archived_at: Set(None),
        created_at: Set(now),
        creator: Set(Some(creator_id)),
        updated_at: Set(now),
        updater: Set(Some(creator_id)),
        expires_at: Set(None),
        ..Default::default()
    };
    let inserted = insert(tx, record).await?;
    copy_chunks(tx, source.id, inserted.id, Some(creator_id)).await?;
    Ok(inserted)
}

/// 文件级秒传要求 size 与分片大小一致（从而 total 一致）。
pub fn layout_matches(pending: &asset::Model, existing: &asset::Model) -> bool {
    pending.size == existing.size && pending.chunk == existing.chunk
}

/// Abort 未完成会话：硬删 asset（CASCADE 清 chunk 元数据），不动 CAS。
pub async fn discard_session(
    tx: &DatabaseTransaction,
    asset: asset::Model,
) -> Result<(), UploadError> {
    let id = asset.id;
    asset::Entity::delete_by_id(id)
        .exec(tx)
        .await
        .map_err(|e| UploadError::Database(e.to_string()))?;
    Ok(())
}

async fn copy_chunks(
    tx: &DatabaseTransaction,
    from_asset: Uuid,
    to_asset: Uuid,
    creator: Option<Uuid>,
) -> Result<(), UploadError> {
    let rows = list_chunk_rows(tx, from_asset).await?;
    let now = Utc::now().fixed_offset();
    for row in rows {
        let model = chunk::ActiveModel {
            id: Set(Uuid::new_v4()),
            asset_id: Set(to_asset),
            index: Set(row.index),
            hash: Set(row.hash),
            size: Set(row.size),
            created_at: Set(now),
            creator: Set(creator),
            ..Default::default()
        };
        model
            .insert(tx)
            .await
            .map_err(|e| UploadError::Database(e.to_string()))?;
    }
    Ok(())
}

pub async fn list_chunk_rows(
    tx: &DatabaseTransaction,
    asset_id: Uuid,
) -> Result<Vec<chunk::Model>, UploadError> {
    chunk::Entity::find()
        .filter(chunk::Column::AssetId.eq(asset_id))
        .order_by_asc(chunk::Column::Index)
        .all(tx)
        .await
        .map_err(|e| UploadError::Database(e.to_string()))
}

pub async fn uploaded_list(
    tx: &DatabaseTransaction,
    asset_id: Uuid,
) -> Result<Vec<UploadedChunk>, UploadError> {
    let rows = list_chunk_rows(tx, asset_id).await?;
    Ok(rows
        .into_iter()
        .map(|r| UploadedChunk {
            index: r.index as u32,
            hash: r.hash,
        })
        .collect())
}

pub async fn ordered_chunk_hashes(
    tx: &DatabaseTransaction,
    asset: &asset::Model,
) -> Result<Vec<String>, UploadError> {
    let rows = list_chunk_rows(tx, asset.id).await?;
    if rows.len() != asset.total as usize {
        return Err(UploadError::BadRequest(format!(
            "分片记录不完整：{} / {}",
            rows.len(),
            asset.total
        )));
    }
    let mut out = Vec::with_capacity(asset.total as usize);
    for (expected, row) in rows.into_iter().enumerate() {
        if row.index != expected as i32 {
            return Err(UploadError::BadRequest(format!(
                "缺少分片索引 {expected}：实际 {}",
                row.index
            )));
        }
        out.push(row.hash);
    }
    Ok(out)
}

pub async fn find_chunk(
    tx: &DatabaseTransaction,
    asset_id: Uuid,
    index: u32,
) -> Result<Option<chunk::Model>, UploadError> {
    chunk::Entity::find()
        .filter(chunk::Column::AssetId.eq(asset_id))
        .filter(chunk::Column::Index.eq(index as i32))
        .one(tx)
        .await
        .map_err(|e| UploadError::Database(e.to_string()))
}

pub async fn count_chunks(tx: &DatabaseTransaction, asset_id: Uuid) -> Result<u64, UploadError> {
    chunk::Entity::find()
        .filter(chunk::Column::AssetId.eq(asset_id))
        .count(tx)
        .await
        .map_err(|e| UploadError::Database(e.to_string()))
}

/// 登记分片：UPSERT，同 index 同 hash 幂等；同 index 不同 hash 拒绝。
pub async fn upsert_chunk(
    tx: &DatabaseTransaction,
    asset: &asset::Model,
    index: u32,
    chunk_hash: &str,
    size: i64,
    creator: Option<&str>,
) -> Result<(), UploadError> {
    if let Some(existing) = find_chunk(tx, asset.id, index).await? {
        if existing.hash != chunk_hash {
            return Err(UploadError::BadRequest(format!(
                "分片 {index} 已存在但 hash 不一致，请取消后重传"
            )));
        }
        return Ok(());
    }

    let creator = match creator {
        Some(id) => Some(UploadError::parse_user_id(id)?),
        None => None,
    };
    let now = Utc::now().fixed_offset();

    // cancel 硬删可能与并发 chunk 竞态：插入前再确认会话仍在。
    if asset::Entity::find_by_id(asset.id)
        .one(tx)
        .await
        .map_err(|e| UploadError::Database(e.to_string()))?
        .is_none()
    {
        return Err(UploadError::SessionGone);
    }

    let result = tx
        .execute_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"INSERT INTO chunk (id, "assetID", "index", hash, size, "createdAt", creator)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT ("assetID", "index") DO NOTHING"#,
            [
                Uuid::new_v4().into(),
                asset.id.into(),
                (index as i32).into(),
                chunk_hash.to_string().into(),
                size.into(),
                now.into(),
                creator.into(),
            ],
        ))
        .await
        .map_err(|e| {
            if crate::utils::db::is_fk_violation(&e) {
                UploadError::SessionGone
            } else {
                UploadError::Database(e.to_string())
            }
        })?;

    if result.rows_affected() == 0 {
        // 并发插入：再读校验
        if let Some(existing) = find_chunk(tx, asset.id, index).await? {
            if existing.hash != chunk_hash {
                return Err(UploadError::BadRequest(format!(
                    "分片 {index} 已存在但 hash 不一致，请取消后重传"
                )));
            }
            return Ok(());
        }
        return Err(UploadError::Internal("登记分片失败".into()));
    }

    // 标记上传中
    let mut active: asset::ActiveModel = asset.clone().into();
    active.status = Set(UploadStatus::Uploading.as_str().to_string());
    active.updated_at = Set(now);
    active
        .update(tx)
        .await
        .map_err(|e| UploadError::Database(e.to_string()))?;

    Ok(())
}

pub async fn bind_hash(
    tx: &DatabaseTransaction,
    asset: asset::Model,
    hash: &str,
) -> Result<asset::Model, UploadError> {
    let mut active: asset::ActiveModel = asset.into();
    active.hash = Set(hash.to_string());
    active.updated_at = Set(Utc::now().fixed_offset());
    active
        .update(tx)
        .await
        .map_err(|e| UploadError::Database(e.to_string()))
}

/// 改可见性与可见对象；`updater` 记进审计列。
///
/// 行级策略只认创建者：调用方必须已经以创建者身份进入作用域，否则这次 UPDATE 会一行都改不到
/// （而不是改错行）。
pub async fn update_visibility(
    tx: &DatabaseTransaction,
    asset: asset::Model,
    visibility: &str,
    viewers: Option<sea_orm::prelude::Json>,
    updater: Uuid,
) -> Result<asset::Model, UploadError> {
    let mut active: asset::ActiveModel = asset.into();
    active.visibility = Set(visibility.to_string());
    active.viewers = Set(viewers);
    active.updater = Set(Some(updater));
    active.updated_at = Set(Utc::now().fixed_offset());
    active
        .update(tx)
        .await
        .map_err(|e| UploadError::Database(e.to_string()))
}

/// 秒传：保留当前会话行，标记 SUPERSEDED 并指向已完成资产。
pub async fn mark_superseded(
    tx: &DatabaseTransaction,
    asset: asset::Model,
    target: Uuid,
) -> Result<(), UploadError> {
    let mut active: asset::ActiveModel = asset.into();
    active.status = Set(UploadStatus::Superseded.as_str().to_string());
    active.superseded = Set(Some(target));
    active.updated_at = Set(Utc::now().fixed_offset());
    active
        .update(tx)
        .await
        .map_err(|e| UploadError::Database(e.to_string()))?;
    Ok(())
}

pub async fn mark_completed(
    tx: &DatabaseTransaction,
    asset: &asset::Model,
    sha: &str,
) -> Result<(), UploadError> {
    let mut active: asset::ActiveModel = asset.clone().into();
    active.status = Set(UploadStatus::Completed.as_str().to_string());
    active.sha = Set(Some(sha.to_string()));
    active.expires_at = Set(None);
    active.updated_at = Set(Utc::now().fixed_offset());
    active
        .update(tx)
        .await
        .map_err(|e| UploadError::Database(e.to_string()))?;
    Ok(())
}

pub async fn mark_failed(tx: &DatabaseTransaction, asset: asset::Model) -> Result<(), UploadError> {
    let now = Utc::now().fixed_offset();
    let asset_id = asset.id;
    let mut active: asset::ActiveModel = asset.into();
    active.status = Set(UploadStatus::Failed.as_str().to_string());
    active.archived_at = Set(Some(now));
    active.updated_at = Set(now);
    active
        .update(tx)
        .await
        .map_err(|e| UploadError::Database(e.to_string()))?;

    chunk::Entity::delete_many()
        .filter(chunk::Column::AssetId.eq(asset_id))
        .exec(tx)
        .await
        .map_err(|e| UploadError::Database(e.to_string()))?;
    Ok(())
}

pub async fn list_owned(
    tx: &DatabaseTransaction,
    user_id: &str,
    page: u32,
    size: u32,
    status: Option<&UploadStatus>,
) -> Result<(Vec<AssetR>, u64), UploadError> {
    let creator = UploadError::parse_user_id(user_id)?;
    let status_filter = status
        .map(|s| s.as_str())
        .unwrap_or(UploadStatus::Completed.as_str());

    let selector = asset::Entity::find()
        .filter(asset::Column::Creator.eq(creator))
        .filter(asset::Column::ArchivedAt.is_null())
        .filter(asset::Column::Status.eq(status_filter))
        .order_by_asc(asset::Column::Index)
        .order_by_desc(asset::Column::CreatedAt);

    let count = selector
        .clone()
        .count(tx)
        .await
        .map_err(|e| UploadError::Database(e.to_string()))?;

    let page = page.max(1);
    let size = size.clamp(1, 100);
    let rows = selector
        .paginate(tx, size as u64)
        .fetch_page((page as u64).saturating_sub(1))
        .await
        .map_err(|e| UploadError::Database(e.to_string()))?;

    let items = rows.into_iter().map(asset_to_r).collect();
    Ok((items, count))
}

pub fn asset_to_r(asset: asset::Model) -> AssetR {
    let visibility = Visibility::from_db(&asset.visibility);
    let viewers = match visibility {
        Visibility::Restricted => viewers_from_json(&asset.viewers)
            .into_iter()
            .map(|id| id.to_string())
            .collect(),
        _ => Vec::new(),
    };
    AssetR {
        id: asset.id.to_string(),
        tenant_id: asset.tenant_id,
        name: asset.name,
        size: asset.size as u64,
        mime: asset.mime,
        hash: asset.hash.clone(),
        index: asset.index,
        status: UploadStatus::from_db(&asset.status),
        visibility,
        viewers,
        created_at: asset.created_at.timestamp_millis(),
        url: format!("{ASSET_URL_PREFIX}/{}", asset.id),
    }
}

pub async fn prepare_response(
    tx: &DatabaseTransaction,
    asset: &asset::Model,
    exists: bool,
) -> Result<crate::services::upload::schema::PrepareR, UploadError> {
    let uploaded = uploaded_list(tx, asset.id).await?;
    Ok(crate::services::upload::schema::PrepareR {
        id: asset.id.to_string(),
        exists,
        chunks: uploaded.iter().map(|c| c.index).collect(),
        uploaded,
        url: "/api/v1/upload/chunk".to_string(),
    })
}

pub fn file_url_by_hash(hash: &str) -> String {
    format!("{FILE_URL_PREFIX}/{hash}")
}

pub fn file_url_by_id(id: &Uuid) -> String {
    format!("{ASSET_URL_PREFIX}/{id}")
}
