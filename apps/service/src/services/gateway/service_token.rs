//! 服务身份令牌：cogito 签发给受信服务进程（当前只有 compute）的**短期**凭据。
//!
//! 为什么不是「共享密钥直接用」：共享密钥是长期凭据，一旦落到编排历史、日志或某个
//! 子进程里就长期有效；短期令牌把有效窗口压到分钟级，并且**自带作用域**（租户 + 模型，
//! 或租户 + 单个资产，或租户 + 一次已批准的可见性写入），于是调用方无法用换来的令牌去用
//! 别的模型、读别的资产、改别的资产或碰别的租户——请求体里说了不算。
//!
//! 其中**写**令牌比读令牌多一层来源：它只能由人批过的那一次换出来（见 [`ApprovalGrant`]）。
//! 于是「模型想写、人说了算」在签发侧就被钉进载荷——写端点干脆没有请求体，改成什么样
//! 全在令牌里。
//!
//! 复算口径与用户会话令牌（[`crate::utils::jwt`]）刻意分开：密钥、受众、主体都不同，
//! 轮换其一不牵连另一侧。签名算法固定 HS256，签名密钥来自
//! [`Configure::gateway_service_token_secret`](configures::configure::Configure::gateway_service_token_secret)。

use chrono::Utc;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};

/// 令牌受众：嵌入出站端点（`POST /api/v1/service/embeddings`）。
pub const AUDIENCE_EMBEDDINGS: &str = "core.service.gateway.embeddings";
/// 令牌受众：资产内容端点（`GET /api/v1/service/assets/{assetID}/content`）。
pub const AUDIENCE_ASSET_CONTENT: &str = "core.service.asset.content";
/// 令牌受众：聊天出站端点（`POST /api/v1/service/chat/completions`）。
pub const AUDIENCE_CHAT: &str = "core.service.gateway.chat";
/// 令牌受众：资产可见性写入端点（`PUT /api/v1/service/assets/{assetID}/visibility`）。
pub const AUDIENCE_ASSET_VISIBILITY: &str = "core.service.asset.visibility";
/// 令牌主体：目前唯一的受信服务进程。
pub const SUBJECT: &str = "compute";

/// 服务身份能做的四件事。
///
/// 一件事一个受众，而不是「一个令牌管全部」：受众是 JWT 的标准字段，验签时按端点写死，
/// 于是嵌入用的令牌拿到内容端点上会直接 401——「越权」在这里不是一处需要记得写的判断，
/// 而是签名载荷里就没有那个受众。
///
/// 读是「别人的数据借你看」，写是「人批过的那一次照办」：所以写受众还多要一份
/// [`ApprovalGrant`]，光有受众不算数。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Audience {
    /// 嵌入出站。
    Embeddings,
    /// 资产内容读取。
    AssetContent,
    /// 聊天出站（agent 运行时用）。
    Chat,
    /// 资产可见性写入（agent 运行时用，凭据是一次已批准的审批）。
    AssetVisibility,
}

impl Audience {
    /// `aud` 声明值。
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Embeddings => AUDIENCE_EMBEDDINGS,
            Self::AssetContent => AUDIENCE_ASSET_CONTENT,
            Self::Chat => AUDIENCE_CHAT,
            Self::AssetVisibility => AUDIENCE_ASSET_VISIBILITY,
        }
    }

    /// 对外请求体里的 `scope` 字面量（比受众短，便于人读日志）。
    #[must_use]
    pub const fn scope(self) -> &'static str {
        match self {
            Self::Embeddings => "embeddings",
            Self::AssetContent => "asset-read",
            Self::Chat => "chat",
            Self::AssetVisibility => "asset-write",
        }
    }

    /// 解析请求体里的 `scope`。
    #[must_use]
    pub fn from_scope(value: &str) -> Option<Self> {
        match value.trim() {
            "embeddings" => Some(Self::Embeddings),
            "asset-read" => Some(Self::AssetContent),
            "chat" => Some(Self::Chat),
            "asset-write" => Some(Self::AssetVisibility),
            _ => None,
        }
    }
}

