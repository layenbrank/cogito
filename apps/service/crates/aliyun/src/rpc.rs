//! RPC 风格调用的公共部分：凭据、签名版本、请求装配、响应解析与错误。
//!
//! 阿里云的 RPC 风格 OpenAPI（Dysmsapi、DirectMail…）都是同一形状：公共参数 + 业务参数
//! → 签名 → `POST` → JSON 响应。产品语义（字段名、成功码）在 [`crate::sms`] 与
//! [`crate::mail`]，这里只管形状。

use std::time::Duration;

use chrono::Utc;
use serde_json::Value;

use crate::signature;

/// 官方两种签名都用 UTC 的 `yyyy-MM-ddTHH:mm:ssZ`。
const TIMESTAMP_FORMAT: &str = "%Y-%m-%dT%H:%M:%SZ";
const FORM_CONTENT_TYPE: &str = "application/x-www-form-urlencoded";

/// 出站凭据。`security_token` 供 STS 临时凭据使用（企业场景不留长期 AK/SK 在进程里）。
#[derive(Debug, Clone, Default)]
pub struct Credentials {
    access_key_id: String,
    access_key_secret: String,
    security_token: Option<String>,
}

impl Credentials {
    pub fn new(access_key_id: impl Into<String>, access_key_secret: impl Into<String>) -> Self {
        Self {
            access_key_id: access_key_id.into(),
            access_key_secret: access_key_secret.into(),
            security_token: None,
        }
    }

    pub fn with_security_token(mut self, security_token: impl Into<String>) -> Self {
        let token = security_token.into();
        self.security_token = non_empty(&token);
        self
    }

    pub fn access_key_id(&self) -> &str {
        &self.access_key_id
    }

    /// 密钥不对外开放（只在 crate 内用于签名）。
    pub(crate) fn access_key_secret(&self) -> &str {
        &self.access_key_secret
    }

    pub(crate) fn security_token(&self) -> Option<&str> {
        self.security_token.as_deref()
    }

    /// 两项都非空才算配好（只填一项是配置事故，不该静默当成「未配置」）。
    pub fn is_configured(&self) -> bool {
        !self.access_key_id.trim().is_empty() && !self.access_key_secret.trim().is_empty()
    }
}

/// 签名版本。默认 V3：官方现行推荐，且 V1 只保证老网关兼容性。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SignatureVersion {
    /// `SignatureVersion=1.0`：HMAC-SHA1 + Base64。
    V1,
    /// `ACS3-HMAC-SHA256`。
    #[default]
    V3,
}

impl SignatureVersion {
    /// 解析配置值（大小写不敏感）。
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "v1" | "1" | "1.0" => Some(Self::V1),
            "v3" | "3" | "3.0" => Some(Self::V3),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::V1 => "v1",
            Self::V3 => "v3",
        }
    }
}

/// 业务参数放在哪：照抄 OpenAPI 元数据的 `in` 字段，不是自由选择。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ParamPlacement {
    /// `in: query`（Dysmsapi `SendSms`）。
    #[default]
    Query,
    /// `in: formData`：`POST` body + `application/x-www-form-urlencoded`（DirectMail `SingleSendMail`）。
    Form,
}

impl ParamPlacement {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "query" => Some(Self::Query),
            "formdata" | "form" => Some(Self::Form),
            _ => None,
        }
    }
}

/// 一次 RPC 调用。公共参数（`Action`/`Version`/时间戳/签名…）由 [`RpcClient`] 按签名版本补齐。
#[derive(Debug, Clone)]
pub struct RpcRequest {
    /// 完整 origin，例如 `https://dysmsapi.aliyuncs.com`（允许 `http://` 以便本地桩）。
    pub endpoint: String,
    pub action: String,
    pub version: String,
    pub placement: ParamPlacement,
    pub params: Vec<(String, String)>,
}

impl RpcRequest {
    pub fn new(
        endpoint: impl Into<String>,
        action: impl Into<String>,
        version: impl Into<String>,
        placement: ParamPlacement,
    ) -> Self {
        Self {
            endpoint: endpoint.into(),
            action: action.into(),
            version: version.into(),
            placement,
            params: Vec::new(),
        }
    }

