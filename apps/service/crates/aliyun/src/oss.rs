//! OSS 对象存储（`opendal` 的 OSS 服务）。
//!
//! 这里只暴露对象级原语（put/get/delete/预签名），不掺业务语义：目录约定、可见性
//! 与生命周期由调用方（service 层的存储策略）决定。
//!
//! `addressing_style` 默认 `virtual`（`https://<bucket>.oss-cn-hangzhou.aliyuncs.com`）；
//! 本地 MinIO/自建网关这类拿不到通配子域的环境必须显式配 `path`。

use std::time::Duration;

use opendal::services::Oss;
use opendal::{ErrorKind, Operator};

use crate::rpc::Credentials;

/// 公开读的预签名 URL 之外，OSS 还需要「可写」预签名（前端直传）。
pub const DEFAULT_PRESIGN_EXPIRES: Duration = Duration::from_secs(900);

const ADDRESSING_STYLES: [&str; 3] = ["virtual", "cname", "path"];

/// 连接一个 bucket 所需的全部信息（不含凭据：凭据来自共享的 [`Credentials`]）。
#[derive(Debug, Clone)]
pub struct OssSettings {
    pub endpoint: String,
    pub bucket: String,
    /// 对象前缀（bucket 内的逻辑根）；空串表示直接用 bucket 根。
    pub root: String,
    pub addressing_style: String,
    /// 生成预签名 URL 时改用另一个 endpoint（如内网写、公网读）。
    pub presign_endpoint: Option<String>,
}

impl OssSettings {
    pub fn new(endpoint: impl Into<String>, bucket: impl Into<String>) -> Self {
        Self {
            endpoint: endpoint.into(),
            bucket: bucket.into(),
            root: String::new(),
            addressing_style: "virtual".to_owned(),
            presign_endpoint: None,
        }
    }

    #[must_use]
    pub fn with_root(mut self, root: impl Into<String>) -> Self {
        self.root = root.into();
        self
    }

    #[must_use]
    pub fn with_addressing_style(mut self, style: impl Into<String>) -> Self {
        self.addressing_style = style.into();
        self
    }

    #[must_use]
    pub fn with_presign_endpoint(mut self, endpoint: impl Into<String>) -> Self {
        self.presign_endpoint = Some(endpoint.into());
        self
    }

    /// 只做形状校验：真正连不通由第一次请求暴露（服务启动不该被对象存储拖住）。
    fn validate(&self) -> Result<(), OssError> {
        if self.endpoint.trim().is_empty() {
            return Err(OssError::Invalid("endpoint is required".to_owned()));
        }
        if self.bucket.trim().is_empty() {
            return Err(OssError::Invalid("bucket is required".to_owned()));
        }
        if !ADDRESSING_STYLES.contains(&self.addressing_style.as_str()) {
            return Err(OssError::Invalid(format!(
                "addressing_style 只支持 {}",
                ADDRESSING_STYLES.join("/")
            )));
        }
        Ok(())
    }
}

#[derive(Debug)]
pub struct OssClient {
    operator: Operator,
    settings: OssSettings,
}

impl OssClient {
    pub fn new(settings: OssSettings, credentials: Credentials) -> Result<Self, OssError> {
        settings.validate()?;
        if !credentials.is_configured() {
            return Err(OssError::Invalid(
                "OSS 缺少 access_key_id/secret".to_owned(),
            ));
        }

        let mut builder = Oss::default()
            .endpoint(&settings.endpoint)
            .bucket(&settings.bucket)
            .root(&settings.root)
            .addressing_style(&settings.addressing_style)
            .access_key_id(credentials.access_key_id())
            .access_key_secret(credentials.access_key_secret());
        if let Some(token) = credentials.security_token() {
            builder = builder.security_token(token);
        }
        if let Some(endpoint) = settings.presign_endpoint.as_deref() {
            builder = builder.presign_endpoint(endpoint);
        }

        let operator = Operator::new(builder).map_err(|error| {
            OssError::Invalid(format!("OSS 后端无法构建（检查 endpoint/bucket）：{error}"))
        })?;

        Ok(Self { operator, settings })
    }

