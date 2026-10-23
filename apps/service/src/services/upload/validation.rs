use entity::asset;
use uuid::Uuid;

use crate::services::upload::error::UploadError;
use crate::services::upload::schema::{PrepareP, UploadStatus, Visibility, viewers_to_json};

pub const CAS_DIR: &str = "cas";
pub const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024 * 1024; // 10GB
pub const MIN_CHUNK_SIZE: u32 = 1024 * 1024 * 10; // 10MB
pub const MAX_CHUNK_SIZE: u32 = 1024 * 1024 * 100; // 100MB
pub const EXPIRE_HOURS: i64 = 24;
pub const FILE_URL_PREFIX: &str = "/api/v1/upload/files";
pub const ASSET_URL_PREFIX: &str = "/api/v1/upload/asset";
pub const KIND: &str = "upload";
pub const MAX_VIEWERS: usize = 100;

pub fn normalize_hash(hash: Option<&str>) -> Option<&str> {
    hash.map(str::trim).filter(|h| !h.is_empty())
}

pub fn validate_hash_hex(hash: &str) -> Result<(), UploadError> {
    if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(UploadError::BadRequest("文件哈希格式无效".into()));
    }
    Ok(())
}

pub fn validate_prepare(req: &PrepareP) -> Result<(), UploadError> {
    if req.size > MAX_FILE_SIZE {
        return Err(UploadError::BadRequest(format!(
            "文件大小超过 {}GB 限制",
            MAX_FILE_SIZE / (1024 * 1024 * 1024)
        )));
    }

    if req.chunk < MIN_CHUNK_SIZE || req.chunk > MAX_CHUNK_SIZE {
        return Err(UploadError::BadRequest(format!(
            "分片大小须在 {}MB 至 {}MB 之间",
            MIN_CHUNK_SIZE / (1024 * 1024),
            MAX_CHUNK_SIZE / (1024 * 1024)
        )));
    }

    if req.size == 0 {
        return Err(UploadError::BadRequest("文件大小必须大于 0".into()));
    }

    if req.name.trim().is_empty() {
        return Err(UploadError::BadRequest("文件名不能为空".into()));
    }

    if let Some(hash) = normalize_hash(req.hash.as_deref()) {
        validate_hash_hex(hash)?;
    }

    validate_visibility(req)?;

    Ok(())
}

/// 校验可见性；RESTRICTED 时解析并去重 viewers，其它模式忽略 viewers。
pub fn validate_visibility(req: &PrepareP) -> Result<(), UploadError> {
    parse_viewers(req.visibility(), req.viewers.as_deref())?;
    Ok(())
}

pub fn parse_viewers(
    visibility: Visibility,
    raw: Option<&[String]>,
) -> Result<Vec<Uuid>, UploadError> {
    if visibility != Visibility::Restricted {
        return Ok(Vec::new());
    }
    let Some(raw) = raw else {
        return Ok(Vec::new());
    };
    if raw.len() > MAX_VIEWERS {
        return Err(UploadError::BadRequest(format!(
            "指定用户数不能超过 {MAX_VIEWERS}"
        )));
    }
    let mut out = Vec::with_capacity(raw.len());
    for id in raw {
        let uid = Uuid::parse_str(id.trim())
            .map_err(|_| UploadError::BadRequest(format!("viewers 含无效用户 ID: {id}")))?;
        if !out.contains(&uid) {
            out.push(uid);
        }
    }
    Ok(out)
}

pub fn visibility_for_insert(
    req: &PrepareP,
) -> Result<(String, Option<sea_orm::prelude::Json>), UploadError> {
    let visibility = req.visibility();
    let viewers = parse_viewers(visibility.clone(), req.viewers.as_deref())?;
    Ok((visibility.as_str().to_string(), viewers_to_json(&viewers)))
}

pub fn validate_status(asset: &asset::Model) -> Result<(), UploadError> {
    if asset.archived_at.is_some() {
        return Err(UploadError::BadRequest("资源已归档".into()));
    }

    if asset
        .expires_at
        .is_some_and(|expires_at| expires_at < chrono::Utc::now().fixed_offset())
    {
        return Err(UploadError::BadRequest("上传已过期".into()));
    }

    match UploadStatus::from_db(&asset.status) {
        UploadStatus::Pending | UploadStatus::Uploading => Ok(()),
        UploadStatus::Superseded => Err(UploadError::BadRequest("上传已秒传".into())),
        UploadStatus::Completed => Err(UploadError::BadRequest("上传已完成".into())),
        UploadStatus::Failed => Err(UploadError::BadRequest("上传已失败，无法继续".into())),
        UploadStatus::Expired => Err(UploadError::BadRequest("上传已过期".into())),
    }
}

