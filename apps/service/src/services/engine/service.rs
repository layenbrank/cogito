use actix_web::HttpRequest;
use reqwest::{Client, Error as ReqwestError, header};
use serde_json::Error as JsonError;

use crate::filters::exception::Exception;
use crate::services::engine::schema::{QueryP, SuggestionR};

// 请求头常量
const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const ACCEPT_HEADER: &str = "application/json, text/plain, */*";
const API_BASE_URL: &str = "https://cn.bing.com/AS/Suggestions";

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("HTTP request error: {0}")]
    HttpError(#[from] ReqwestError),
    #[error("JSON parse error: {0}")]
    JsonParseError(#[from] JsonError),
    #[error("HTTP error {status}: {message}")]
    HttpStatusError { status: u16, message: String },
    #[error("Invalid response format: {0}")]
    InvalidResponseFormat(String),
}

impl From<EngineError> for Exception {
    fn from(err: EngineError) -> Self {
        use crate::utils::code::external;
        match &err {
            EngineError::HttpError(e) => {
                tracing::error!(error = %e, "engine upstream request failed");
            }
            EngineError::JsonParseError(e) => {
                tracing::error!(error = %e, "engine json parse failed");
            }
            EngineError::HttpStatusError { status, message } => {
                tracing::error!(%status, error = %message, "engine upstream status error");
            }
            EngineError::InvalidResponseFormat(msg) => {
                tracing::error!(error = %msg, "engine invalid response");
            }
        }
        Exception::custom(external::THIRD_PARTY_API_ERROR, "搜索建议服务暂不可用")
    }
}

pub struct EngineService;

impl EngineService {
    /// 获取搜索建议
    ///
    /// # 参数
    /// - `params`: URL 查询参数
    /// - `req`: HTTP 请求对象，用于提取 User-Agent 等请求头信息
    pub async fn suggestion(params: QueryP, req: &HttpRequest) -> Result<SuggestionR, EngineError> {
        let client = Client::new();

        // 构建请求头
        let mut headers = header::HeaderMap::new();

        // 从请求中提取 User-Agent，如果无效或不存在则使用默认值
        let user_agent = req
            .headers()
            .get("user-agent")
            .and_then(|h| h.to_str().ok())
            .filter(|ua| !ua.is_empty())
            .unwrap_or(DEFAULT_USER_AGENT);

        // 创建 User-Agent 请求头，如果失败则使用默认值
        let user_agent_header = header::HeaderValue::from_str(user_agent).unwrap_or_else(|_| {
            // 如果 User-Agent 无效，使用默认值
            header::HeaderValue::from_static(DEFAULT_USER_AGENT)
        });

        headers.insert(header::USER_AGENT, user_agent_header);

        headers.insert(
            header::ACCEPT,
            header::HeaderValue::from_static(ACCEPT_HEADER),
        );

        let response = client
            .get(API_BASE_URL)
            .headers(headers)
            .query(&params)
            .send()
            .await?;

        // 检查响应状态码
        let status = response.status();
        tracing::debug!(status = %status, "Response status");

        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(EngineError::HttpStatusError {
                status: status.as_u16(),
                message: error_text,
            });
        }

        // 先获取响应文本用于调试
        let text = response.text().await?;

        tracing::debug!(
            body = %if text.len() > 500 { &text[..500] } else { &text },
            "Response body (first 500 chars)"
        );

        // 尝试解析 JSON
        let suggestion: SuggestionR = serde_json::from_str(&text).map_err(|e| {
            EngineError::InvalidResponseFormat(format!(
                "JSON解析失败: {}\n响应内容: {}",
                e,
                if text.len() > 1000 {
                    format!("{}...", &text[..1000])
                } else {
                    text
                }
            ))
        })?;

        Ok(suggestion)
    }
}
