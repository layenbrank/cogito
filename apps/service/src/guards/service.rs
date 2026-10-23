//! 服务身份守卫：让**受信的服务进程**（当前只有 compute）走 cogito 的出站端点。
//!
//! 与 [`Auth`](crate::guards::auth::Auth) 的区别是「谁在调用」：不是终端用户，而是服务。
//! 两个请求头对应两种信任，彼此不能互相替代：
//!
//! * `X-Internal-Token`（[`InternalCaller`]）：cogito ↔ compute 的共享密钥，只能换令牌；
//! * `X-Service-Token`（[`ServiceScope`] / [`AssetScope`] / [`ChatScope`] / [`AssetWriteScope`]）：
//!   cogito 签发的短期令牌，**自带作用域**（租户 + 模型，或租户 + 单个资产，或租户 + 一次已批准的
//!   可见性写入），是出站端点的唯一有效凭据。
//!
//! 实现成 [`FromRequest`] 而不是中间件，是为了让「没验身份就拿不到入参」这件事由类型系统
//! 保证：handler 的形参里出现 `ServiceScope`，就等于声明了该端点只对服务身份开放，
//! 也没有「忘了加守卫」这种可能（中间件写在 scope 上，改一行 wrap 就能漏掉整层）。
//! 每个提取器各自写死受众：拿嵌入令牌打内容端点会 401，反之亦然；嵌入与聊天虽然
//! 作用域同形（租户 + 模型），也各自对应一个提取器——受众是硬边界，它不能在类型上被合并。
//! 写令牌还多一层：除受众外必须带一份审批凭据（见 [`AssetWriteScope`]）。读是「借你看」，
//! 写是「照批过的办」。

use std::future::{Ready, ready};

use actix_web::{FromRequest, HttpRequest, dev::Payload, web};
use identity::{PlatformRole, Principal, TenantContext, TenantId, UserId};

use crate::configures::configure::Configure;
use crate::filters::exception::Exception;
use crate::services::gateway::service_token::{self, Audience, ServiceTokenError};
use crate::services::upload::schema::Visibility;
use crate::utils::code::{auth as auth_codes, system};

/// 服务身份令牌请求头。
pub const SERVICE_TOKEN_HEADER: &str = "x-service-token";
/// cogito ↔ compute 的内部共享令牌请求头。
pub const INTERNAL_TOKEN_HEADER: &str = "x-internal-token";

/// 已验签的服务身份作用域。
///
/// 租户与模型都从令牌里取：调用方在请求体或查询串里说什么都不算数，
/// 于是「换到的令牌只能干这一件事」是结构上的事实，而不是一处需要记得写的判断。
#[derive(Debug, Clone)]
pub struct ServiceScope {
    tenant_id: TenantId,
    model: String,
}

impl ServiceScope {
    /// 作用域租户。
    #[must_use]
    pub const fn tenant_id(&self) -> TenantId {
        self.tenant_id
    }

    /// 作用域模型名。
    #[must_use]
    pub fn model(&self) -> &str {
        &self.model
    }

    /// 该身份在领域层的样子：租户内的一个无成员角色主体。
    ///
    /// 它不是某个账号——服务进程没有账号；用量/审计行按 `tenantID` 归属，
    /// `userID` 记为服务主体（见 [`SERVICE_ACTOR_ID`]）。
    #[must_use]
    pub fn principal(&self) -> Principal {
        Principal::new(UserId::from_uuid(SERVICE_ACTOR_ID), PlatformRole::User)
            .with_tenant(TenantContext::new(self.tenant_id))
    }
}

/// 服务身份在用量/审计行里的 `userID`。
///
/// 服务进程不是账号，但用量行必须有个主体：全零 UUID 是显式的「这是服务调用」，
/// 与任何真实账号都不冲突（`gateway_usage.userID` 没有外键）。
pub const SERVICE_ACTOR_ID: uuid::Uuid = uuid::Uuid::nil();

/// 已验签的资产读取作用域（`AssetContent` 受众）。
///
/// 与 [`ServiceScope`] 的差别只有一件事：作用域里带的是一个**具体资产**而不是模型。
/// 于是「拿到的令牌只能读这一个资产」同样是结构上的事实——端点从令牌里取 assetID，
/// 路径上的 assetID 只用于比对，不用于授权。
#[derive(Debug, Clone)]
pub struct AssetScope {
    tenant_id: TenantId,
    asset_id: String,
}

