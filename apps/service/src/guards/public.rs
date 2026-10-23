//! 公开路径策略：无需 JWT 即可进入 Handler（可选携带 JWT）。
//!
//! 由 [`crate::guards::auth::Auth`] 在校验前调用；未列入此处的路径仍强制登录。

use actix_web::dev::ServiceRequest;
use actix_web::http::Method;

const PUBLIC_AUTH_POST: &[&str] = &[
    "/api/v1/auth/captcha",
    "/api/v1/auth/otp",
    "/api/v1/auth/signin",
    "/api/v1/auth/signup",
    "/api/v1/auth/signin/phone",
    "/api/v1/auth/signin/email",
    "/api/v1/auth/password/forgot",
    "/api/v1/auth/password/reset",
    // 异常上报：可匿名；有 Bearer 时 Auth 仍解析 Session 回填 userID
    "/api/v1/exception",
];

const PUBLIC_ASSET_PREFIX: &str = "/api/v1/upload/asset/";

/// OIDC 的浏览器往返入口前缀：`/api/v1/sso/{连接 id}/{authorize|callback}`。
/// IdP 跳回来时没有我们的会话，只能靠回调地址里的连接 id 确权。
const PUBLIC_SSO_PREFIX: &str = "/api/v1/sso/";

/// 是否落在 OIDC 往返入口上。**必须判到段**：同前缀下还有 `/sso/connections` 管理面，
/// 只看前缀或只看后缀都会把它一起放成匿名可读。
fn is_sso_oidc_path(path: &str) -> bool {
    let Some(rest) = path.strip_prefix(PUBLIC_SSO_PREFIX) else {
        return false;
    };
    let mut segments = rest.split('/');
    let (Some(connection_id), Some(action), None) =
        (segments.next(), segments.next(), segments.next())
    else {
        return false;
    };
    !connection_id.is_empty() && matches!(action, "authorize" | "callback")
}

/// 是否允许匿名访问。
pub fn allows(method: &Method, path: &str) -> bool {
    if *method == Method::POST && PUBLIC_AUTH_POST.contains(&path) {
        return true;
    }
    // 按资产 id 下载：可见性在 Handler 内再判（PUBLIC 可匿名）
    if *method == Method::GET && path.starts_with(PUBLIC_ASSET_PREFIX) {
        return true;
    }
    if *method == Method::GET && is_sso_oidc_path(path) {
        return true;
    }
    false
}

/// 是否放行当前请求（匿名或可选 JWT）。
pub fn file(req: &ServiceRequest) -> bool {
    allows(req.method(), req.path())
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::http::Method;

    #[test]
    fn auth_post_routes_public() {
        assert!(allows(&Method::POST, "/api/v1/auth/captcha"));
        assert!(allows(&Method::POST, "/api/v1/auth/signin/phone"));
        assert!(allows(&Method::POST, "/api/v1/auth/password/forgot"));
        assert!(allows(&Method::POST, "/api/v1/exception"));
        assert!(!allows(&Method::GET, "/api/v1/exception"));
        assert!(!allows(&Method::PUT, "/api/v1/auth/password"));
        assert!(!allows(&Method::GET, "/api/v1/upload/files/abc"));
        assert!(!allows(&Method::GET, "/api/v1/upload/files"));
    }

    #[test]
    fn asset_get_is_public_prefix() {
        assert!(allows(
            &Method::GET,
            "/api/v1/upload/asset/550e8400-e29b-41d4-a716-446655440000"
        ));
        assert!(!allows(&Method::POST, "/api/v1/upload/asset/x"));
        assert!(!allows(&Method::GET, "/api/v1/upload/assets/x"));
    }

    #[test]
    fn sso_oidc_routes_public_but_admin_face_is_not() {
        let id = "550e8400-e29b-41d4-a716-446655440000";
        assert!(allows(&Method::GET, &format!("/api/v1/sso/{id}/authorize")));
        assert!(allows(&Method::GET, &format!("/api/v1/sso/{id}/callback")));
        // 管理面同前缀，绝不能匿名
        assert!(!allows(&Method::GET, "/api/v1/sso/connections"));
        assert!(!allows(&Method::POST, "/api/v1/sso/connections"));
        assert!(!allows(
            &Method::DELETE,
            &format!("/api/v1/sso/connections/{id}")
        ));
        assert!(!allows(&Method::GET, "/api/v1/sso/authorize"));
        assert!(!allows(&Method::GET, &format!("/api/v1/sso/{id}")));
        assert!(!allows(
            &Method::GET,
            &format!("/api/v1/sso/{id}/authorize/x")
        ));
        assert!(!allows(
            &Method::POST,
            &format!("/api/v1/sso/{id}/authorize")
        ));
    }
}
