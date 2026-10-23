//! 框架层拒绝响应统一：extractor 拒绝、未匹配路由
//!
//! actix 默认用纯文本错误体回应这些情况，客户端就无法用同一套信封解析逻辑处理；
//! 这里把它们全部改写成 [`Exception`]（OpenAPI 中的 `ErrorEnvelope`）。
//!
//! 注意：错误响应在 [`Exception::transform`] 里按错误码段位映射 HTTP status，
//! 且 `traceID` 在异常对象构造时从任务链路上下文取，因此这些响应同样带链路 ID。

use actix_web::{
    Error, HttpRequest, HttpResponse, ResponseError, error::JsonPayloadError, error::PathError,
    error::QueryPayloadError, error::UrlencodedError, http::StatusCode, web,
};
use serde_json::json;

use crate::filters::exception::Exception;
use crate::utils::code::{description, request, resource, system};

/// 注册 app 级拒绝处理（每个 App 调用一次，须在路由注册前后皆可）
pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.app_data(
        web::JsonConfig::default()
            .error_handler(|err: JsonPayloadError, _req| json_error_handler(err)),
    )
    .app_data(
        web::PathConfig::default()
            .error_handler(|err: PathError, _req| rejection(err.status_code(), err)),
    )
    .app_data(
        web::QueryConfig::default()
            .error_handler(|err: QueryPayloadError, _req| rejection(err.status_code(), err)),
    )
    .app_data(
        web::FormConfig::default()
            .error_handler(|err: UrlencodedError, _req| rejection(err.status_code(), err)),
    )
    .default_service(web::route().to(not_found));
}

/// 统一拒绝对象：`msg` 用错误码标准描述（不外泄解析细节），细节进 `details`（仅非生产环境）
fn rejection(status: StatusCode, err: impl std::fmt::Display) -> Error {
    let code = rejection_code(status);

    Exception::custom(code, description(code))
        .with_details(json!({ "reason": err.to_string() }))
        .into()
}

/// 由框架拒绝自身的 HTTP 语义反查错误码，避免在非穷尽枚举上重复维护映射
fn rejection_code(status: StatusCode) -> i32 {
    match status {
        StatusCode::BAD_REQUEST => request::INVALID_PARAMETER_FORMAT,
        StatusCode::PAYLOAD_TOO_LARGE => request::REQUEST_TOO_LARGE,
        StatusCode::UNSUPPORTED_MEDIA_TYPE => request::UNSUPPORTED_MEDIA_TYPE,
        StatusCode::LENGTH_REQUIRED => request::INVALID_HEADER,
        StatusCode::NOT_FOUND => resource::NOT_FOUND,
        _ => system::INTERNAL_ERROR,
    }
}

/// JSON 体拒绝：媒体类型 / 超限按客户端语义纠正（actix 把媒体类型不匹配归为 400），其余按框架状态分派
fn json_error_handler(err: JsonPayloadError) -> Error {
    let status = match &err {
        JsonPayloadError::ContentType => StatusCode::UNSUPPORTED_MEDIA_TYPE,
        JsonPayloadError::Overflow { .. } | JsonPayloadError::OverflowKnownLength { .. } => {
            StatusCode::PAYLOAD_TOO_LARGE
        }
        _ => err.status_code(),
    };

    rejection(status, err)
}