    #[must_use]
    pub fn param(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.params.push((key.into(), value.into()));
        self
    }
}

#[derive(Debug, thiserror::Error)]
pub enum RpcError {
    #[error("阿里云请求超时")]
    Timeout,
    #[error("阿里云请求失败：{0}")]
    Transport(String),
    /// 非 2xx 且带错误信封（`Code` / `Message` / `RequestId`）。
    #[error("阿里云返回 {status} {code}：{message}")]
    Service {
        status: u16,
        code: String,
        message: String,
        request_id: Option<String>,
    },
    #[error("阿里云响应无法解析：{0}")]
    Decode(String),
}

impl RpcError {
    /// 服务端错误码（传输/超时/解码错误没有码）。
    pub fn service_code(&self) -> Option<&str> {
        match self {
            Self::Service { code, .. } => Some(code.as_str()),
            _ => None,
        }
    }
}

/// 签名 + 发请求。构造一次可复用（内部持有连接池）。
#[derive(Debug)]
pub struct RpcClient {
    http: reqwest::Client,
    credentials: Credentials,
    version: SignatureVersion,
}

impl RpcClient {
    /// 缺凭据直接报错：省掉「请求发出去才 400」的调试成本。
    pub fn new(
        credentials: Credentials,
        version: SignatureVersion,
        timeout: Duration,
    ) -> Result<Self, RpcError> {
        if !credentials.is_configured() {
            return Err(RpcError::Transport(
                "缺少 aliyun.access_key_id / access_key_secret".to_owned(),
            ));
        }
        let http = reqwest::Client::builder()
            .timeout(timeout)
            .build()
            .map_err(|error| RpcError::Transport(format!("构建 HTTP 客户端失败：{error}")))?;

        Ok(Self {
            http,
            credentials,
            version,
        })
    }

    pub fn signature_version(&self) -> SignatureVersion {
        self.version
    }

    pub async fn call(&self, request: &RpcRequest) -> Result<Value, RpcError> {
        let (origin, host) = split_endpoint(&request.endpoint)?;

        match self.version {
            SignatureVersion::V3 => self.call_v3(&origin, &host, request).await,
            SignatureVersion::V1 => self.call_v1(&origin, request).await,
        }
    }

    async fn call_v3(
        &self,
        origin: &str,
        host: &str,
        request: &RpcRequest,
    ) -> Result<Value, RpcError> {
        let body = match request.placement {
            ParamPlacement::Query => Vec::new(),
            ParamPlacement::Form => signature::form_encode(&request.params).into_bytes(),
        };
        let query = match request.placement {
            ParamPlacement::Query => signature::canonical_query(&request.params),
            ParamPlacement::Form => String::new(),
        };
        let hashed_payload = signature::sha256_hex(&body);

        let mut headers = vec![
            ("host".to_owned(), host.to_owned()),
            ("x-acs-action".to_owned(), request.action.clone()),
            ("x-acs-version".to_owned(), request.version.clone()),
            (
                "x-acs-date".to_owned(),
                Utc::now().format(TIMESTAMP_FORMAT).to_string(),
            ),
            (
                "x-acs-signature-nonce".to_owned(),
                uuid::Uuid::new_v4().simple().to_string(),
            ),
            ("x-acs-content-sha256".to_owned(), hashed_payload.clone()),
        ];
        if let Some(token) = self.credentials.security_token() {
            headers.push(("x-acs-security-token".to_owned(), token.to_owned()));
        }
        if request.placement == ParamPlacement::Form {
            headers.push(("content-type".to_owned(), FORM_CONTENT_TYPE.to_owned()));
        }

        let (canonical_headers, signed_headers) = signature::v3_canonical_headers(&headers);
        let canonical_request = signature::v3_canonical_request(
            "POST",
            "/",
            &query,
            &canonical_headers,
            &signed_headers,
            &hashed_payload,
        );
        let signature = signature::v3_signature(
            self.credentials.access_key_secret(),
            &signature::v3_string_to_sign(&canonical_request),
        );
        let authorization = signature::v3_authorization(
            self.credentials.access_key_id(),
            &signed_headers,
            &signature,
        );

        let url = if query.is_empty() {
            format!("{origin}/")
        } else {
            format!("{origin}/?{query}")
        };
        let mut outbound = self.http.post(url).header("authorization", authorization);
        // `host` 只参与签名：值由 hyper 按 URL 补，手工再设一遍可能重复。
        for (name, value) in headers.iter().filter(|(name, _)| name != "host") {
            outbound = outbound.header(name, value);
        }

        self.send(outbound, body).await
    }