impl AssetScope {
    /// 作用域租户。
    #[must_use]
    pub const fn tenant_id(&self) -> TenantId {
        self.tenant_id
    }

    /// 作用域资产 ID（原始字符串，领域层再解析）。
    #[must_use]
    pub fn asset_id(&self) -> &str {
        &self.asset_id
    }

    /// 该身份在领域层的样子：租户内的一个无成员角色主体。
    #[must_use]
    pub fn principal(&self) -> Principal {
        Principal::new(UserId::from_uuid(SERVICE_ACTOR_ID), PlatformRole::User)
            .with_tenant(TenantContext::new(self.tenant_id))
    }
}

/// 已验签的资产可见性写入作用域（`AssetVisibility` 受众）。
///
/// 这是唯一一种**带审批凭据**的服务身份：改哪个资产、改成什么样，在换令牌时就由人批过了，
/// 写端点因此没有请求体——路径上的 assetID 只用于比对，不用于授权。
///
/// 它与 [`AssetScope`] 必须是两个类型（受众是硬边界），也刻意**不提供 `principal()`**：
/// 写以批准人的身份落地（资产行级策略只认创建者），若给一个「服务主体」出来，
/// 调用方很容易顺手拿它去写，那就写不进去了。
#[derive(Debug, Clone)]
pub struct AssetWriteScope {
    tenant_id: TenantId,
    asset_id: String,
    approval_id: String,
    actor_id: String,
    visibility: Visibility,
    viewers: Vec<uuid::Uuid>,
}

impl AssetWriteScope {
    /// 作用域租户。
    #[must_use]
    pub const fn tenant_id(&self) -> TenantId {
        self.tenant_id
    }

    /// 作用域资产 ID（原始字符串，领域层再解析）。
    #[must_use]
    pub fn asset_id(&self) -> &str {
        &self.asset_id
    }

    /// 这次写依据的审批标识（写进审计/日志，便于回查「谁批的」）。
    #[must_use]
    pub fn approval_id(&self) -> &str {
        &self.approval_id
    }

    /// 批准人：写以他的身份落地。
    #[must_use]
    pub fn actor_id(&self) -> &str {
        &self.actor_id
    }

    /// 人批过的可见性。
    #[must_use]
    pub const fn visibility(&self) -> &Visibility {
        &self.visibility
    }

    /// 人批过的可见对象（仅 `RESTRICTED` 有值）。
    #[must_use]
    pub fn viewers(&self) -> &[uuid::Uuid] {
        &self.viewers
    }
}

/// 已验签的聊天出站作用域（`Chat` 受众）。
///
/// 载荷形状与 [`ServiceScope`] 完全一样（租户 + 模型），但**必须是独立类型**：
/// 受众是在提取器的 [`FromRequest`] 里写死的，复用同一个类型就等于让聊天端点
/// 接受嵌入令牌（反之亦然）。两件事共用一个类型，是「受众是硬边界」这句话唯一会漏的地方。
#[derive(Debug, Clone)]
pub struct ChatScope(ServiceScope);

impl ChatScope {
    /// 作用域租户。
    #[must_use]
    pub const fn tenant_id(&self) -> TenantId {
        self.0.tenant_id()
    }

    /// 作用域模型名。
    #[must_use]
    pub fn model(&self) -> &str {
        self.0.model()
    }

    /// 该身份在领域层的样子：租户内的一个无成员角色主体。
    #[must_use]
    pub fn principal(&self) -> Principal {
        self.0.principal()
    }
}

/// 已确认的内部共享调用方（`X-Internal-Token` 校验通过）。
#[derive(Debug, Clone, Copy)]
pub struct InternalCaller;

impl FromRequest for ServiceScope {
    type Error = Exception;
    type Future = Ready<Result<Self, Self::Error>>;

    fn from_request(req: &HttpRequest, _payload: &mut Payload) -> Self::Future {
        ready(verify_service(req))
    }
}

impl FromRequest for AssetScope {
    type Error = Exception;
    type Future = Ready<Result<Self, Self::Error>>;

    fn from_request(req: &HttpRequest, _payload: &mut Payload) -> Self::Future {
        ready(verify_asset(req))
    }
}

impl FromRequest for ChatScope {
    type Error = Exception;
    type Future = Ready<Result<Self, Self::Error>>;

