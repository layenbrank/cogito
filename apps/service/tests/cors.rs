//! CORS 预检守卫：浏览器发来的 `OPTIONS` 必须被中间件接住并回 `Access-Control-Allow-Origin`，
//! 而不是被 actix-cors 以 400 拒掉。
//!
//! 回归目标（2026-09-29）：`cors.origins` 写成 `['*']` 时，旧实现把它当**字面量 Origin** 交给
//! `allowed_origin`（actix-cors 只做精确匹配），于是任何真实 Origin 都匹配不上 →
//! 预检被 `CorsError::OriginNotAllowed` 以 **400** 拒掉且响应不带 ACAO，浏览器侧表现为
//! 「Response to preflight request doesn't pass access control check」。
//!
//! 同一处还有第二个坑：前端会带自定义头 `traceparent` / `x-tenant-id`，白名单里漏一个就是
//! `CorsError::HeadersNotAllowed`（同样 400），所以这里连请求头白名单一起钉住。

use actix_web::{
    App, HttpResponse,
    dev::ServiceResponse,
    http::{Method, header},
    test, web,
};
use cogito::{configures::configure::Configure, middlewares::cors::cors};

/// 前端实际会打的路径（studio 的 `apis/auth.ts` → `POST /auth/captcha`）。
const CAPTCHA_PATH: &str = "/api/v1/auth/captcha";

/// studio 的 dev server Origin（Vite renderer），与 API 的 `127.0.0.1:3000` 不同源。
const STUDIO_ORIGIN: &str = "http://localhost:9523";

/// 前端真正会带的非简单头（studio `utils/http.ts`：traceparent + X-Tenant-ID + Authorization）。
const REQUEST_HEADERS: &str = "authorization, content-type, traceparent, x-tenant-id";

/// 预检请求：`OPTIONS` + `Origin` + `Access-Control-Request-Method/Headers`。
fn preflight(origin: &str) -> test::TestRequest {
    test::TestRequest::with_uri(CAPTCHA_PATH)
        .method(Method::OPTIONS)
        .insert_header((header::ORIGIN, origin))
        .insert_header((header::ACCESS_CONTROL_REQUEST_METHOD, "POST"))
        .insert_header((header::ACCESS_CONTROL_REQUEST_HEADERS, REQUEST_HEADERS))
}

/// 只改 CORS 一项的配置；`Configure::default()` 的 env 是 development（= 非生产分支）。
fn config_with(origins: &[&str]) -> Configure {
    let mut config = Configure::default();
    config.cors.origins = origins.iter().map(|origin| (*origin).to_owned()).collect();
    config
}

fn header_of<B>(response: &ServiceResponse<B>, name: header::HeaderName) -> Option<String> {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

/// `*` 必须走 `allow_any_origin`（而不是被当成一个字面量 Origin），前端预检才过得去。
#[actix_web::test]
async fn wildcard_origin_allows_the_frontend_preflight() {
    let config = config_with(&["*"]);
    let app = test::init_service(App::new().wrap(cors(&config)).route(
        CAPTCHA_PATH,
        web::post().to(|| async { HttpResponse::Ok().finish() }),
    ))
    .await;

    let response = test::call_service(&app, preflight(STUDIO_ORIGIN).to_request()).await;

    assert_eq!(response.status(), 200, "通配配置下预检被拒");

    // `allow_any_origin()` 在本版本回显请求的 Origin（`send_wildcard` 默认 false），
    // `*` 与回显对浏览器都算放行 —— 两种都接受，重点是「必须有这个头」。
    let allow_origin = header_of(&response, header::ACCESS_CONTROL_ALLOW_ORIGIN);
    assert!(
        matches!(allow_origin.as_deref(), Some("*") | Some(STUDIO_ORIGIN)),
        "通配配置下必须回 Access-Control-Allow-Origin，实际：{allow_origin:?}"
    );

    // 请求头白名单必须覆盖前端的自定义头，否则浏览器仍会拦下真正的 POST
    let allowed = header_of(&response, header::ACCESS_CONTROL_ALLOW_HEADERS).unwrap_or_default();
    for name in [
        "authorization",
        "content-type",
        "traceparent",
        "x-tenant-id",
    ] {
        assert!(
            allowed.to_ascii_lowercase().contains(name),
            "预检响应缺少允许头 {name}：{allowed}"
        );
    }
}

/// 显式列表走精确匹配，命中的 Origin 原样回显。
#[actix_web::test]
async fn listed_origin_is_echoed_back() {
    let config = config_with(&[STUDIO_ORIGIN]);
    let app = test::init_service(App::new().wrap(cors(&config)).route(
        CAPTCHA_PATH,
        web::post().to(|| async { HttpResponse::Ok().finish() }),
    ))
    .await;

    let response = test::call_service(&app, preflight(STUDIO_ORIGIN).to_request()).await;

    assert_eq!(response.status(), 200);
    assert_eq!(
        header_of(&response, header::ACCESS_CONTROL_ALLOW_ORIGIN).as_deref(),
        Some(STUDIO_ORIGIN)
    );
}

/// 不在列表里的 Origin 被拒：状态码保持 actix-cors 的 400，响应不带 ACAO
/// （这就是 `['*']` 误用时的表现，钉住它以免再被误判成「服务没起来」）。
#[actix_web::test]
async fn unlisted_origin_is_rejected_without_cors_headers() {
    let config = config_with(&["http://evil.example.com"]);
    let app = test::init_service(App::new().wrap(cors(&config)).route(
        CAPTCHA_PATH,
        web::post().to(|| async { HttpResponse::Ok().finish() }),
    ))
    .await;

    let response = test::call_service(&app, preflight(STUDIO_ORIGIN).to_request()).await;

    assert_eq!(response.status(), 400);
    assert!(header_of(&response, header::ACCESS_CONTROL_ALLOW_ORIGIN).is_none());
}

/// 生产不允许通配：配置里写了 `*` 也只当作「不放行任意 Origin」，避免上线后静默全开。
#[actix_web::test]
async fn wildcard_is_refused_in_production() {
    let mut config = config_with(&["*"]);
    config.app.env = "production".to_owned();
    let app = test::init_service(App::new().wrap(cors(&config)).route(
        CAPTCHA_PATH,
        web::post().to(|| async { HttpResponse::Ok().finish() }),
    ))
    .await;

    let response = test::call_service(&app, preflight(STUDIO_ORIGIN).to_request()).await;

    assert_eq!(response.status(), 400);
    assert!(header_of(&response, header::ACCESS_CONTROL_ALLOW_ORIGIN).is_none());
}
