//! 鉴权守卫（Nest Guard 角色）：决定请求能否进入受保护 Handler。
//!
//! 通过模块 `configure` 上的 `.wrap(Auth::…)` 挂载，而非全局中间件。

use std::rc::Rc;
use std::sync::Arc;
use std::task::{Context, Poll};

use actix_web::body::EitherBody;
use actix_web::{
    Error, HttpMessage, HttpResponse,
    dev::{ServiceRequest, ServiceResponse, Transform},
    web,
};
use futures::future::{LocalBoxFuture, Ready, ok};

use crate::clients::redis::RedisPool;
use crate::configures::configure::Configure;
use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::blacklist;
use crate::guards::session::{Session, SessionError};
use crate::utils::code::{auth as auth_codes, external, system};
use crate::utils::jwt::{Claims, JwtError, verify_token};
use crate::utils::token::bearer;
use authz::{Action, Permission, Resource, require};

/// 鉴权守卫。
#[derive(Clone, Copy)]
pub struct Auth {
    /// 是否要求 ADMIN 角色
    admin_only: bool,
}

impl Auth {
    /// 任意有效 JWT（非黑名单）
    pub fn isRequired() -> Self {
        Self { admin_only: false }
    }

    /// 仅 ADMIN
    pub fn admin() -> Self {
        Self { admin_only: true }
    }
}

impl<S, B> Transform<S, ServiceRequest> for Auth
where
    S: actix_web::dev::Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>
        + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Transform = AuthMiddleware<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(AuthMiddleware {
            service: Rc::new(service),
            admin_only: self.admin_only,
        })
    }
}

pub struct AuthMiddleware<S> {
    service: Rc<S>,
    admin_only: bool,
}

impl<S, B> actix_web::dev::Service<ServiceRequest> for AuthMiddleware<S>
where
    S: actix_web::dev::Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>
        + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    fn poll_ready(&self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.service.poll_ready(cx)
    }

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let service = Rc::clone(&self.service);
        let admin_only = self.admin_only;
        let is_public = crate::guards::public::file(&req);

        // 公开路径且无 Bearer：直接放行（可见性由 Handler ACL 判定）
        let token = match bearer(req.headers()) {
            Some(token) => token,
            None if is_public => {
                return Box::pin(async move { Ok(service.call(req).await?.map_into_left_body()) });
            }
            None => {
                return Box::pin(async move {
                    Ok(json_error(req, Exception::unauthorized("用户未登录")))
                });
            }
        };

        let secret = match req.app_data::<web::Data<Arc<Configure>>>() {
            Some(cfg) => cfg.jwt_secret().to_string(),
            None => {
                return Box::pin(async move {
                    Ok(json_error(req, Exception::internal_error("服务配置缺失")))
                });
            }
        };

        let claims = match verify_token(&token, &secret) {
            Ok(claims) => claims,
            Err(err) => {
                return Box::pin(async move { Ok(json_error(req, jwt_exception(err))) });
            }
        };

        // 先用令牌声明快速拒绝（不触库、不触缓存）；真正的判定在会话建立之后
        if admin_only && !claim_allows_admin(&claims) {
            return Box::pin(async move {
                Ok(json_error(
                    req,
                    Exception::custom(auth_codes::INSUFFICIENT_PERMISSIONS, "权限不足"),
                ))
            });
        }

        let redis = match req.app_data::<web::Data<Arc<RedisPool>>>().cloned() {
            Some(redis) => redis,
            None => {
                return Box::pin(async move {
                    Ok(json_error(
                        req,
                        Exception::custom(external::CACHE_ERROR, "缓存服务未配置"),
                    ))
                });
            }
        };

        Box::pin(async move {
            match blacklist::has(redis.as_ref(), &token).await {
                Ok(true) => {
                    return Ok(json_error(
                        req,
                        Exception::custom(auth_codes::INVALID_CREDENTIALS, "登录凭证已失效"),
                    ));
                }
                Ok(false) => {}
                Err(_) => {
                    return Ok(json_error(
                        req,
                        Exception::custom(external::CACHE_ERROR, "缓存服务异常"),
                    ));
                }
            }

            let Some(storage) = req.app_data::<web::Data<Arc<Storage>>>().cloned() else {
                return Ok(json_error(req, Exception::internal_error("存储服务未配置")));
            };

            // 令牌只证明「是谁」；角色与账号状态一律以库为准
            let session = match Session::resolve(storage.as_ref(), &claims, &token).await {
                Ok(session) => session,
                Err(err) => {
                    tracing::warn!(error = %err, "会话建立失败");
                    return Ok(json_error(req, session_exception(err)));
                }
            };

            if admin_only {
                let decision = require(
                    &session.principal(),
                    Permission::new(Resource::Account, Action::Manage),
                );

                if let Err(denied) = decision {
                    tracing::warn!(reason = denied.reason().as_str(), "平台角色不足");
                    return Ok(json_error(
                        req,
                        Exception::custom(auth_codes::INSUFFICIENT_PERMISSIONS, "权限不足"),
                    ));
                }
            }

            req.extensions_mut().insert(session);
            Ok(service.call(req).await?.map_into_left_body())
        })
    }
}