    fn from_request(req: &HttpRequest, _payload: &mut Payload) -> Self::Future {
        ready(verify_chat(req))
    }
}

impl FromRequest for AssetWriteScope {
    type Error = Exception;
    type Future = Ready<Result<Self, Self::Error>>;

    fn from_request(req: &HttpRequest, _payload: &mut Payload) -> Self::Future {
        ready(verify_asset_write(req))
    }
}

impl FromRequest for InternalCaller {
    type Error = Exception;
    type Future = Ready<Result<Self, Self::Error>>;

    fn from_request(req: &HttpRequest, _payload: &mut Payload) -> Self::Future {
        ready(verify_internal(req))
    }
}

/// 校验服务身份令牌（嵌入受众），成功返回作用域。
///
/// # Errors
/// 配置缺失、密钥未启用、请求头缺失/格式错误、签名/受众/有效期不通过。
pub fn verify_service(req: &HttpRequest) -> Result<ServiceScope, Exception> {
    let claims = verify_claims(req, Audience::Embeddings)?;
    let tenant_id = parse_tenant(&claims.tenant_id)?;
    // 受众已保证 model 存在且非空（见 `service_token::verify`）。
    let model = claims.model.unwrap_or_default();

    Ok(ServiceScope { tenant_id, model })
}

/// 校验服务身份令牌（资产内容受众），成功返回作用域。
///
/// # Errors
/// 同 [`verify_service`]，另加「受众不是资产内容」与「作用域缺少 assetID」。
pub fn verify_asset(req: &HttpRequest) -> Result<AssetScope, Exception> {
    let claims = verify_claims(req, Audience::AssetContent)?;
    let tenant_id = parse_tenant(&claims.tenant_id)?;
    let asset_id = claims.asset_id.unwrap_or_default();

    Ok(AssetScope {
        tenant_id,
        asset_id,
    })
}

/// 校验服务身份令牌（聊天受众），成功返回作用域。
///
/// 与 [`verify_service`] 只在受众上不同：嵌入令牌打聊天端点会在这里被拒
/// （反之亦然），因为受众是端点写死的，调用方无法「按请求体决定信任谁」。
///
/// # Errors
/// 同 [`verify_service`]。
pub fn verify_chat(req: &HttpRequest) -> Result<ChatScope, Exception> {
    let claims = verify_claims(req, Audience::Chat)?;
    let tenant_id = parse_tenant(&claims.tenant_id)?;
    let model = claims.model.unwrap_or_default();

    Ok(ChatScope(ServiceScope { tenant_id, model }))
}

/// 校验服务身份令牌（资产可见性写入受众），成功返回带审批凭据的作用域。
///
/// 这里把载荷里的字面量**解析成领域类型**：可见性只认认识的三个值，对象名单逐个必须是 uuid，
/// 且名单只在 `RESTRICTED` 下有意义。任一条不成立都按「令牌无效」处理——不认识的可见性
/// 降级成 PRIVATE 会写出一个跟人批的不一样的权限，宁可拒。
///
/// # Errors
/// 同 [`verify_service`]，另加「受众不是可见性写入」「缺少 assetID 或审批凭据」
/// 「可见性字面量不认识」「对象名单不是 uuid」「名单与可见性不自洽」。
pub fn verify_asset_write(req: &HttpRequest) -> Result<AssetWriteScope, Exception> {
    let claims = verify_claims(req, Audience::AssetVisibility)?;
    let tenant_id = parse_tenant(&claims.tenant_id)?;
    // 受众已保证 assetID 与一份三样非空的审批凭据存在（见 `service_token::verify`）。
    let asset_id = claims.asset_id.unwrap_or_default();
    let grant = claims.approval.ok_or_else(invalid_token)?;
    let visibility = Visibility::parse(&grant.visibility).ok_or_else(invalid_token)?;

    let mut viewers = Vec::with_capacity(grant.viewers.len());
    for raw in &grant.viewers {
        viewers.push(uuid::Uuid::parse_str(raw.trim()).map_err(|_| invalid_token())?);
    }
    if visibility != Visibility::Restricted && !viewers.is_empty() {
        return Err(invalid_token());
    }

    Ok(AssetWriteScope {
        tenant_id,
        asset_id,
        approval_id: grant.approval_id,
        actor_id: grant.actor_id,
        visibility,
        viewers,
    })
}