/// 一枚令牌的作用域：租户 + 该受众唯一允许的那一项资源。
#[derive(Debug, Clone, Copy)]
pub enum Scope<'a> {
    /// 嵌入：限定租户与模型（换到的令牌用不了别的模型）。
    Embeddings { tenant_id: &'a str, model: &'a str },
    /// 资产内容：限定租户与单个资产（换到的令牌读不了别的资产）。
    AssetContent {
        tenant_id: &'a str,
        asset_id: &'a str,
    },
    /// 聊天：限定租户与模型（同嵌入，但打的是聊天端点）。
    Chat { tenant_id: &'a str, model: &'a str },
    /// 资产可见性写入：限定租户、单个资产，以及**人批过的那一次审批**。
    ///
    /// `approval_id` 换出来的令牌只能改这一个资产；`actor_id` 是批准人，写就落在他的名下
    /// （资产行级策略只认创建者）。`visibility` / `viewers` 是人在审批里看过的**参数原文**，
    /// 签发时解析定稿，写端点不再收请求体。
    AssetVisibility {
        tenant_id: &'a str,
        asset_id: &'a str,
        approval_id: &'a str,
        actor_id: &'a str,
        visibility: &'a str,
        viewers: &'a [String],
    },
}

impl Scope<'_> {
    /// 作用域对应的受众。
    #[must_use]
    pub const fn audience(&self) -> Audience {
        match self {
            Self::Embeddings { .. } => Audience::Embeddings,
            Self::AssetContent { .. } => Audience::AssetContent,
            Self::Chat { .. } => Audience::Chat,
            Self::AssetVisibility { .. } => Audience::AssetVisibility,
        }
    }

    const fn tenant_id(&self) -> &str {
        match self {
            Self::Embeddings { tenant_id, .. }
            | Self::AssetContent { tenant_id, .. }
            | Self::Chat { tenant_id, .. }
            | Self::AssetVisibility { tenant_id, .. } => tenant_id,
        }
    }

    const fn model(&self) -> Option<&str> {
        match self {
            Self::Embeddings { model, .. } | Self::Chat { model, .. } => Some(model),
            Self::AssetContent { .. } | Self::AssetVisibility { .. } => None,
        }
    }

    const fn asset_id(&self) -> Option<&str> {
        match self {
            Self::AssetContent { asset_id, .. } | Self::AssetVisibility { asset_id, .. } => {
                Some(asset_id)
            }
            Self::Embeddings { .. } | Self::Chat { .. } => None,
        }
    }

    /// 审批凭据：只有写受众带得出来。
    fn approval(&self) -> Option<ApprovalGrant> {
        match self {
            Self::AssetVisibility {
                approval_id,
                actor_id,
                visibility,
                viewers,
                ..
            } => Some(ApprovalGrant {
                approval_id: (*approval_id).to_string(),
                actor_id: (*actor_id).to_string(),
                visibility: (*visibility).to_string(),
                viewers: viewers.to_vec(),
            }),
            _ => None,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ServiceTokenError {
    #[error("服务身份令牌无效或已过期")]
    Invalid,
    #[error("服务身份令牌签名失败: {0}")]
    Encode(String),
}

/// 一次**已批准**的写：只有可见性写入受众的载荷里才有这一段。
///
/// 它把审批台账里的三件事（哪张单子、谁批的、批成什么样）搬进签名载荷。于是端点不必再读
/// 请求体：请求里只剩「打哪个资产」，而那是令牌里本来就钉死了的。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalGrant {
    /// 审批标识（编排生成的 `<taskID>:<步骤>:<第几次调用>`）。
    #[serde(rename = "approvalID")]
    pub approval_id: String,
    /// 批准人：写以他的身份落地（资产行级策略只认创建者，故批准人必须是创建者）。
    #[serde(rename = "actorID")]
    pub actor_id: String,
    /// 人批过的可见性字面量。
    pub visibility: String,
    /// 人批过的可见对象：只有 `RESTRICTED` 有值。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub viewers: Vec<String>,
}

/// 令牌载荷。字段名与对外 JSON 口径一致（`tenantID` / `assetID`），故显式 rename。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceClaims {
    /// 主体：受信服务进程名（当前只有 `compute`）。
    pub sub: String,
    /// 受众：换出来的令牌只能用于这一个端点。
    pub aud: String,
    /// 作用域租户。
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    /// 作用域模型：仅嵌入受众有值，出站时以它为准，请求体里换不了。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// 作用域资产：仅资产内容受众有值，读不了别的资产。
    #[serde(default, rename = "assetID", skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    /// 已批准的写：仅可见性写入受众有值。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval: Option<ApprovalGrant>,
    /// 过期时间（Unix 秒）。
    pub exp: i64,
    /// 签发时间（Unix 秒）。
    pub iat: i64,
}