fn json_error<B>(req: ServiceRequest, body: Exception) -> ServiceResponse<EitherBody<B>> {
    let (http_req, _) = req.into_parts();
    let status = body.status();
    ServiceResponse::new(http_req, HttpResponse::build(status).json(body)).map_into_right_body()
}

/// 令牌声明的平台角色是否允许进入 ADMIN 路由。
///
/// 仅用于快速拒绝：声明缺失或字面量无法识别一律返回 `false`（fail-closed）。
/// 真正的授权结论由 [`Session`] 结合库中的角色给出。
fn claim_allows_admin(claims: &Claims) -> bool {
    claims
        .platform_role()
        .is_ok_and(|role| role.is_platform_admin())
}

/// 会话建立失败 → 业务错误信封（可单测）。
pub fn session_exception(err: SessionError) -> Exception {
    match err {
        SessionError::InvalidSubject | SessionError::UnknownAccount => {
            Exception::custom(auth_codes::INVALID_CREDENTIALS, "登录凭证无效")
        }
        SessionError::AccountDisabled => {
            Exception::custom(auth_codes::ACCOUNT_DISABLED, "账号已停用")
        }
        SessionError::Persist(_) => Exception::custom(system::INTERNAL_ERROR, "账号数据异常"),
    }
}

/// JWT 校验失败 → 业务错误信封（可单测）。
pub fn jwt_exception(err: JwtError) -> Exception {
    match err {
        JwtError::InvalidToken => Exception::custom(auth_codes::TOKEN_EXPIRED, "登录凭证过期"),
        JwtError::DecodingError(_) | JwtError::EncodingError(_) => {
            Exception::custom(auth_codes::INVALID_CREDENTIALS, "登录凭证无效")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::code::{auth as auth_codes, system};
    use actix_web::http::StatusCode;
    use actix_web::test as awtest;
    use actix_web::{App, HttpResponse, web};
    use identity::PlatformRole;
    use serde_json::Value;
    use std::sync::Arc;

    fn test_configure() -> Configure {
        Configure::test("test-secret-key-at-least-32-characters!")
    }

    #[test]
    fn expired_maps_to_token_expired_code() {
        let body = jwt_exception(JwtError::InvalidToken);
        assert_eq!(body.code, auth_codes::TOKEN_EXPIRED);
        assert_eq!(body.msg, "登录凭证过期");
    }

    #[test]
    fn decode_error_maps_to_invalid_credentials() {
        let body = jwt_exception(JwtError::DecodingError("bad".into()));
        assert_eq!(body.code, auth_codes::INVALID_CREDENTIALS);
    }

    #[test]
    fn admin_flag() {
        assert!(Auth::admin().admin_only);
        assert!(!Auth::isRequired().admin_only);
    }

    fn claims_with_role(role: &str) -> Claims {
        Claims {
            sub: "u1".into(),
            username: "bob".into(),
            role: role.into(),
            exp: 0,
            iat: 0,
        }
    }

    #[test]
    fn claim_admin_fast_path_is_fail_closed() {
        assert!(claim_allows_admin(&claims_with_role("ADMIN")));
        assert!(!claim_allows_admin(&claims_with_role("USER")));
        // 声明缺失（老令牌）或字面量无法识别：不猜测，直接拒绝
        assert!(!claim_allows_admin(&claims_with_role("")));
        assert!(!claim_allows_admin(&claims_with_role("SUPERUSER")));
    }

    #[test]
    fn session_errors_map_to_envelopes() {
        assert_eq!(
            session_exception(SessionError::InvalidSubject).code,
            auth_codes::INVALID_CREDENTIALS
        );
        assert_eq!(
            session_exception(SessionError::UnknownAccount).code,
            auth_codes::INVALID_CREDENTIALS
        );
        assert_eq!(
            session_exception(SessionError::AccountDisabled).code,
            auth_codes::ACCOUNT_DISABLED
        );

        let broken = identity::PersistError::UnknownLiteral {
            column: "auth.role".into(),
            literal: "SUPERUSER".into(),
        };
        assert_eq!(
            session_exception(SessionError::Persist(broken)).code,
            system::INTERNAL_ERROR
        );
    }

    #[actix_web::test]
    async fn required_without_config_returns_internal_envelope() {
        let app = awtest::init_service(App::new().wrap(Auth::isRequired()).route(
            "/x",
            web::get().to(|| async { HttpResponse::Ok().body("ok") }),
        ))
        .await;

        // 有 Bearer 才会走到 Configure 读取；无 token 直接未登录
        let req = awtest::TestRequest::get()
            .uri("/x")
            .insert_header(("Authorization", "Bearer not-a-real-jwt"))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let body: Value = awtest::read_body_json(resp).await;
        assert_eq!(body["success"], false);
        assert_eq!(body["code"], system::INTERNAL_ERROR);
        assert_eq!(body["msg"], "服务配置缺失");
    }

    #[actix_web::test]
    async fn required_without_redis_returns_cache_envelope() {
        let cfg = test_configure();
        let token = crate::utils::jwt::generate_token(
            "u1",
            "bob",
            PlatformRole::User,
            cfg.jwt_secret(),
            Some(1),
        )
        .unwrap();
        let app = awtest::init_service(
            App::new()
                .app_data(web::Data::new(Arc::new(cfg)))
                .wrap(Auth::isRequired())
                .route(
                    "/x",
                    web::get().to(|| async { HttpResponse::Ok().body("ok") }),
                ),
        )
        .await;

        let req = awtest::TestRequest::get()
            .uri("/x")
            .insert_header(("Authorization", format!("Bearer {token}")))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let body: Value = awtest::read_body_json(resp).await;
        assert_eq!(body["success"], false);
        assert_eq!(body["code"], external::CACHE_ERROR);
        assert_eq!(body["msg"], "缓存服务未配置");
    }

    #[actix_web::test]
    async fn files_require_auth_fail_closed() {
        let app = awtest::init_service(App::new().wrap(Auth::isRequired()).route(
            "/api/v1/upload/files/{hash}",
            web::get().to(|| async { HttpResponse::Ok().body("file") }),
        ))
        .await;

        let req = awtest::TestRequest::get()
            .uri("/api/v1/upload/files/abc")
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        let body: Value = awtest::read_body_json(resp).await;
        assert_eq!(body["success"], false);
        assert_ne!(body["msg"], "file");
    }

    #[actix_web::test]
    async fn public_asset_get_allows_anonymous() {
        let app = awtest::init_service(App::new().wrap(Auth::isRequired()).route(
            "/api/v1/upload/asset/{id}",
            web::get().to(|| async { HttpResponse::Ok().body("asset") }),
        ))
        .await;

        let req = awtest::TestRequest::get()
            .uri("/api/v1/upload/asset/550e8400-e29b-41d4-a716-446655440000")
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        let body = awtest::read_body(resp).await;
        assert_eq!(body, "asset");
    }

    #[actix_web::test]
    async fn admin_only_rejects_user_role_token() {
        let cfg = test_configure();
        let token = crate::utils::jwt::generate_token(
            "u1",
            "bob",
            PlatformRole::User,
            cfg.jwt_secret(),
            Some(1),
        )
        .unwrap();

        let app = awtest::init_service(
            App::new()
                .app_data(web::Data::new(Arc::new(cfg)))
                .wrap(Auth::admin())
                .route(
                    "/x",
                    web::get().to(|| async { HttpResponse::Ok().body("ok") }),
                ),
        )
        .await;

        let req = awtest::TestRequest::get()
            .uri("/x")
            .insert_header(("Authorization", format!("Bearer {token}")))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
        let body: Value = awtest::read_body_json(resp).await;
        assert_eq!(body["success"], false);
        assert_eq!(body["code"], auth_codes::INSUFFICIENT_PERMISSIONS);
        assert_eq!(body["msg"], "权限不足");
    }
}