    pub fn settings(&self) -> &OssSettings {
        &self.settings
    }

    pub async fn put(
        &self,
        key: &str,
        data: Vec<u8>,
        content_type: Option<&str>,
    ) -> Result<(), OssError> {
        let key = normalize_key(key)?;
        let mut write = self.operator.write_with(key, data);
        if let Some(content_type) = content_type {
            write = write.content_type(content_type);
        }
        write.await.map_err(map_opendal)?;
        Ok(())
    }

    pub async fn get(&self, key: &str) -> Result<Vec<u8>, OssError> {
        let key = normalize_key(key)?;
        self.operator
            .read(key)
            .await
            .map(|buffer| buffer.to_vec())
            .map_err(map_opendal)
    }

    /// 对象不存在时不报错（OSS 的 delete 是幂等的）。
    pub async fn delete(&self, key: &str) -> Result<(), OssError> {
        let key = normalize_key(key)?;
        self.operator.delete(key).await.map_err(map_opendal)
    }

    pub async fn presign_read(&self, key: &str, expire: Duration) -> Result<String, OssError> {
        let key = normalize_key(key)?;
        self.operator
            .presign_read(key, expire)
            .await
            .map(|request| request.uri().to_string())
            .map_err(map_opendal)
    }

    pub async fn presign_write(&self, key: &str, expire: Duration) -> Result<String, OssError> {
        let key = normalize_key(key)?;
        self.operator
            .presign_write(key, expire)
            .await
            .map(|request| request.uri().to_string())
            .map_err(map_opendal)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum OssError {
    #[error("OSS 配置或参数无效：{0}")]
    Invalid(String),
    #[error("OSS 对象不存在：{0}")]
    NotFound(String),
    #[error(transparent)]
    Backend(#[from] opendal::Error),
}

/// 对象 key 一律按「bucket 内相对路径」处理，去掉开头多余的 `/`，拒绝空 key。
fn normalize_key(key: &str) -> Result<&str, OssError> {
    let key = key.trim().trim_start_matches('/');
    if key.is_empty() {
        return Err(OssError::Invalid("对象 key 不能为空".to_owned()));
    }
    Ok(key)
}

/// `NotFound` 单独成一类：调用方据此返回 404 而不是 5xx。
fn map_opendal(error: opendal::Error) -> OssError {
    if error.kind() == ErrorKind::NotFound {
        return OssError::NotFound(error.to_string());
    }

    OssError::Backend(error)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn credentials() -> Credentials {
        Credentials::new("ak", "sk")
    }

    #[test]
    fn normalizes_object_keys() {
        assert_eq!(normalize_key("/a/b.png").expect("ok"), "a/b.png");
        assert_eq!(normalize_key("  a/b.png ").expect("ok"), "a/b.png");
        assert!(normalize_key("/").is_err());
        assert!(normalize_key("").is_err());
    }

    #[test]
    fn defaults_use_virtual_addressing() {
        let settings = OssSettings::new("https://oss-cn-hangzhou.aliyuncs.com", "bucket");
        assert_eq!(settings.addressing_style, "virtual");
        assert!(settings.root.is_empty());
        assert!(settings.presign_endpoint.is_none());
        assert!(OssClient::new(settings, credentials()).is_ok());
    }

    #[test]
    fn rejects_empty_bucket() {
        let settings = OssSettings::new("https://oss-cn-hangzhou.aliyuncs.com", " ");
        assert!(matches!(
            OssClient::new(settings, credentials()),
            Err(OssError::Invalid(_))
        ));
    }

    #[test]
    fn rejects_unknown_addressing_style() {
        let settings = OssSettings::new("https://oss-cn-hangzhou.aliyuncs.com", "bucket")
            .with_addressing_style("dns");
        assert!(matches!(
            OssClient::new(settings, credentials()),
            Err(OssError::Invalid(_))
        ));
    }

    #[test]
    fn rejects_missing_credentials() {
        let settings = OssSettings::new("https://oss-cn-hangzhou.aliyuncs.com", "bucket");
        assert!(matches!(
            OssClient::new(settings, Credentials::default()),
            Err(OssError::Invalid(_))
        ));
    }
}