/// 服务令牌无效的统一答法：不区分「哪一处不对」，免得被当成探针逐个试。
fn invalid_token() -> Exception {
    Exception::custom(auth_codes::INVALID_CREDENTIALS, "服务身份令牌无效或已过期")
}

/// 两条服务身份通道的公共部分：取密钥、验签、按端点受众校验。
fn verify_claims(
    req: &HttpRequest,
    audience: Audience,
) -> Result<service_token::ServiceClaims, Exception> {
    let config = config(req)?;
    let secret = config.gateway_service_token_secret();
    if secret.is_empty() {
        // 没配密钥 = 这个部署不接受服务身份调用，明确拒绝而不是「悄悄放行」。
        return Err(Exception::custom(
            system::SERVICE_UNAVAILABLE,
            "服务身份端点未启用",
        ));
    }

    let raw = header(req, SERVICE_TOKEN_HEADER, "缺少服务身份令牌")?;
    service_token::verify(secret, raw, audience).map_err(|err| match err {
        ServiceTokenError::Invalid => {
            Exception::custom(auth_codes::INVALID_CREDENTIALS, "服务身份令牌无效或已过期")
        }
        ServiceTokenError::Encode(msg) => {
            tracing::error!(error = %msg, "服务身份令牌校验异常");
            Exception::internal_error("服务身份令牌校验失败")
        }
    })
}

fn parse_tenant(raw: &str) -> Result<TenantId, Exception> {
    raw.parse::<uuid::Uuid>()
        .map(TenantId::from_uuid)
        .map_err(|_| Exception::custom(auth_codes::INVALID_CREDENTIALS, "服务身份令牌无效或已过期"))
}

/// 校验内部共享令牌（cogito ↔ compute 双向信任的那一把）。
///
/// # Errors
/// 配置缺失、未配置内部令牌、请求头缺失或与配置不一致。
pub fn verify_internal(req: &HttpRequest) -> Result<InternalCaller, Exception> {
    let config = config(req)?;
    let expected = config.compute.token.trim();
    if expected.is_empty() {
        return Err(Exception::custom(
            system::SERVICE_UNAVAILABLE,
            "内部调用未配置",
        ));
    }

    let provided = header(req, INTERNAL_TOKEN_HEADER, "缺少内部调用令牌")?;
    if !constant_time_eq(provided.as_bytes(), expected.as_bytes()) {
        return Err(Exception::custom(
            auth_codes::INVALID_CREDENTIALS,
            "内部调用令牌无效",
        ));
    }

    Ok(InternalCaller)
}

fn config(req: &HttpRequest) -> Result<web::Data<std::sync::Arc<Configure>>, Exception> {
    req.app_data::<web::Data<std::sync::Arc<Configure>>>()
        .cloned()
        .ok_or_else(|| Exception::internal_error("服务配置缺失"))
}

fn header<'a>(req: &'a HttpRequest, name: &str, missing: &str) -> Result<&'a str, Exception> {
    req.headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| Exception::custom(auth_codes::INVALID_CREDENTIALS, missing))
}