    async fn call_v1(&self, origin: &str, request: &RpcRequest) -> Result<Value, RpcError> {
        let mut common = vec![
            ("Action".to_owned(), request.action.clone()),
            ("Version".to_owned(), request.version.clone()),
            ("Format".to_owned(), "JSON".to_owned()),
            ("SignatureMethod".to_owned(), "HMAC-SHA1".to_owned()),
            ("SignatureVersion".to_owned(), "1.0".to_owned()),
            (
                "SignatureNonce".to_owned(),
                uuid::Uuid::new_v4().simple().to_string(),
            ),
            (
                "Timestamp".to_owned(),
                Utc::now().format(TIMESTAMP_FORMAT).to_string(),
            ),
            (
                "AccessKeyId".to_owned(),
                self.credentials.access_key_id().to_owned(),
            ),
        ];
        if let Some(token) = self.credentials.security_token() {
            common.push(("SecurityToken".to_owned(), token.to_owned()));
        }

        // 签名覆盖公共参数 + 业务参数（与落位无关），且不含 Signature 本身。
        let mut signed_params = common.clone();
        signed_params.extend(request.params.iter().cloned());
        let signature =
            signature::v1_signature(self.credentials.access_key_secret(), "POST", &signed_params);

        let mut query_params = common;
        let body = match request.placement {
            ParamPlacement::Query => {
                query_params.extend(request.params.iter().cloned());
                Vec::new()
            }
            ParamPlacement::Form => signature::form_encode(&request.params).into_bytes(),
        };
        query_params.push(("Signature".to_owned(), signature));

        let url = format!("{origin}/?{}", signature::canonical_query(&query_params));
        let mut outbound = self.http.post(url);
        if request.placement == ParamPlacement::Form {
            outbound = outbound.header("content-type", FORM_CONTENT_TYPE);
        }

        self.send(outbound, body).await
    }

    async fn send(
        &self,
        outbound: reqwest::RequestBuilder,
        body: Vec<u8>,
    ) -> Result<Value, RpcError> {
        let response = outbound
            .body(body)
            .send()
            .await
            .map_err(|error| transport_error(&error))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|error| RpcError::Transport(format!("读取响应失败：{error}")))?;

        if !status.is_success() {
            return Err(service_error(status.as_u16(), &text));
        }

        serde_json::from_str(&text).map_err(|error| {
            RpcError::Decode(format!("{error}；原始响应：{}", truncate(&text, 300)))
        })
    }
}

/// 拆出 origin（含 scheme 与端口）与用于签名的 `host`。
///
/// 不为此引入 url 依赖：RPC 风格 API 的 endpoint 必须是裸 origin（带路径会让签名与实际
/// 请求的 URI 不一致，所以直接拒绝）。
fn split_endpoint(endpoint: &str) -> Result<(String, String), RpcError> {
    let trimmed = endpoint.trim().trim_end_matches('/');
    let (scheme, rest) = trimmed.split_once("://").ok_or_else(|| {
        RpcError::Transport(format!("endpoint 必须以 http(s):// 开头：{endpoint}"))
    })?;
    if scheme != "http" && scheme != "https" {
        return Err(RpcError::Transport(format!(
            "endpoint 只支持 http(s)：{endpoint}"
        )));
    }

    let (host, path) = match rest.split_once('/') {
        Some((host, path)) => (host, path),
        None => (rest, ""),
    };
    if host.is_empty() {
        return Err(RpcError::Transport(format!(
            "endpoint 缺少主机名：{endpoint}"
        )));
    }
    if !path.is_empty() {
        return Err(RpcError::Transport(format!(
            "endpoint 不应带路径（{path}）：请只填 origin"
        )));
    }

    Ok((format!("{scheme}://{host}"), host.to_owned()))
}