async fn not_found(req: HttpRequest) -> HttpResponse {
    Exception::not_found(description(resource::NOT_FOUND))
        .with_details(json!({
            "method": req.method().as_str(),
            "path": req.path(),
        }))
        .transform()
        .unwrap_or_else(|_| HttpResponse::NotFound().finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::middlewares::trace::{self, Trace};
    use actix_web::{App, test as awtest, web};
    use serde::Deserialize;
    use serde_json::Value;

    #[derive(Deserialize)]
    struct Query {
        #[allow(dead_code)]
        page: u32,
    }

    /// 测试用最小 App：覆盖 Trace 中间件 + 拒绝处理 + 三类 extractor
    macro_rules! service {
        () => {
            awtest::init_service(
                App::new()
                    .wrap(Trace)
                    .configure(configure)
                    .route(
                        "/json",
                        web::post().to(|body: web::Json<Value>| async move { body.0.to_string() }),
                    )
                    .route(
                        "/query",
                        web::get().to(|q: web::Query<Query>| async move { q.page.to_string() }),
                    )
                    .route(
                        "/path/{page}",
                        web::get().to(|p: web::Path<u32>| async move { p.to_string() }),
                    ),
            )
            .await
        };
    }

    async fn body_json(resp: actix_web::dev::ServiceResponse) -> Value {
        awtest::read_body_json(resp).await
    }

    /// `App::route` 注册的路径在方法不符时由 router 直接 404，无法区分「无此路径」，
    /// 只能统一落到默认服务的 NOT_FOUND 信封；`web::resource` 的 405 由
    /// [`crate::middlewares::reject::RejectNormalizer`] 归一。
    #[actix_web::test]
    async fn route_method_mismatch_is_not_found_envelope() {
        let app = awtest::init_service(
            App::new()
                .wrap(Trace)
                .configure(configure)
                .route("/only-get", web::get().to(|| async { "ok" })),
        )
        .await;

        let resp = awtest::call_service(
            &app,
            awtest::TestRequest::post().uri("/only-get").to_request(),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        let body = body_json(resp).await;
        assert_eq!(body["code"], crate::utils::code::resource::NOT_FOUND);
        assert!(body["traceID"].is_string());
    }

    #[actix_web::test]
    async fn unknown_route_returns_not_found_envelope() {
        let app = service!();
        let resp =
            awtest::call_service(&app, awtest::TestRequest::get().uri("/nope").to_request()).await;

        assert_eq!(resp.status(), actix_web::http::StatusCode::NOT_FOUND);
        assert!(resp.headers().contains_key(trace::TRACEPARENT));
        let body = body_json(resp).await;
        assert_eq!(body["success"], false);
        assert_eq!(body["code"], crate::utils::code::resource::NOT_FOUND);
        assert!(body["traceID"].is_string(), "拒绝响应也必须带 traceID");
    }

    #[actix_web::test]
    async fn malformed_json_returns_envelope() {
        let app = service!();
        let resp = awtest::call_service(
            &app,
            awtest::TestRequest::post()
                .uri("/json")
                .insert_header(("content-type", "application/json"))
                .set_payload("{ not json")
                .to_request(),
        )
        .await;

        assert_eq!(resp.status(), actix_web::http::StatusCode::BAD_REQUEST);
        let body = body_json(resp).await;
        assert_eq!(body["success"], false);
        assert_eq!(body["code"], request::INVALID_PARAMETER_FORMAT);
        assert_eq!(body["msg"], description(request::INVALID_PARAMETER_FORMAT));
    }

    #[actix_web::test]
    async fn wrong_content_type_returns_unsupported_media_type() {
        let app = service!();
        let resp = awtest::call_service(
            &app,
            awtest::TestRequest::post()
                .uri("/json")
                .insert_header(("content-type", "text/plain"))
                .set_payload("{}")
                .to_request(),
        )
        .await;

        assert_eq!(
            resp.status(),
            actix_web::http::StatusCode::UNSUPPORTED_MEDIA_TYPE
        );
        let body = body_json(resp).await;
        assert_eq!(body["code"], request::UNSUPPORTED_MEDIA_TYPE);
    }

    #[actix_web::test]
    async fn invalid_query_returns_envelope() {
        let app = service!();
        let resp = awtest::call_service(
            &app,
            awtest::TestRequest::get()
                .uri("/query?page=abc")
                .to_request(),
        )
        .await;

        assert_eq!(resp.status(), actix_web::http::StatusCode::BAD_REQUEST);
        let body = body_json(resp).await;
        assert_eq!(body["code"], request::INVALID_PARAMETER_FORMAT);
    }

    #[actix_web::test]
    async fn invalid_path_returns_envelope() {
        let app = service!();
        let resp = awtest::call_service(
            &app,
            awtest::TestRequest::get().uri("/path/abc").to_request(),
        )
        .await;

        assert_eq!(resp.status(), actix_web::http::StatusCode::BAD_REQUEST);
        let body = body_json(resp).await;
        assert_eq!(body["code"], request::INVALID_PARAMETER_FORMAT);
    }

    #[actix_web::test]
    async fn oversized_json_returns_request_too_large() {
        let app = service!();
        let big = format!("{{\"k\":\"{}\"}}", "x".repeat(3 * 1024 * 1024));
        let resp = awtest::call_service(
            &app,
            awtest::TestRequest::post()
                .uri("/json")
                .insert_header(("content-type", "application/json"))
                .set_payload(big)
                .to_request(),
        )
        .await;

        assert_eq!(
            resp.status(),
            actix_web::http::StatusCode::PAYLOAD_TOO_LARGE
        );
        let body = body_json(resp).await;
        assert_eq!(body["code"], request::REQUEST_TOO_LARGE);
    }
}