/// 恒定时间比较：长度之外不泄露「前几个字符对上了」。
///
/// 共享密钥的比较不能用 `==`（短路比较会随匹配前缀变慢，足以在网络上被统计出来）。
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }

    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::test::TestRequest;

    /// 写令牌作用域里的资产与批准人：各条「不许」只改其中一处。
    const ASSET_ID: &str = "0193f0b1-0000-7000-8000-000000000001";
    const ACTOR_ID: &str = "0193f0b1-0000-7000-8000-0000000000aa";

    fn request(config: Configure) -> HttpRequest {
        TestRequest::default()
            .app_data(web::Data::new(std::sync::Arc::new(config)))
            .to_http_request()
    }

    fn enabled_config() -> Configure {
        let mut config = Configure::default();
        config.gateway.service_token_secret = "unit-test-service-token-secret".to_string();
        config.compute.token = "unit-test-internal-token".to_string();
        config
    }

    #[test]
    fn disabled_endpoint_rejects_before_looking_at_headers() {
        let err = verify_service(&request(Configure::default())).unwrap_err();

        assert_eq!(
            err.status(),
            actix_web::http::StatusCode::SERVICE_UNAVAILABLE
        );
    }

    #[test]
    fn missing_header_is_unauthorized() {
        let err = verify_service(&request(enabled_config())).unwrap_err();

        assert_eq!(err.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn invalid_token_is_unauthorized() {
        let req = TestRequest::default()
            .app_data(web::Data::new(std::sync::Arc::new(enabled_config())))
            .insert_header((SERVICE_TOKEN_HEADER, "not-a-jwt"))
            .to_http_request();

        assert_eq!(
            verify_service(&req).unwrap_err().status(),
            actix_web::http::StatusCode::UNAUTHORIZED
        );
    }

    #[test]
    fn valid_token_yields_scope_and_principal() {
        let config = enabled_config();
        let tenant = uuid::Uuid::new_v4();
        let (token, _) = service_token::mint(
            config.gateway_service_token_secret(),
            service_token::Scope::Embeddings {
                tenant_id: &tenant.to_string(),
                model: "text-embedding-3-small",
            },
            60,
        )
        .unwrap();
        let req = TestRequest::default()
            .app_data(web::Data::new(std::sync::Arc::new(config)))
            .insert_header((SERVICE_TOKEN_HEADER, token))
            .to_http_request();

        let scope = verify_service(&req).unwrap();

        assert_eq!(scope.tenant_id().as_uuid(), tenant);
        assert_eq!(scope.model(), "text-embedding-3-small");
        let principal = scope.principal();
        assert_eq!(principal.tenant_id(), Some(scope.tenant_id()));
        assert_eq!(principal.tenant_role(), None, "服务身份不是租户成员");
        assert_eq!(principal.user_id().as_uuid(), SERVICE_ACTOR_ID);
    }

    #[test]
    fn asset_token_yields_asset_scope() {
        let config = enabled_config();
        let tenant = uuid::Uuid::new_v4();
        let (token, _) = service_token::mint(
            config.gateway_service_token_secret(),
            service_token::Scope::AssetContent {
                tenant_id: &tenant.to_string(),
                asset_id: "0193f0b1-0000-7000-8000-000000000001",
            },
            60,
        )
        .unwrap();
        let req = TestRequest::default()
            .app_data(web::Data::new(std::sync::Arc::new(config)))
            .insert_header((SERVICE_TOKEN_HEADER, token))
            .to_http_request();

        let scope = verify_asset(&req).unwrap();

        assert_eq!(scope.tenant_id().as_uuid(), tenant);
        assert_eq!(scope.asset_id(), "0193f0b1-0000-7000-8000-000000000001");
        assert_eq!(scope.principal().user_id().as_uuid(), SERVICE_ACTOR_ID);
    }

    /// 两个提取器写死了各自的受众：令牌串门必须被拒。
    #[test]
    fn scopes_do_not_cross_endpoints() {
        let config = enabled_config();
        let tenant = uuid::Uuid::new_v4().to_string();
        let secret = config.gateway_service_token_secret();

        let (embeddings_token, _) = service_token::mint(
            secret,
            service_token::Scope::Embeddings {
                tenant_id: &tenant,
                model: "m",
            },
            60,
        )
        .unwrap();
        let (asset_token, _) = service_token::mint(
            secret,
            service_token::Scope::AssetContent {
                tenant_id: &tenant,
                asset_id: "asset-1",
            },
            60,
        )
        .unwrap();
        let write_token = asset_write_token(secret, &tenant, "PRIVATE", &[]);

        let with_embeddings = TestRequest::default()
            .app_data(web::Data::new(std::sync::Arc::new(config.clone())))
            .insert_header((SERVICE_TOKEN_HEADER, embeddings_token))
            .to_http_request();
        let with_asset = TestRequest::default()
            .app_data(web::Data::new(std::sync::Arc::new(config.clone())))
            .insert_header((SERVICE_TOKEN_HEADER, asset_token))
            .to_http_request();
        let with_write = TestRequest::default()
            .app_data(web::Data::new(std::sync::Arc::new(config)))
            .insert_header((SERVICE_TOKEN_HEADER, write_token))
            .to_http_request();

        assert!(
            verify_asset(&with_embeddings).is_err(),
            "嵌入令牌不能读内容"
        );
        assert!(verify_service(&with_asset).is_err(), "内容令牌不能做嵌入");
        // 写是更强的东西：读令牌不能写，写令牌也不该被读端点收下
        assert!(verify_asset_write(&with_asset).is_err(), "读令牌不能写");
        assert!(verify_asset_write(&with_embeddings).is_err());
        assert!(verify_asset(&with_write).is_err(), "写令牌不能当读令牌");
        assert!(verify_service(&with_write).is_err());
    }

    fn asset_write_token(
        secret: &str,
        tenant_id: &str,
        visibility: &str,
        viewers: &[String],
    ) -> String {
        let (token, _) = service_token::mint(
            secret,
            service_token::Scope::AssetVisibility {
                tenant_id,
                asset_id: ASSET_ID,
                approval_id: "task-1:0:0",
                actor_id: ACTOR_ID,
                visibility,
                viewers,
            },
            60,
        )
        .unwrap();
        token
    }

    fn asset_write_request(config: &Configure, token: &str) -> HttpRequest {
        TestRequest::default()
            .app_data(web::Data::new(std::sync::Arc::new(config.clone())))
            .insert_header((SERVICE_TOKEN_HEADER, token))
            .to_http_request()
    }

    #[test]
    fn asset_write_token_yields_granted_scope() {
        let config = enabled_config();
        let tenant = uuid::Uuid::new_v4();
        let viewer = uuid::Uuid::new_v4();
        let token = asset_write_token(
            config.gateway_service_token_secret(),
            &tenant.to_string(),
            "RESTRICTED",
            &[viewer.to_string()],
        );

        let scope = verify_asset_write(&asset_write_request(&config, &token)).unwrap();

        assert_eq!(scope.tenant_id().as_uuid(), tenant);
        assert_eq!(scope.asset_id(), ASSET_ID);
        assert_eq!(scope.approval_id(), "task-1:0:0");
        assert_eq!(scope.actor_id(), ACTOR_ID);
        assert_eq!(scope.visibility(), &Visibility::Restricted);
        assert_eq!(scope.viewers(), &[viewer]);
    }

    /// 载荷里的字面量在这里才被解析：不认识的可见性、不成形的名单一律 401，
    /// 而不是「降级成 PRIVATE 照写」。
    #[test]
    fn asset_write_rejects_malformed_grants() {
        let config = enabled_config();
        let tenant = uuid::Uuid::new_v4().to_string();
        let secret = config.gateway_service_token_secret();
        let viewer = uuid::Uuid::new_v4().to_string();

        for (visibility, viewers) in [
            ("INTERNAL", Vec::new()),
            ("public", Vec::new()),
            ("PRIVATE", vec![viewer.clone()]),
            ("PUBLIC", vec![viewer.clone()]),
            ("RESTRICTED", vec!["not-a-uuid".to_string()]),
            ("RESTRICTED", vec!["  ".to_string()]),
        ] {
            let token = asset_write_token(secret, &tenant, visibility, &viewers);
            let err = verify_asset_write(&asset_write_request(&config, &token))
                .expect_err("不成形的审批凭据必须被拒");

            assert_eq!(
                err.status(),
                actix_web::http::StatusCode::UNAUTHORIZED,
                "{visibility} + {viewers:?} 应当被拒"
            );
        }
    }

    #[test]
    fn internal_caller_requires_exact_token() {
        let config = enabled_config();

        let missing = request(config.clone());
        assert_eq!(
            verify_internal(&missing).unwrap_err().status(),
            actix_web::http::StatusCode::UNAUTHORIZED
        );

        let wrong = TestRequest::default()
            .app_data(web::Data::new(std::sync::Arc::new(config.clone())))
            .insert_header((INTERNAL_TOKEN_HEADER, "unit-test-internal-tokeN"))
            .to_http_request();
        assert!(verify_internal(&wrong).is_err());

        let ok = TestRequest::default()
            .app_data(web::Data::new(std::sync::Arc::new(config)))
            .insert_header((INTERNAL_TOKEN_HEADER, "unit-test-internal-token"))
            .to_http_request();
        assert!(verify_internal(&ok).is_ok());
    }

    #[test]
    fn internal_caller_reports_missing_configuration() {
        assert_eq!(
            verify_internal(&request(Configure::default()))
                .unwrap_err()
                .status(),
            actix_web::http::StatusCode::SERVICE_UNAVAILABLE
        );
    }

    #[test]
    fn constant_time_compare_matches_equality() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
        assert!(!constant_time_eq(b"", b"a"));
        assert!(constant_time_eq(b"", b""));
    }
}