fn transport_error(error: &reqwest::Error) -> RpcError {
    if error.is_timeout() {
        RpcError::Timeout
    } else {
        RpcError::Transport(error.to_string())
    }
}

/// 非 2xx 的错误信封：`{"Code":…,"Message":…,"RequestId":…}`；解不出就原样带回来。
fn service_error(status: u16, body: &str) -> RpcError {
    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let field = |name: &str| {
        parsed
            .as_ref()
            .and_then(|value| value.get(name))
            .and_then(Value::as_str)
            .and_then(non_empty)
    };

    RpcError::Service {
        status,
        code: field("Code").unwrap_or_default(),
        message: field("Message").unwrap_or_else(|| truncate(body, 300)),
        request_id: field("RequestId"),
    }
}

/// 空串统一当「没有」：阿里云常返回 `""` 而不是省略字段。
pub(crate) fn non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

fn truncate(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_owned();
    }

    let head: String = value.chars().take(max).collect();
    format!("{head}…")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_origin_and_host() {
        assert_eq!(
            split_endpoint("https://dysmsapi.aliyuncs.com").expect("ok"),
            (
                "https://dysmsapi.aliyuncs.com".to_owned(),
                "dysmsapi.aliyuncs.com".to_owned()
            )
        );
        assert_eq!(
            split_endpoint("  http://127.0.0.1:8090/  ").expect("ok"),
            (
                "http://127.0.0.1:8090".to_owned(),
                "127.0.0.1:8090".to_owned()
            )
        );
        assert!(split_endpoint("dysmsapi.aliyuncs.com").is_err());
        assert!(split_endpoint("https://dysmsapi.aliyuncs.com/api").is_err());
        assert!(split_endpoint("ftp://dysmsapi.aliyuncs.com").is_err());
    }

    #[test]
    fn parses_signature_version_and_placement() {
        assert_eq!(SignatureVersion::parse("V3"), Some(SignatureVersion::V3));
        assert_eq!(SignatureVersion::parse(" 1.0 "), Some(SignatureVersion::V1));
        assert_eq!(SignatureVersion::parse("v9"), None);
        assert_eq!(
            ParamPlacement::parse("formData"),
            Some(ParamPlacement::Form)
        );
        assert_eq!(ParamPlacement::parse("query"), Some(ParamPlacement::Query));
        assert_eq!(ParamPlacement::parse("header"), None);
    }

    #[test]
    fn parses_error_envelope() {
        let error = service_error(
            403,
            r#"{"Code":"isv.BUSINESS_LIMIT_CONTROL","Message":"触发流控","RequestId":"abc"}"#,
        );
        match error {
            RpcError::Service {
                status,
                code,
                message,
                request_id,
            } => {
                assert_eq!(status, 403);
                assert_eq!(code, "isv.BUSINESS_LIMIT_CONTROL");
                assert_eq!(message, "触发流控");
                assert_eq!(request_id.as_deref(), Some("abc"));
            }
            other => panic!("unexpected error: {other:?}"),
        }

        match service_error(502, "<html>bad gateway</html>") {
            RpcError::Service {
                code,
                message,
                request_id,
                ..
            } => {
                assert!(code.is_empty());
                assert_eq!(message, "<html>bad gateway</html>");
                assert!(request_id.is_none());
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn credentials_require_both_fields() {
        assert!(!Credentials::default().is_configured());
        assert!(!Credentials::new("id", "  ").is_configured());
        assert!(Credentials::new("id", "secret").is_configured());
        assert_eq!(
            Credentials::new("id", "secret")
                .with_security_token("")
                .security_token(),
            None
        );
    }

    #[test]
    fn rejects_empty_credentials_at_construction() {
        let error = RpcClient::new(
            Credentials::default(),
            SignatureVersion::V3,
            Duration::from_secs(1),
        )
        .expect_err("缺凭据应报错");
        assert!(error.to_string().contains("access_key_id"));
    }
}
