//! CORS 配置（Nest Middleware 角色）

use actix_cors::Cors;
use actix_web::http::header;

use crate::configures::configure::Configure;

/// 浏览器侧请求头白名单。
///
/// 前三个是常规头；`traceparent` 与 `x-tenant-id` 是本仓前端自己的头（studio 的
/// `utils/http.ts`）—— 漏掉任一个，预检都会以 [`CorsError::HeadersNotAllowed`] 400 收场。
///
/// [`CorsError::HeadersNotAllowed`]: actix_cors::CorsError
fn request_headers() -> Vec<header::HeaderName> {
    vec![
        header::AUTHORIZATION,
        header::ACCEPT,
        header::CONTENT_TYPE,
        header::HeaderName::from_static("traceparent"),
        header::HeaderName::from_static("x-tenant-id"),
    ]
}

/// 按 [`Configure::cors_origins`] 构建 CORS。
///
/// - 含 `*`：非生产放行任意 Origin（本地联调），生产只告警并拒绝
/// - 其余非空：仅允许列出的 Origin（**精确匹配**）
/// - 列表为空且非生产：`allow_any_origin`（本地联调）
/// - 列表为空且生产：不放行任意 Origin（须配置 `CORS_ORIGINS`）
///
/// `*` 必须映射到 [`Cors::allow_any_origin`]：actix-cors 的 `allowed_origin` 是**字面量
/// 精确匹配**，把 `"*"` 当 Origin 传进去只会得到一条永不命中的规则（库自己的错误枚举里
/// `WildcardOrigin`「`allowed_origin` 参数不得是通配符」说的就是这件事），预检会直接以
/// `OriginNotAllowed` 400 结束且响应不带 `Access-Control-Allow-Origin`。
pub fn cors(config: &Configure) -> Cors {
    let base = Cors::default()
        .allowed_methods(vec!["GET", "POST", "PUT", "DELETE", "OPTIONS"])
        .allowed_headers(request_headers())
        .max_age(3600);

    let origins = config.cors_origins();

    if origins.iter().any(|origin| origin.trim() == "*") {
        if config.is_production() {
            tracing::warn!("CORS origins 含通配符 *，生产拒绝：请改成明确的 Origin 列表");
            return base;
        }
        return base.allow_any_origin();
    }

    if !origins.is_empty() {
        return origins
            .iter()
            .fold(base, |cors, origin| cors.allowed_origin(origin));
    }

    if config.is_production() {
        tracing::warn!("CORS_ORIGINS empty in production; cross-origin browser calls will fail");
        base
    } else {
        base.allow_any_origin().send_wildcard()
    }
}
