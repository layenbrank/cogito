//! 框架自产响应的信封归一
//!
//! actix 在「路径匹配但方法不符」时由资源自身返回**带 `Allow` 头的空体 405**，
//! 它既不走 extractor 错误处理，也不走 app 级 `default_service`，因此无法在
//! [`crate::bootstrap::errors`] 里覆盖；本中间件把它重写成统一异常信封。
//!
//! 须注册为最内层 wrap（`bootstrap_app!` 中第一个 `wrap`），这样外层的 [`Trace`]
//! 仍能注入 `traceparent`，且信封内 `traceID` 也在链路作用域内取到。
//!
//! [`Trace`]: crate::middlewares::trace::Trace

use std::rc::Rc;

use actix_web::{
    Error, HttpResponse,
    body::{BoxBody, EitherBody, MessageBody},
    dev::{Service, ServiceRequest, ServiceResponse, Transform, forward_ready},
    http::{StatusCode, header},
};
use futures::future::{LocalBoxFuture, Ready, ok};

use crate::filters::exception::Exception;
use crate::utils::code::{description, request};

pub struct RejectNormalizer;

impl<S, B> Transform<S, ServiceRequest> for RejectNormalizer
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<EitherBody<B, BoxBody>>;
    type Error = Error;
    type Transform = RejectNormalizerMiddleware<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(RejectNormalizerMiddleware {
            service: Rc::new(service),
        })
    }
}

pub struct RejectNormalizerMiddleware<S> {
    service: Rc<S>,
}

impl<S, B> Service<ServiceRequest> for RejectNormalizerMiddleware<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<EitherBody<B, BoxBody>>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let service = Rc::clone(&self.service);

        Box::pin(async move {
            let res = service.call(req).await?;

            // 已有信封的响应（JSON）与其余状态码原样透传
            if res.status() != StatusCode::METHOD_NOT_ALLOWED || is_envelope(res.response()) {
                return Ok(res.map_into_left_body());
            }

            let allow = res.response().headers().get(header::ALLOW).cloned();
            let (req, _) = res.into_parts();

            let exception = Exception::custom(
                request::METHOD_NOT_ALLOWED,
                description(request::METHOD_NOT_ALLOWED),
            );
            let mut response = HttpResponse::build(exception.status()).json(exception);
            if let Some(allow) = allow {
                response.headers_mut().insert(header::ALLOW, allow);
            }

            let res = ServiceResponse::new(req, response).map_into_right_body();

            Ok(res)
        })
    }
}

/// 是否已是本框架的信封响应（信封一律 `content-type: application/json`）
fn is_envelope<B: MessageBody>(res: &HttpResponse<B>) -> bool {
    res.headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.contains("json"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::middlewares::trace::Trace;
    use actix_web::{App, test as awtest, web};
    use serde_json::Value;

    macro_rules! service {
        () => {
            awtest::init_service(
                App::new()
                    .wrap(RejectNormalizer)
                    .wrap(Trace)
                    .route(
                        "/ok",
                        web::get().to(|| async { HttpResponse::Ok().json(serde_json::json!({"a": 1})) }),
                    )
                    .service(
                        web::scope("/api").service(
                            web::resource("/x").route(web::get().to(|| async { "ok" })),
                        ),
                    ),
            )
            .await
        };
    }

    #[actix_web::test]
    async fn method_mismatch_becomes_envelope() {
        let app = service!();
        let resp =
            awtest::call_service(&app, awtest::TestRequest::post().uri("/api/x").to_request())
                .await;

        assert_eq!(resp.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(resp.headers().get(header::ALLOW).unwrap(), "GET");
        assert!(
            resp.headers()
                .contains_key(crate::middlewares::trace::TRACEPARENT)
        );

        let body = awtest::read_body_json::<Value, _>(resp).await;
        assert_eq!(body["success"], false);
        assert_eq!(body["code"], request::METHOD_NOT_ALLOWED);
        assert!(body["traceID"].is_string());
    }

    #[actix_web::test]
    async fn matched_route_is_untouched() {
        let app = service!();
        let resp =
            awtest::call_service(&app, awtest::TestRequest::get().uri("/ok").to_request()).await;

        assert_eq!(resp.status(), StatusCode::OK);
        let body = awtest::read_body_json::<Value, _>(resp).await;
        assert_eq!(body["a"], 1);
    }
}