pub fn expected_chunk_size(asset: &asset::Model, index: u32) -> Result<usize, UploadError> {
    if index >= asset.total as u32 {
        return Err(UploadError::BadRequest(format!("分片索引无效: {index}")));
    }

    let expected_size = if index == asset.total as u32 - 1 {
        let remaining = asset.size as u64 % asset.chunk as u64;
        if remaining == 0 {
            asset.chunk as usize
        } else {
            remaining as usize
        }
    } else {
        asset.chunk as usize
    };
    Ok(expected_size)
}

pub fn validate_chunk_hash(hash: &str, calculated_hash: &str) -> Result<(), UploadError> {
    validate_hash_hex(hash)?;
    if calculated_hash != hash {
        return Err(UploadError::BadRequest(format!(
            "分片哈希不匹配：期望 {hash}，实际 {calculated_hash}"
        )));
    }
    Ok(())
}

pub fn validate_chunk_size(
    asset: &asset::Model,
    index: u32,
    data_len: usize,
) -> Result<(), UploadError> {
    let expected_size = expected_chunk_size(asset, index)?;
    if data_len != expected_size {
        return Err(UploadError::BadRequest(format!(
            "分片大小不匹配：期望 {expected_size}，实际 {data_len}"
        )));
    }
    Ok(())
}

pub fn validate_chunk(
    asset: &asset::Model,
    index: u32,
    data: &[u8],
    hash: &str,
    calculated_hash: &str,
) -> Result<(), UploadError> {
    validate_chunk_hash(hash, calculated_hash)?;
    validate_chunk_size(asset, index, data.len())
}

pub fn validate_completion(asset: &asset::Model, uploaded: u64) -> Result<(), UploadError> {
    if normalize_hash(Some(asset.hash.as_str())).is_none() {
        return Err(UploadError::BadRequest(
            "尚未绑定整文件哈希，请先 PATCH /upload/hash".into(),
        ));
    }
    validate_hash_hex(&asset.hash)?;

    if uploaded != asset.total as u64 {
        return Err(UploadError::BadRequest(format!(
            "上传未完成，缺少分片：{uploaded} / {}",
            asset.total
        )));
    }

    Ok(())
}

pub fn ensure_owner(asset: &asset::Model, user_id: &str) -> Result<(), UploadError> {
    ensure_owner_id(asset.creator, user_id)
}

pub fn ensure_owner_id(creator: Option<Uuid>, user_id: &str) -> Result<(), UploadError> {
    let uid = UploadError::parse_user_id(user_id)?;
    match creator {
        Some(creator) if creator == uid => Ok(()),
        _ => Err(UploadError::Forbidden),
    }
}

