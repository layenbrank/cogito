//! 上传领域错误 → Exception

use uuid::Uuid;

use crate::filters::exception::Exception;
use crate::utils::code::{business, external, request, resource, system};

#[derive(Debug, thiserror::Error)]
pub enum UploadError {
    #[error("{0}")]
    BadRequest(String),
    #[error("资源不存在")]
    NotFound,
    #[error("上传会话不存在或已结束")]
    SessionGone,
    #[error("无权操作该上传会话")]
    Forbidden,
    /// 资产可见性写入被拒：只有创建者能改自己资产的可见性。
    #[error("无权写入该资产")]
    AssetForbidden,
    #[error("创建者 ID 无效")]
    InvalidCreator,
    #[error("资源 ID 无效")]
    InvalidId,
    #[error("数据库错误: {0}")]
    Database(String),
    #[error("存储错误: {0}")]
    Storage(String),
    #[error("文件完整性校验失败")]
    ChecksumFailed,
    #[error("内部错误: {0}")]
    Internal(String),
}

impl UploadError {
    pub fn parse_user_id(id: &str) -> Result<Uuid, Self> {
        Uuid::parse_str(id).map_err(|_| UploadError::InvalidCreator)
    }

    pub fn parse_asset_id(id: &str) -> Result<Uuid, Self> {
        Uuid::parse_str(id).map_err(|_| UploadError::InvalidId)
    }
}

impl From<std::io::Error> for UploadError {
    fn from(err: std::io::Error) -> Self {
        UploadError::Storage(err.to_string())
    }
}

impl From<UploadError> for Exception {
    fn from(err: UploadError) -> Self {
        match err {
            UploadError::BadRequest(msg) => {
                Exception::custom(request::INVALID_PARAMETER_VALUE, msg)
            }
            UploadError::NotFound => {
                Exception::custom(business::upload::FILE_NOT_FOUND, "资源不存在")
            }
            UploadError::SessionGone => {
                Exception::custom(business::upload::SESSION_GONE, "上传会话不存在或已结束")
            }
            UploadError::Forbidden => {
                Exception::custom(resource::ACCESS_RESTRICTED, "无权操作该上传会话")
            }
            UploadError::AssetForbidden => {
                Exception::custom(resource::ACCESS_RESTRICTED, "无权写入该资产")
            }
            UploadError::InvalidCreator => {
                Exception::custom(request::INVALID_PARAMETER_VALUE, "创建者 ID 无效")
            }
            UploadError::InvalidId => {
                Exception::custom(request::INVALID_PARAMETER_VALUE, "资源 ID 无效")
            }
            UploadError::Database(msg) => {
                tracing::error!(error = %msg, "upload database error");
                Exception::custom(external::DATABASE_ERROR, "数据库错误")
            }
            UploadError::Storage(msg) => {
                tracing::error!(error = %msg, "upload storage error");
                Exception::custom(business::upload::UPLOAD_FAILED, "文件上传失败")
            }
            UploadError::ChecksumFailed => {
                Exception::custom(business::upload::CHECKSUM_FAILED, "文件完整性校验失败")
            }
            UploadError::Internal(msg) => {
                tracing::error!(error = %msg, "upload internal error");
                Exception::custom(system::INTERNAL_ERROR, "内部错误")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_gone_uses_dedicated_code() {
        let body = Exception::from(UploadError::SessionGone);
        assert_eq!(body.code, business::upload::SESSION_GONE);
        assert_eq!(body.msg, "上传会话不存在或已结束");
    }

    #[test]
    fn database_error_hides_internals() {
        let body = Exception::from(UploadError::Database(
            "relation \"x\" does not exist".into(),
        ));
        assert_eq!(body.msg, "数据库错误");
        assert!(!body.msg.contains("relation"));
    }
}
