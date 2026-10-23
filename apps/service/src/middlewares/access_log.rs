//! HTTP 访问日志：结构化 tracing（状态 / 参数 / 响应 / IP）。
#![allow(non_snake_case)]

mod body;

use std::rc::Rc;
use std::task::{Context, Poll};

use actix_web::{
    Error, HttpMessage,
    body::{BoxBody, MessageBody, to_bytes},
    dev::{ServiceRequest, ServiceResponse, Transform},
    http::header,
    web::Bytes,
};
use futures::future::{LocalBoxFuture, Ready, ok};
use uuid::Uuid;

use self::body::{
    body_max, buffer_json_body, header_str, preview_body, redact_query, skip_response_peek,
};
use super::trace;

/// 访问日志中间件
pub struct AccessLog;

impl<S, B> Transform<S, ServiceRequest> for AccessLog
where
    S: actix_web::dev::Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>
        + 'static,
    S::Future: 'static,
    B: MessageBody + 'static,
    B::Error: Into<Error>,
{
    type Response = ServiceResponse<BoxBody>;
    type Error = Error;
    type Transform = AccessLogMiddleware<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(AccessLogMiddleware {
            service: Rc::new(service),
            body_max: body_max(),
        })
    }
}

pub struct AccessLogMiddleware<S> {
    service: Rc<S>,
    body_max: usize,
}

impl<S, B> actix_web::dev::Service<ServiceRequest> for AccessLogMiddleware<S>
where
    S: actix_web::dev::Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>
        + 'static,
    S::Future: 'static,
    B: MessageBody + 'static,
    B::Error: Into<Error>,
{
    type Response = ServiceResponse<BoxBody>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    fn poll_ready(&self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.service.poll_ready(cx)
    }

    fn call(&self, mut req: ServiceRequest) -> Self::Future {
        let service = Rc::clone(&self.service);
        let body_max = self.body_max;

        let req_id = Uuid::new_v4().to_string();
        let method = req.method().as_str().to_string();
        let path = req.path().to_string();
        let query = redact_query(req.query_string());
        let start_time = std::time::Instant::now();
        let client_ip = client_ip(&req);
        let user_agent = header_str(&req, header::USER_AGENT).unwrap_or_else(|| "-".into());
        let content_type = header_str(&req, header::CONTENT_TYPE).unwrap_or_else(|| "-".into());
        let content_length = header_str(&req, header::CONTENT_LENGTH);

        req.extensions_mut().insert(req_id.clone());

        Box::pin(async move {
            let req_body = buffer_json_body(&mut req, &content_type, body_max).await;

            let response = service.call(req).await;
            let duration_ms = start_time.elapsed().as_millis();

            match response {
                Ok(res) => {
                    let status = res.status().as_u16();
                    let (http_req, http_res) = res.into_parts();

                    let skip = skip_response_peek(&path, http_res.headers(), body_max);
                    if skip {
                        log_access(
                            &req_id,
                            &method,
                            &path,
                            &query,
                            &client_ip,
                            &user_agent,
                            &content_type,
                            content_length.as_deref(),
                            req_body.as_deref(),
                            Some(status),
                            Some("(skipped)"),
                            duration_ms,
                            None,
                        );
                        return Ok(ServiceResponse::new(
                            http_req,
                            http_res.map_into_boxed_body(),
                        ));
                    }

                    let status_code = http_res.status();
                    let mut builder = actix_web::HttpResponse::build(status_code);
                    for (k, v) in http_res.headers() {
                        builder.insert_header((k.clone(), v.clone()));
                    }

                    let body_bytes = to_bytes(http_res.into_body())
                        .await
                        .unwrap_or_else(|_| Bytes::new());
                    let res_body = preview_body(&body_bytes, body_max);

                    log_access(
                        &req_id,
                        &method,
                        &path,
                        &query,
                        &client_ip,
                        &user_agent,
                        &content_type,
                        content_length.as_deref(),
                        req_body.as_deref(),
                        Some(status),
                        res_body.as_deref(),
                        duration_ms,
                        None,
                    );

                    Ok(ServiceResponse::new(http_req, builder.body(body_bytes)))
                }
                Err(err) => {
                    let err_text = err.to_string();
                    log_access(
                        &req_id,
                        &method,
                        &path,
                        &query,
                        &client_ip,
                        &user_agent,
                        &content_type,
                        content_length.as_deref(),
                        req_body.as_deref(),
                        None,
                        None,
                        duration_ms,
                        Some(&err_text),
                    );
                    Err(err)
                }
            }
        })
    }
}

fn client_ip(req: &ServiceRequest) -> String {
    let info = req.connection_info();
    info.realip_remote_addr()
        .or_else(|| info.peer_addr())
        .unwrap_or("unknown")
        .to_string()
}

fn log_access(
    req_id: &str,
    method: &str,
    path: &str,
    query: &str,
    client_ip: &str,
    user_agent: &str,
    content_type: &str,
    content_length: Option<&str>,
    req_body: Option<&str>,
    status: Option<u16>,
    res_body: Option<&str>,
    duration_ms: u128,
    error: Option<&str>,
) {
    let query = if query.is_empty() { "-" } else { query };
    let req_body = req_body.unwrap_or("-");
    let res_body = res_body.unwrap_or("-");
    let content_length = content_length.unwrap_or("-");
    // 链路 ID 由 Trace 中间件放进任务作用域，AccessLog 始终挂在其内侧
    let trace_id = trace::current_trace_id().unwrap_or_else(|| "-".to_string());

    if let Some(err) = error {
        tracing::error!(
            reqID = %req_id,
            traceID = %trace_id,
            method = %method,
            path = %path,
            query = %query,
            clientIP = %client_ip,
            userAgent = %user_agent,
            contentType = %content_type,
            contentLength = %content_length,
            reqBody = %req_body,
            duration = duration_ms,
            error = %err,
            "http request failed"
        );
    } else {
        let status = status.unwrap_or(0);
        let level_error = status >= 500;
        let level_warn = (400..500).contains(&status);
        if level_error {
            tracing::error!(
                reqID = %req_id,
                traceID = %trace_id,
                method = %method,
                path = %path,
                query = %query,
                status,
                clientIP = %client_ip,
                userAgent = %user_agent,
                contentType = %content_type,
                contentLength = %content_length,
                reqBody = %req_body,
                resBody = %res_body,
                duration = duration_ms,
                "http request"
            );
        } else if level_warn {
            tracing::warn!(
                reqID = %req_id,
                traceID = %trace_id,
                method = %method,
                path = %path,
                query = %query,
                status,
                clientIP = %client_ip,
                userAgent = %user_agent,
                contentType = %content_type,
                contentLength = %content_length,
                reqBody = %req_body,
                resBody = %res_body,
                duration = duration_ms,
                "http request"
            );
        } else {
            tracing::info!(
                reqID = %req_id,
                traceID = %trace_id,
                method = %method,
                path = %path,
                query = %query,
                status,
                clientIP = %client_ip,
                userAgent = %user_agent,
                contentType = %content_type,
                contentLength = %content_length,
                reqBody = %req_body,
                resBody = %res_body,
                duration = duration_ms,
                "http request"
            );
        }
    }
}