/// 下载 ACL：PUBLIC 可匿名；创建者始终可下；RESTRICTED 须登录且在 viewers（或本人）。
pub fn ensure_can_download(asset: &asset::Model, user_id: Option<&str>) -> Result<(), UploadError> {
    match Visibility::from_db(&asset.visibility) {
        Visibility::Public => Ok(()),
        Visibility::Private => {
            let Some(user_id) = user_id else {
                return Err(UploadError::Forbidden);
            };
            ensure_owner(asset, user_id)
        }
        Visibility::Restricted => {
            let Some(user_id) = user_id else {
                return Err(UploadError::Forbidden);
            };
            let uid = UploadError::parse_user_id(user_id)?;
            if asset.creator == Some(uid) {
                return Ok(());
            }
            let viewers = crate::services::upload::schema::viewers_from_json(&asset.viewers);
            if viewers.contains(&uid) {
                Ok(())
            } else {
                Err(UploadError::Forbidden)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn owner_ok() {
        let id = Uuid::new_v4();
        assert!(ensure_owner_id(Some(id), &id.to_string()).is_ok());
    }

    #[test]
    fn owner_forbidden_when_missing_or_mismatch() {
        let id = Uuid::new_v4();
        assert!(matches!(
            ensure_owner_id(None, &id.to_string()),
            Err(UploadError::Forbidden)
        ));
        assert!(matches!(
            ensure_owner_id(Some(Uuid::new_v4()), &id.to_string()),
            Err(UploadError::Forbidden)
        ));
    }

    #[test]
    fn owner_rejects_invalid_user_id() {
        assert!(matches!(
            ensure_owner_id(Some(Uuid::new_v4()), "not-a-uuid"),
            Err(UploadError::InvalidCreator)
        ));
    }

    #[test]
    fn prepare_rejects_bad_hash() {
        let req = PrepareP {
            name: "a.bin".into(),
            mime: "application/octet-stream".into(),
            size: 1024,
            chunk: MIN_CHUNK_SIZE,
            hash: Some("short".into()),
            tenant_id: None,
            index: None,
            visibility: None,
            viewers: None,
        };
        assert!(matches!(
            validate_prepare(&req),
            Err(UploadError::BadRequest(_))
        ));
    }

    #[test]
    fn prepare_allows_missing_hash() {
        let req = PrepareP {
            name: "a.bin".into(),
            mime: "application/octet-stream".into(),
            size: 1024,
            chunk: MIN_CHUNK_SIZE,
            hash: None,
            tenant_id: None,
            index: None,
            visibility: None,
            viewers: None,
        };
        assert!(validate_prepare(&req).is_ok());
    }

    #[test]
    fn empty_hash_is_treated_as_unbound() {
        assert!(normalize_hash(Some("")).is_none());
        assert!(normalize_hash(Some("   ")).is_none());
        assert!(normalize_hash(None).is_none());
    }

    #[test]
    fn superseded_is_not_a_writable_status() {
        let mut asset = entity::asset::Model {
            id: Uuid::new_v4(),
            tenant_id: None,
            kind: Some("upload".into()),
            hash: String::new(),
            sha: None,
            size: 1,
            index: 0,
            mime: "application/octet-stream".into(),
            extension: None,
            name: "a.bin".into(),
            status: UploadStatus::Superseded.as_str().to_string(),
            visibility: Visibility::Private.as_str().to_string(),
            viewers: None,
            chunk: MIN_CHUNK_SIZE as i32,
            total: 1,
            archived_at: None,
            created_at: chrono::Utc::now().fixed_offset(),
            creator: None,
            updated_at: chrono::Utc::now().fixed_offset(),
            updater: None,
            expires_at: None,
            superseded: Some(Uuid::new_v4()),
        };
        assert!(matches!(
            validate_status(&asset),
            Err(UploadError::BadRequest(msg)) if msg.contains("秒传")
        ));
        asset.status = UploadStatus::Uploading.as_str().to_string();
        assert!(validate_status(&asset).is_ok());
    }

    #[test]
    fn download_acl_private_public_restricted() {
        let owner = Uuid::new_v4();
        let other = Uuid::new_v4();
        let guest = Uuid::new_v4();
        let mut asset = entity::asset::Model {
            id: Uuid::new_v4(),
            tenant_id: None,
            kind: Some("upload".into()),
            hash: String::new(),
            sha: None,
            size: 1,
            index: 0,
            mime: "application/octet-stream".into(),
            extension: None,
            name: "a.bin".into(),
            status: UploadStatus::Completed.as_str().to_string(),
            visibility: Visibility::Private.as_str().to_string(),
            viewers: None,
            chunk: MIN_CHUNK_SIZE as i32,
            total: 1,
            archived_at: None,
            created_at: chrono::Utc::now().fixed_offset(),
            creator: Some(owner),
            updated_at: chrono::Utc::now().fixed_offset(),
            updater: Some(owner),
            expires_at: None,
            superseded: None,
        };

        assert!(ensure_can_download(&asset, Some(&owner.to_string())).is_ok());
        assert!(matches!(
            ensure_can_download(&asset, Some(&other.to_string())),
            Err(UploadError::Forbidden)
        ));
        assert!(matches!(
            ensure_can_download(&asset, None),
            Err(UploadError::Forbidden)
        ));

        asset.visibility = Visibility::Public.as_str().to_string();
        assert!(ensure_can_download(&asset, Some(&other.to_string())).is_ok());
        assert!(ensure_can_download(&asset, None).is_ok());

        asset.visibility = Visibility::Restricted.as_str().to_string();
        asset.viewers = viewers_to_json(&[other]);
        assert!(ensure_can_download(&asset, Some(&other.to_string())).is_ok());
        assert!(matches!(
            ensure_can_download(&asset, Some(&guest.to_string())),
            Err(UploadError::Forbidden)
        ));
        assert!(matches!(
            ensure_can_download(&asset, None),
            Err(UploadError::Forbidden)
        ));
    }

    #[test]
    fn restricted_rejects_invalid_viewer_id() {
        let req = PrepareP {
            name: "a.bin".into(),
            mime: "application/octet-stream".into(),
            size: 1024,
            chunk: MIN_CHUNK_SIZE,
            hash: None,
            tenant_id: None,
            index: None,
            visibility: Some(Visibility::Restricted),
            viewers: Some(vec!["not-uuid".into()]),
        };
        assert!(matches!(
            validate_prepare(&req),
            Err(UploadError::BadRequest(_))
        ));
    }
}
