//! 异常响应信封（Nest Filter 角色）

use actix_web::{HttpResponse, Result, http::StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use crate::middlewares::trace;
use crate::utils::code::{self, auth, request, resource, system};

use configures::runtime;

/// 是否返回 Exception.details（非生产环境）。
pub fn details_enabled(is_production: bool) -> bool {
    !is_production
}

/// 异常响应结构
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[schema(as = ErrorEnvelope)]
pub struct Exception {
    /// 业务错误码 (非0表示各种业务错误)
    pub code: i32,
    pub success: bool,
    pub msg: String,
    pub timestamp: i64,
    /// 链路追踪 ID（W3C `traceparent` 的 trace-id），用于串联入口日志与下游调用
    #[serde(skip_serializing_if = "Option::is_none")]
    pub traceID: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Object, nullable = true)]
    pub data: Option<Value>,
    /// 详细错误信息（仅非生产环境返回）
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Object, nullable = true)]
    pub details: Option<Value>,
}

impl Exception {
    fn base(code: i32, msg: impl Into<String>) -> Self {
        Self {
            code,
            success: false,
            msg: msg.into(),
            data: None,
            timestamp: chrono::Utc::now().timestamp_millis(),
            traceID: trace::current_trace_id(),
            details: None,
        }
    }

    /// 创建客户端错误响应 - 请求参数错误
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self::base(request::INVALID_PARAMETER_VALUE, msg)
    }

    /// 创建未授权错误响应 - 用户未登录
    pub fn unauthorized(msg: impl Into<String>) -> Self {
        Self::base(auth::NOT_LOGGED_IN, msg)
    }

    /// 创建禁止访问错误响应 - 权限不足
    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::base(auth::INSUFFICIENT_PERMISSIONS, msg)
    }

    /// 创建未找到错误响应 - 资源不存在
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::base(resource::NOT_FOUND, msg)
    }

    /// 创建服务器内部错误响应 - 系统内部错误
    pub fn internal_error(msg: impl Into<String>) -> Self {
        Self::base(system::INTERNAL_ERROR, msg)
    }

    /// 创建自定义错误响应
    pub fn custom(code: i32, message: impl Into<String>) -> Self {
        Self::base(code, message)
    }

    /// 添加详细错误信息（生产环境忽略）
    pub fn with_details(mut self, details: Value) -> Self {
        if details_enabled_for(runtime::is_production()) {
            self.details = Some(details);
        }
        self
    }

    /// 该异常对应的 HTTP 状态码（由错误码段位映射，见 [`code::http_status`]）
    pub fn status(&self) -> StatusCode {
        StatusCode::from_u16(code::http_status(self.code))
            .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
    }

    /// 转换为 HttpResponse，HTTP 状态码与响应体 `code` 表达同一故障
    pub fn transform(self) -> Result<HttpResponse> {
        Ok(HttpResponse::build(self.status()).json(self))
    }
}

impl std::fmt::Display for Exception {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.msg)
    }
}

/// 支持在 handler 中用 `?` 传播异常：HTTP 状态码与响应体 `code` 一致
/// （与 [`Exception::transform`] 行为一致）。
impl actix_web::ResponseError for Exception {
    fn status_code(&self) -> StatusCode {
        self.status()
    }

    fn error_response(&self) -> HttpResponse {
        HttpResponse::build(self.status()).json(self)
    }
}

fn details_enabled_for(is_production: bool) -> bool {
    !is_production
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_and_forbidden_codes() {
        let err = Exception::forbidden("无权");
        assert!(!err.success);
        assert_eq!(err.code, auth::INSUFFICIENT_PERMISSIONS);
        assert!(err.details.is_none());
    }

    #[test]
    fn details_gated_by_env_name() {
        assert!(!details_enabled_for(true));
        assert!(details_enabled_for(false));
    }

    #[test]
    fn status_reflects_fault_owner() {
        assert_eq!(
            Exception::bad_request("x").status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            Exception::unauthorized("x").status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(Exception::forbidden("x").status(), StatusCode::FORBIDDEN);
        assert_eq!(Exception::not_found("x").status(), StatusCode::NOT_FOUND);
        assert_eq!(
            Exception::internal_error("x").status(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert_eq!(
            Exception::custom(code::system::SERVICE_UNAVAILABLE, "x").status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }

    #[test]
    fn trace_id_omitted_outside_request_scope() {
        let err = Exception::bad_request("x");
        assert!(err.traceID.is_none());
        let json = serde_json::to_value(&err).expect("序列化失败");
        assert!(
            json.get("traceID").is_none(),
            "无链路上下文时不应输出空 traceID"
        );
    }
}

#[macro_export]
macro_rules! fail {
    (bad_request, $message:expr) => {
        $crate::filters::exception::Exception::bad_request($message).transform()
    };
    (unauthorized, $message:expr) => {
        $crate::filters::exception::Exception::unauthorized($message).transform()
    };
    (forbidden, $message:expr) => {
        $crate::filters::exception::Exception::forbidden($message).transform()
    };
    (not_found, $message:expr) => {
        $crate::filters::exception::Exception::not_found($message).transform()
    };
    (internal, $message:expr) => {
        $crate::filters::exception::Exception::internal_error($message).transform()
    };
    ($code:expr, $message:expr) => {
        $crate::filters::exception::Exception::custom($code, $message).transform()
    };
}