/// 签发一枚服务身份令牌，返回 `(token, expiresAt 秒)`。
///
/// 受众由作用域决定，两者不可能对不上——这是签发侧唯一需要保证的不变量。
/// `ttl_secs` 由调用方（配置访问器）收敛过上限，这里只兜底「至少 1 秒」。
pub fn mint(
    secret: &str,
    scope: Scope<'_>,
    ttl_secs: u64,
) -> Result<(String, i64), ServiceTokenError> {
    let now = Utc::now().timestamp();
    let exp = now + ttl_secs.max(1) as i64;
    let claims = ServiceClaims {
        sub: SUBJECT.to_string(),
        aud: scope.audience().as_str().to_string(),
        tenant_id: scope.tenant_id().to_string(),
        model: scope.model().map(str::to_string),
        asset_id: scope.asset_id().map(str::to_string),
        approval: scope.approval(),
        exp,
        iat: now,
    };

    let token = encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|err| ServiceTokenError::Encode(err.to_string()))?;

    Ok((token, exp))
}

/// 验签并校验受众/主体/有效期，成功返回载荷。
///
/// 校验清单是刻意收紧的：默认的 `Validation` 不查 `aud`，若只验签名，别的用途的
/// HS256 令牌（只要密钥被误配成同一个）也能直接当服务令牌用。受众由端点写死传入，
/// 调用方无法「按请求体决定信任谁」。
pub fn verify(
    secret: &str,
    token: &str,
    audience: Audience,
) -> Result<ServiceClaims, ServiceTokenError> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_audience(&[audience.as_str()]);
    validation.set_required_spec_claims(&["exp", "aud", "sub"]);
    // 签发与验签都在本进程内完成，不存在跨进程时钟偏移，默认的 60 秒宽限窗口没有依据
    validation.leeway = 0;

    let claims = decode::<ServiceClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map_err(|_| ServiceTokenError::Invalid)?
    .claims;

    // `set_required_spec_claims` 只保证字段存在，主体与「本受众必填的作用域」由我们独占认定：
    // 受众对了但作用域缺失的令牌（例如手工改过载荷再用合法密钥重签），在这里被拦下。
    if claims.sub != SUBJECT {
        return Err(ServiceTokenError::Invalid);
    }
    let scope_present = match audience {
        Audience::Embeddings | Audience::Chat => {
            claims.model.as_ref().is_some_and(|m| !m.trim().is_empty())
        }
        Audience::AssetContent => claims
            .asset_id
            .as_ref()
            .is_some_and(|a| !a.trim().is_empty()),
        // 写比读多一层：资产对了还不够，载荷里必须有一份「哪张单子、谁批的、批成什么样」
        // 齐全的凭据——否则「受众对了但没说是哪次审批」就成了一枚无名写权限。
        Audience::AssetVisibility => {
            claims
                .asset_id
                .as_ref()
                .is_some_and(|a| !a.trim().is_empty())
                && claims.approval.as_ref().is_some_and(|grant| {
                    !grant.approval_id.trim().is_empty()
                        && !grant.actor_id.trim().is_empty()
                        && !grant.visibility.trim().is_empty()
                })
        }
    };
    if !scope_present {
        return Err(ServiceTokenError::Invalid);
    }

    Ok(claims)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "unit-test-service-token-secret";

    fn embeddings<'a>(tenant_id: &'a str, model: &'a str) -> Scope<'a> {
        Scope::Embeddings { tenant_id, model }
    }

    fn asset<'a>(tenant_id: &'a str, asset_id: &'a str) -> Scope<'a> {
        Scope::AssetContent {
            tenant_id,
            asset_id,
        }
    }

    fn chat<'a>(tenant_id: &'a str, model: &'a str) -> Scope<'a> {
        Scope::Chat { tenant_id, model }
    }

    fn asset_write<'a>(
        tenant_id: &'a str,
        asset_id: &'a str,
        approval_id: &'a str,
        actor_id: &'a str,
        visibility: &'a str,
        viewers: &'a [String],
    ) -> Scope<'a> {
        Scope::AssetVisibility {
            tenant_id,
            asset_id,
            approval_id,
            actor_id,
            visibility,
            viewers,
        }
    }

    /// 一枚形状齐全的写令牌作用域，各条「不许」只改其中一处。
    fn granted<'a>(viewers: &'a [String]) -> Scope<'a> {
        asset_write(
            "tenant-1",
            "asset-1",
            "task-1:0:0",
            "11111111-1111-1111-1111-111111111111",
            "RESTRICTED",
            viewers,
        )
    }

    #[test]
    fn scope_maps_to_audience_and_back() {
        for audience in [
            Audience::Embeddings,
            Audience::AssetContent,
            Audience::Chat,
            Audience::AssetVisibility,
        ] {
            assert_eq!(Audience::from_scope(audience.scope()), Some(audience));
        }
        // 未知作用域不能被当成缺省值悄悄放行
        assert_eq!(Audience::from_scope("asset-content"), None);
        assert_eq!(Audience::from_scope("asset-delete"), None);
        assert_eq!(Audience::from_scope(""), None);
    }

    #[test]
    fn mint_chat_scope_carries_model_and_no_asset() {
        let (token, _) = mint(SECRET, chat("tenant-1", "gpt-4o"), 300).unwrap();
        let claims = verify(SECRET, &token, Audience::Chat).unwrap();

        assert_eq!(claims.aud, AUDIENCE_CHAT);
        assert_eq!(claims.model.as_deref(), Some("gpt-4o"));
        assert_eq!(claims.asset_id, None);
        assert_eq!(claims.tenant_id, "tenant-1");
    }

    #[test]
    fn mint_then_verify_roundtrip() {
        let (token, exp) = mint(
            SECRET,
            embeddings("tenant-1", "text-embedding-3-small"),
            300,
        )
        .unwrap();
        let claims = verify(SECRET, &token, Audience::Embeddings).expect("刚签出来的令牌应当可用");

        assert_eq!(claims.tenant_id, "tenant-1");
        assert_eq!(claims.model.as_deref(), Some("text-embedding-3-small"));
        assert_eq!(claims.asset_id, None);
        assert_eq!(claims.sub, SUBJECT);
        assert_eq!(claims.aud, AUDIENCE_EMBEDDINGS);
        assert_eq!(claims.exp, exp);
        assert!(claims.iat <= exp);
    }

    #[test]
    fn mint_asset_scope_carries_asset_and_no_model() {
        let (token, _) = mint(SECRET, asset("tenant-1", "asset-1"), 300).unwrap();
        let claims = verify(SECRET, &token, Audience::AssetContent).unwrap();

        assert_eq!(claims.asset_id.as_deref(), Some("asset-1"));
        assert_eq!(claims.tenant_id, "tenant-1");
        assert_eq!(claims.model, None);
        assert_eq!(claims.aud, AUDIENCE_ASSET_CONTENT);
        assert!(claims.approval.is_none(), "读令牌不该带审批凭据");
    }

    /// 写令牌的形状：受众 + 资产 + 「哪张单子、谁批的、批成什么样」三样一起才有意义。
    #[test]
    fn mint_asset_write_scope_carries_approval_grant() {
        let viewers = vec!["22222222-2222-2222-2222-222222222222".to_string()];
        let (token, _) = mint(SECRET, granted(&viewers), 300).unwrap();
        let claims = verify(SECRET, &token, Audience::AssetVisibility).unwrap();

        assert_eq!(claims.aud, AUDIENCE_ASSET_VISIBILITY);
        assert_eq!(claims.tenant_id, "tenant-1");
        assert_eq!(claims.asset_id.as_deref(), Some("asset-1"));
        assert_eq!(claims.model, None);

        let grant = claims.approval.expect("写令牌必须带审批凭据");
        assert_eq!(grant.approval_id, "task-1:0:0");
        assert_eq!(grant.actor_id, "11111111-1111-1111-1111-111111111111");
        assert_eq!(grant.visibility, "RESTRICTED");
        assert_eq!(grant.viewers, viewers);
    }

    /// 批准里的可见性字面量原样进载荷：这里不做解析，认不认得出由签发侧负责。
    #[test]
    fn mint_asset_write_scope_keeps_visibility_literal() {
        let (token, _) = mint(
            SECRET,
            asset_write("tenant-1", "asset-1", "t", "u", "PUBLIC", &[]),
            300,
        )
        .unwrap();
        let claims = verify(SECRET, &token, Audience::AssetVisibility).unwrap();

        let grant = claims.approval.unwrap();
        assert_eq!(grant.visibility, "PUBLIC");
        assert!(grant.viewers.is_empty());
    }

    #[test]
    fn ttl_is_at_least_one_second() {
        let (_, exp) = mint(SECRET, embeddings("tenant-1", "m"), 0).unwrap();
        let (_, iat_ref) = mint(SECRET, embeddings("tenant-1", "m"), 1).unwrap();

        assert!(exp > iat_ref - 5, "过期时间应当是未来时刻");
    }

    #[test]
    fn verify_rejects_other_secret() {
        let (token, _) = mint(SECRET, embeddings("tenant-1", "m"), 300).unwrap();
        assert!(
            verify(
                "another-secret-at-least-32-chars-long",
                &token,
                Audience::Embeddings
            )
            .is_err()
        );
    }

    #[test]
    fn verify_rejects_tampered_payload() {
        let (token, _) = mint(SECRET, embeddings("tenant-1", "m"), 300).unwrap();
        let mut parts: Vec<String> = token.split('.').map(str::to_string).collect();
        // 改一字节载荷：签名立刻对不上，作用域无法被调用方扩大
        parts[1] = format!("{}A", parts[1]);
        let tampered = parts.join(".");

        assert!(verify(SECRET, &tampered, Audience::Embeddings).is_err());
    }

    #[test]
    fn verify_rejects_expired_token() {
        let token = encode(
            &Header::new(Algorithm::HS256),
            &ServiceClaims {
                sub: SUBJECT.to_string(),
                aud: AUDIENCE_EMBEDDINGS.to_string(),
                tenant_id: "tenant-1".to_string(),
                model: Some("m".to_string()),
                asset_id: None,
                approval: None,
                exp: Utc::now().timestamp() - 60,
                iat: Utc::now().timestamp() - 120,
            },
            &EncodingKey::from_secret(SECRET.as_bytes()),
        )
        .unwrap();

        assert!(verify(SECRET, &token, Audience::Embeddings).is_err());
    }

    #[test]
    fn verify_rejects_wrong_audience() {
        let token = encode(
            &Header::new(Algorithm::HS256),
            &ServiceClaims {
                sub: SUBJECT.to_string(),
                aud: "core.something.else".to_string(),
                tenant_id: "tenant-1".to_string(),
                model: Some("m".to_string()),
                asset_id: None,
                approval: None,
                exp: Utc::now().timestamp() + 300,
                iat: Utc::now().timestamp(),
            },
            &EncodingKey::from_secret(SECRET.as_bytes()),
        )
        .unwrap();

        assert!(verify(SECRET, &token, Audience::Embeddings).is_err());
    }

    /// 受众串了：嵌入令牌拿到内容端点上必须被拒——这是「一件事一个受众」的全部意义。
    #[test]
    fn verify_rejects_token_minted_for_other_endpoint() {
        let (embeddings_token, _) = mint(SECRET, embeddings("tenant-1", "m"), 300).unwrap();
        assert!(verify(SECRET, &embeddings_token, Audience::AssetContent).is_err());

        let (asset_token, _) = mint(SECRET, asset("tenant-1", "asset-1"), 300).unwrap();
        assert!(verify(SECRET, &asset_token, Audience::Embeddings).is_err());

        // 嵌入与聊天都是「租户 + 模型」，载荷形状一模一样：只有受众能把它们分开，
        // 所以嵌入令牌打聊天端点、聊天令牌打嵌入端点都必须被拒。
        let (chat_token, _) = mint(SECRET, chat("tenant-1", "m"), 300).unwrap();
        assert!(verify(SECRET, &embeddings_token, Audience::Chat).is_err());
        assert!(verify(SECRET, &chat_token, Audience::Embeddings).is_err());

        // 写令牌是更强的东西，越权方向更要紧：读令牌打写端点、写令牌打读端点都得被拒。
        let (write_token, _) = mint(SECRET, granted(&[]), 300).unwrap();
        assert!(verify(SECRET, &asset_token, Audience::AssetVisibility).is_err());
        assert!(verify(SECRET, &write_token, Audience::AssetContent).is_err());
        assert!(verify(SECRET, &write_token, Audience::Chat).is_err());
    }

    /// 写受众 + 资产，却没有审批凭据（例如拿合法密钥重签一枚空壳载荷）：不能退化成无名写权限。
    #[test]
    fn verify_rejects_write_token_without_approval_grant() {
        let now = Utc::now().timestamp();
        let token = encode(
            &Header::new(Algorithm::HS256),
            &ServiceClaims {
                sub: SUBJECT.to_string(),
                aud: AUDIENCE_ASSET_VISIBILITY.to_string(),
                tenant_id: "tenant-1".to_string(),
                model: None,
                asset_id: Some("asset-1".to_string()),
                approval: None,
                exp: now + 300,
                iat: now,
            },
            &EncodingKey::from_secret(SECRET.as_bytes()),
        )
        .unwrap();

        assert!(verify(SECRET, &token, Audience::AssetVisibility).is_err());
    }

    /// 凭据缺一块就不认：哪张单子、谁批的、批成什么样，少一样都不是一次完整的批准。
    #[test]
    fn verify_rejects_incomplete_approval_grant() {
        let now = Utc::now().timestamp();
        let complete = ApprovalGrant {
            approval_id: "task-1:0:0".to_string(),
            actor_id: "11111111-1111-1111-1111-111111111111".to_string(),
            visibility: "PRIVATE".to_string(),
            viewers: Vec::new(),
        };

        for broken in [
            ApprovalGrant {
                approval_id: "  ".to_string(),
                ..complete.clone()
            },
            ApprovalGrant {
                actor_id: String::new(),
                ..complete.clone()
            },
            ApprovalGrant {
                visibility: " ".to_string(),
                ..complete.clone()
            },
        ] {
            let token = encode(
                &Header::new(Algorithm::HS256),
                &ServiceClaims {
                    sub: SUBJECT.to_string(),
                    aud: AUDIENCE_ASSET_VISIBILITY.to_string(),
                    tenant_id: "tenant-1".to_string(),
                    model: None,
                    asset_id: Some("asset-1".to_string()),
                    approval: Some(broken),
                    exp: now + 300,
                    iat: now,
                },
                &EncodingKey::from_secret(SECRET.as_bytes()),
            )
            .unwrap();

            assert!(verify(SECRET, &token, Audience::AssetVisibility).is_err());
        }

        // 资产缺失同样不认：写令牌必须落在某一个资产上
        let token = encode(
            &Header::new(Algorithm::HS256),
            &ServiceClaims {
                sub: SUBJECT.to_string(),
                aud: AUDIENCE_ASSET_VISIBILITY.to_string(),
                tenant_id: "tenant-1".to_string(),
                model: None,
                asset_id: None,
                approval: Some(complete),
                exp: now + 300,
                iat: now,
            },
            &EncodingKey::from_secret(SECRET.as_bytes()),
        )
        .unwrap();

        assert!(verify(SECRET, &token, Audience::AssetVisibility).is_err());
    }

    #[test]
    fn verify_rejects_wrong_subject() {
        let token = encode(
            &Header::new(Algorithm::HS256),
            &ServiceClaims {
                sub: "some-other-service".to_string(),
                aud: AUDIENCE_EMBEDDINGS.to_string(),
                tenant_id: "tenant-1".to_string(),
                model: Some("m".to_string()),
                asset_id: None,
                approval: None,
                exp: Utc::now().timestamp() + 300,
                iat: Utc::now().timestamp(),
            },
            &EncodingKey::from_secret(SECRET.as_bytes()),
        )
        .unwrap();

        assert!(verify(SECRET, &token, Audience::Embeddings).is_err());
    }

    /// 受众对了但作用域缺失（例如拿着合法密钥重签一枚空壳载荷）：不能退化成「匿名服务」。
    #[test]
    fn verify_rejects_missing_scope_claim() {
        let now = Utc::now().timestamp();
        let missing_model = encode(
            &Header::new(Algorithm::HS256),
            &ServiceClaims {
                sub: SUBJECT.to_string(),
                aud: AUDIENCE_EMBEDDINGS.to_string(),
                tenant_id: "tenant-1".to_string(),
                model: None,
                asset_id: None,
                approval: None,
                exp: now + 300,
                iat: now,
            },
            &EncodingKey::from_secret(SECRET.as_bytes()),
        )
        .unwrap();
        assert!(verify(SECRET, &missing_model, Audience::Embeddings).is_err());
        // 聊天的作用域字段与嵌入同形，缺失一样必须被拒
        assert!(verify(SECRET, &missing_model, Audience::Chat).is_err());

        let missing_asset = encode(
            &Header::new(Algorithm::HS256),
            &ServiceClaims {
                sub: SUBJECT.to_string(),
                aud: AUDIENCE_ASSET_CONTENT.to_string(),
                tenant_id: "tenant-1".to_string(),
                model: None,
                asset_id: None,
                approval: None,
                exp: now + 300,
                iat: now,
            },
            &EncodingKey::from_secret(SECRET.as_bytes()),
        )
        .unwrap();
        assert!(verify(SECRET, &missing_asset, Audience::AssetContent).is_err());
    }

    #[test]
    fn verify_rejects_blank_scope_claim() {
        let now = Utc::now().timestamp();
        let blank_model = encode(
            &Header::new(Algorithm::HS256),
            &ServiceClaims {
                sub: SUBJECT.to_string(),
                aud: AUDIENCE_EMBEDDINGS.to_string(),
                tenant_id: "tenant-1".to_string(),
                model: Some("  ".to_string()),
                asset_id: None,
                approval: None,
                exp: now + 300,
                iat: now,
            },
            &EncodingKey::from_secret(SECRET.as_bytes()),
        )
        .unwrap();
        assert!(verify(SECRET, &blank_model, Audience::Embeddings).is_err());
        assert!(verify(SECRET, &blank_model, Audience::Chat).is_err());

        let blank_asset = encode(
            &Header::new(Algorithm::HS256),
            &ServiceClaims {
                sub: SUBJECT.to_string(),
                aud: AUDIENCE_ASSET_CONTENT.to_string(),
                tenant_id: "tenant-1".to_string(),
                model: None,
                asset_id: Some(" ".to_string()),
                approval: None,
                exp: now + 300,
                iat: now,
            },
            &EncodingKey::from_secret(SECRET.as_bytes()),
        )
        .unwrap();
        assert!(verify(SECRET, &blank_asset, Audience::AssetContent).is_err());
    }
}
