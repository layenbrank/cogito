use chrono::Utc;
use entity::{auth, sso_connection, tenant_member};
use fred::interfaces::KeysInterface;
use fred::prelude::*;
use identity::{AccountStatus, PlatformRole, TenantId, TenantRole};
use reqwest::Client;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseTransaction, EntityTrait, PaginatorTrait, QueryFilter,
    Set,
};
use serde::Deserialize;
use serde_json::Value;
use url::Url;
use uuid::Uuid;

use crate::clients::redis::RedisPool;
use crate::configures::configure::Configure;
use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::platform::PlatformScope;
use crate::guards::sso::{SsoConnectionScope, SsoLoginScope};
use crate::services::sso::schema::{
    SsoConnectionR, SsoConnectionUpdateP, SsoConnectionWriteP, SsoLoginR,
};
use crate::utils::code::{auth as auth_codes, external, request, resource, system};
use crate::utils::encryption::{EncryptionError, decrypt_field, encrypt_field, encrypt_password};
use crate::utils::jwt::generate_token;

#[derive(Debug, thiserror::Error)]
pub enum SsoError {
    #[error("Connection not found")]
    NotFound,
    #[error("Invalid parameter: {0}")]
    BadParam(String),
    #[error("Invalid state")]
    InvalidState,
    #[error("Identity provider error: {0}")]
    Idp(String),
    #[error(transparent)]
    Decryption(#[from] EncryptionError),
    #[error(transparent)]
    Jwt(#[from] jsonwebtoken::errors::Error),
    #[error(transparent)]
    Token(#[from] crate::utils::jwt::JwtError),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Url(#[from] url::ParseError),
    #[error("Database error: {0}")]
    Db(String),
    #[error("Cache error: {0}")]
    Cache(String),
}

impl From<SsoError> for Exception {
    fn from(err: SsoError) -> Self {
        match err {
            SsoError::NotFound => Exception::custom(resource::NOT_FOUND, "SSO 连接不存在"),
            SsoError::BadParam(msg) => Exception::custom(request::INVALID_PARAMETER_VALUE, msg),
            SsoError::InvalidState => Exception::custom(auth_codes::ACCESS_DENIED, "登录状态无效"),
            SsoError::Idp(msg) => {
                tracing::warn!(error = %msg, "sso idp error");
                Exception::custom(external::THIRD_PARTY_API_ERROR, "身份提供商异常")
            }
            SsoError::Decryption(_) => Exception::custom(system::INTERNAL_ERROR, "密钥服务异常"),
            SsoError::Jwt(_) => Exception::custom(auth_codes::ACCESS_DENIED, "身份令牌校验失败"),
            SsoError::Token(_) => Exception::custom(system::INTERNAL_ERROR, "令牌服务异常"),
            SsoError::Http(_) => {
                Exception::custom(external::THIRD_PARTY_API_ERROR, "身份提供商异常")
            }
            SsoError::Url(_) => Exception::custom(system::INTERNAL_ERROR, "授权地址异常"),
            SsoError::Db(msg) => {
                tracing::error!(error = %msg, "sso database error");
                Exception::custom(external::DATABASE_ERROR, "数据库错误")
            }
            SsoError::Cache(msg) => {
                tracing::error!(error = %msg, "sso cache error");
                Exception::custom(external::CACHE_ERROR, "缓存错误")
            }
        }
    }
}

#[derive(Debug, Deserialize)]
struct Discovery {
    authorization_endpoint: String,
    token_endpoint: String,
    #[serde(default)]
    userinfo_endpoint: Option<String>,
    jwks_uri: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    id_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UserInfo {
    sub: String,
    #[serde(default)]
    email: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IdClaims {
    iss: String,
    sub: String,
    exp: i64,
    #[serde(default)]
    nonce: Option<String>,
}

const STATE_TTL_SECS: i64 = 300;

pub struct SsoService;

impl SsoService {
    // ---- 后台连接 CRUD ----
    //
    // 管理面是**平台运维面**：连接列表跨租户，连接本身又按租户隔离，因此四个入口
    // 一律走 [`PlatformScope`]（由 controller 在 `Auth::admin()` 之后开），
    // 领域函数只拿到已经带特权的连接。

    pub async fn list_connections(scope: &PlatformScope) -> Result<Vec<SsoConnectionR>, SsoError> {
        let rows = sso_connection::Entity::find()
            .all(scope.tx())
            .await
            .map_err(db_err)?;
        Ok(rows.into_iter().map(connection_to_r).collect())
    }

    pub async fn create_connection(
        scope: &PlatformScope,
        config: &Configure,
        actor: Uuid,
        req: SsoConnectionWriteP,
    ) -> Result<SsoConnectionR, SsoError> {
        let tenant_id = Uuid::parse_str(&req.tenant_id)
            .map_err(|_| SsoError::BadParam("tenantID 无效".to_string()))?;
        let client_secret_enc = encrypt_secret(config, req.client_secret.as_deref())?;
        let now = Utc::now().fixed_offset();
        let model = sso_connection::ActiveModel {
            id: Set(Uuid::new_v4()),
            tenant_id: Set(tenant_id),
            provider: Set(req.provider),
            issuer: Set(req.issuer.trim_end_matches('/').to_string()),
            client_id: Set(req.client_id),
            client_secret_enc: Set(client_secret_enc),
            redirect_uri: Set(req.redirect_uri),
            status: Set(parse_status(req.status.as_deref())?),
            archived_at: Set(None),
            created_at: Set(now),
            creator: Set(Some(actor)),
            updated_at: Set(now),
            updater: Set(Some(actor)),
            expires_at: Set(None),
        }
        .insert(scope.tx())
        .await
        .map_err(db_err)?;
        Ok(connection_to_r(model))
    }

    pub async fn update_connection(
        scope: &PlatformScope,
        config: &Configure,
        actor: Uuid,
        id: Uuid,
        req: SsoConnectionUpdateP,
    ) -> Result<SsoConnectionR, SsoError> {
        let model = sso_connection::Entity::find_by_id(id)
            .one(scope.tx())
            .await
            .map_err(db_err)?
            .ok_or(SsoError::NotFound)?;

        let mut active: sso_connection::ActiveModel = model.into();
        if let Some(provider) = req.provider {
            active.provider = Set(provider);
        }
        if let Some(issuer) = req.issuer {
            active.issuer = Set(issuer.trim_end_matches('/').to_string());
        }
        if let Some(client_id) = req.client_id {
            active.client_id = Set(client_id);
        }
        if let Some(secret) = req.client_secret {
            active.client_secret_enc = Set(encrypt_secret(config, Some(&secret))?);
        }
        if let Some(redirect_uri) = req.redirect_uri {
            active.redirect_uri = Set(redirect_uri);
        }
        if let Some(status) = req.status {
            active.status = Set(parse_status(Some(&status))?);
        }
        active.updated_at = Set(Utc::now().fixed_offset());
        active.updater = Set(Some(actor));

        let updated = active.update(scope.tx()).await.map_err(db_err)?;
        Ok(connection_to_r(updated))
    }

    pub async fn delete_connection(scope: &PlatformScope, id: Uuid) -> Result<(), SsoError> {
        sso_connection::Entity::delete_by_id(id)
            .exec(scope.tx())
            .await
            .map_err(db_err)?;
        Ok(())
    }

    // ---- OIDC 流程 ----
    //
    // 这两个入口是匿名的：IdP 把浏览器跳回来时没有我们的会话，唯一的凭证就是回调地址里的
    // 连接 id。因此先按连接 id 走[能力键](../../guards/sso.rs)读回那一行连接，
    // 拿到它的租户，再按租户作用域落库。中间夹着的 IdP 往返（可能几秒）绝不能跨事务。

    pub async fn authorize(db: &Storage, redis: &RedisPool, id: Uuid) -> Result<String, SsoError> {
        let conn = load_connection(db, id).await?;
        let discovery = discover(&conn.issuer).await?;

        let state = Uuid::new_v4().to_string();
        let nonce = Uuid::new_v4().to_string();
        redis
            .pool()
            .set::<(), _, _>(
                state_key(&state),
                nonce.clone(),
                Some(Expiration::EX(STATE_TTL_SECS)),
                None,
                false,
            )
            .await
            .map_err(|e| SsoError::Cache(e.to_string()))?;

        let mut url = Url::parse(&discovery.authorization_endpoint)?;
        url.query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", &conn.client_id)
            .append_pair("redirect_uri", &conn.redirect_uri)
            .append_pair("scope", "openid email profile")
            .append_pair("state", &state)
            .append_pair("nonce", &nonce);
        Ok(url.to_string())
    }

    pub async fn callback(
        db: &Storage,
        redis: &RedisPool,
        config: &Configure,
        id: Uuid,
        code: &str,
        state: &str,
    ) -> Result<SsoLoginR, SsoError> {
        let conn = load_connection(db, id).await?;

        let nonce: Option<String> = redis
            .pool()
            .get(state_key(state))
            .await
            .map_err(|e| SsoError::Cache(e.to_string()))?;
        let nonce = nonce.ok_or(SsoError::InvalidState)?;
        let _: () = redis
            .pool()
            .del(state_key(state))
            .await
            .map_err(|e| SsoError::Cache(e.to_string()))?;

        let client_secret = decrypt_field(
            &conn.client_secret_enc,
            config.aes_key().ok_or(EncryptionError::InvalidKeyLength)?,
        )?;

        let discovery = discover(&conn.issuer).await?;
        let token = exchange_code(
            &discovery.token_endpoint,
            &conn.client_id,
            &client_secret,
            &conn.redirect_uri,
            code,
        )
        .await?;

        let id_sub = if let Some(id_token) = token.id_token.as_deref() {
            let claims = validate_id_token(
                &discovery.jwks_uri,
                id_token,
                &conn.issuer,
                &conn.client_id,
                &nonce,
            )
            .await?;
            Some(claims.sub)
        } else {
            None
        };

        let (sub, email) = match discovery.userinfo_endpoint {
            Some(endpoint) => {
                let info = fetch_userinfo(&endpoint, &token.access_token).await?;
                (info.sub, info.email)
            }
            None => (
                id_sub.ok_or_else(|| SsoError::Idp("missing subject".to_string()))?,
                None,
            ),
        };

        // 网络往返都结束了，现在才开租户作用域：账号与成员关系必须一起落库
        let scope = SsoLoginScope::open(db, TenantId::from_uuid(conn.tenant_id))
            .await
            .map_err(db_err)?;

        let outcome = async {
            let user = upsert_user(scope.tx(), config, &sub, email.as_deref()).await?;
            bind_membership(scope.tx(), conn.tenant_id, user.id).await?;
            let jwt = generate_token(
                &user.id.to_string(),
                &user.username,
                PlatformRole::User,
                config.jwt_secret(),
                None,
            )?;
            Ok::<SsoLoginR, SsoError>(SsoLoginR { token: jwt })
        }
        .await;

        match outcome {
            Ok(login) => {
                scope.commit().await.map_err(db_err)?;
                Ok(login)
            }
            Err(err) => {
                scope.rollback().await.map_err(db_err)?;
                Err(err)
            }
        }
    }
}

/// 阶段一：按连接 id 走能力键读回那一行未归档连接，**读完立刻放开能力键事务**
/// （后面紧接着就要调 IdP，事务不能跨网络）。
async fn load_connection(db: &Storage, id: Uuid) -> Result<sso_connection::Model, SsoError> {
    let scope = SsoConnectionScope::open(db, id).await.map_err(db_err)?;
    let loaded = load_connection_in(scope.tx(), id).await;
    scope.close().await.map_err(db_err)?;
    loaded
}

/// 能力键事务里的那一次查询：读不到（含已归档）就是「连接不存在」。
async fn load_connection_in(
    tx: &DatabaseTransaction,
    id: Uuid,
) -> Result<sso_connection::Model, SsoError> {
    let conn = sso_connection::Entity::find_by_id(id)
        .one(tx)
        .await
        .map_err(db_err)?
        .ok_or(SsoError::NotFound)?;
    if conn.status != "ACTIVE" {
        return Err(SsoError::NotFound);
    }
    Ok(conn)
}

async fn discover(issuer: &str) -> Result<Discovery, SsoError> {
    let url = format!(
        "{}/.well-known/openid-configuration",
        issuer.trim_end_matches('/')
    );
    let client = Client::new();
    let resp = client.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(SsoError::Idp(format!(
            "discovery status {}",
            resp.status().as_u16()
        )));
    }
    resp.json::<Discovery>()
        .await
        .map_err(|e| SsoError::Idp(format!("discovery parse: {e}")))
}

async fn exchange_code(
    token_endpoint: &str,
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
    code: &str,
) -> Result<TokenResponse, SsoError> {
    let client = Client::new();
    let resp = client
        .post(token_endpoint)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("redirect_uri", redirect_uri),
        ])
        .send()
        .await?;
    let status = resp.status();
    let text = resp.text().await?;
    if !status.is_success() {
        return Err(SsoError::Idp(format!(
            "token status {status}: {}",
            &text[..text.len().min(300)]
        )));
    }
    serde_json::from_str::<TokenResponse>(&text)
        .map_err(|e| SsoError::Idp(format!("token parse: {e}")))
}

async fn fetch_userinfo(endpoint: &str, access_token: &str) -> Result<UserInfo, SsoError> {
    let client = Client::new();
    let resp = client
        .get(endpoint)
        .header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {access_token}"),
        )
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(SsoError::Idp(format!(
            "userinfo status {}",
            resp.status().as_u16()
        )));
    }
    resp.json::<UserInfo>()
        .await
        .map_err(|e| SsoError::Idp(format!("userinfo parse: {e}")))
}

async fn validate_id_token(
    jwks_uri: &str,
    id_token: &str,
    issuer: &str,
    client_id: &str,
    nonce: &str,
) -> Result<IdClaims, SsoError> {
    let header = jsonwebtoken::decode_header(id_token)?;
    let kid = header.kid.clone();

    let client = Client::new();
    let jwks: Value = client.get(jwks_uri).send().await?.json().await?;
    let keys = jwks
        .get("keys")
        .and_then(|k| k.as_array())
        .ok_or_else(|| SsoError::Idp("jwks missing keys".to_string()))?;

    let key = keys
        .iter()
        .find(|k| {
            k.get("kty").and_then(|v| v.as_str()) == Some("RSA")
                && kid
                    .as_deref()
                    .map(|kid| k.get("kid").and_then(|v| v.as_str()) == Some(kid))
                    .unwrap_or(true)
        })
        .ok_or_else(|| SsoError::Idp("jwks no matching RSA key".to_string()))?;

    let n = key
        .get("n")
        .and_then(|v| v.as_str())
        .ok_or_else(|| SsoError::Idp("jwks key missing n".to_string()))?;
    let e = key
        .get("e")
        .and_then(|v| v.as_str())
        .ok_or_else(|| SsoError::Idp("jwks key missing e".to_string()))?;

    let decoding_key = jsonwebtoken::DecodingKey::from_rsa_components(n, e)?;
    let mut validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::RS256);
    validation.set_audience(&[client_id]);
    let data = jsonwebtoken::decode::<IdClaims>(id_token, &decoding_key, &validation)?;
    let claims = data.claims;

    if claims.iss != issuer {
        return Err(SsoError::Idp("id_token issuer mismatch".to_string()));
    }
    if claims.nonce.as_deref() != Some(nonce) {
        return Err(SsoError::InvalidState);
    }
    Ok(claims)
}

async fn upsert_user(
    tx: &DatabaseTransaction,
    config: &Configure,
    sub: &str,
    email: Option<&str>,
) -> Result<auth::Model, SsoError> {
    if let Some(email) = email.filter(|e| !e.trim().is_empty()) {
        let lower = email.trim().to_ascii_lowercase();
        let existing = auth::Entity::find()
            .filter(auth::Column::Email.eq(lower.clone()))
            .one(tx)
            .await
            .map_err(db_err)?;
        if let Some(user) = existing {
            return Ok(user);
        }

        let username = lower.clone();
        let password = encrypt_password(
            &format!("sso-{}", Uuid::new_v4()),
            &config.encryption(),
            config.aes_key(),
        )?;
        let now = Utc::now().fixed_offset();
        return auth::ActiveModel {
            id: Set(Uuid::new_v4()),
            username: Set(username),
            password: Set(password),
            email: Set(Some(lower)),
            phone: Set(None),
            age: Set(None),
            gender: Set(None),
            birthday: Set(None),
            avatar: Set(None),
            role: Set(PlatformRole::User.as_str().to_string()),
            status: Set(AccountStatus::Active.as_str().to_string()),
            archived_at: Set(None),
            created_at: Set(now),
            creator: Set(None),
            updated_at: Set(now),
            updater: Set(None),
            expires_at: Set(None),
        }
        .insert(tx)
        .await
        .map_err(db_err);
    }

    // 无邮箱：用 sub 生成用户名
    let username = format!("sso_{}", sub);
    let password = encrypt_password(
        &format!("sso-{}", Uuid::new_v4()),
        &config.encryption(),
        config.aes_key(),
    )?;
    let now = Utc::now().fixed_offset();
    auth::ActiveModel {
        id: Set(Uuid::new_v4()),
        username: Set(username),
        password: Set(password),
        email: Set(None),
        phone: Set(None),
        age: Set(None),
        gender: Set(None),
        birthday: Set(None),
        avatar: Set(None),
        role: Set(PlatformRole::User.as_str().to_string()),
        status: Set(AccountStatus::Active.as_str().to_string()),
        archived_at: Set(None),
        created_at: Set(now),
        creator: Set(None),
        updated_at: Set(now),
        updater: Set(None),
        expires_at: Set(None),
    }
    .insert(tx)
    .await
    .map_err(db_err)
}

async fn bind_membership(
    tx: &DatabaseTransaction,
    tenant_id: Uuid,
    user_id: Uuid,
) -> Result<(), SsoError> {
    let existing = tenant_member::Entity::find()
        .filter(tenant_member::Column::TenantId.eq(tenant_id))
        .filter(tenant_member::Column::UserId.eq(user_id))
        .one(tx)
        .await
        .map_err(db_err)?;
    if existing.is_some() {
        return Ok(());
    }

    let count = tenant_member::Entity::find()
        .filter(tenant_member::Column::TenantId.eq(tenant_id))
        .count(tx)
        .await
        .map_err(db_err)?;
    let role = if count == 0 {
        TenantRole::Owner
    } else {
        TenantRole::Member
    };
    let now = Utc::now().fixed_offset();
    tenant_member::ActiveModel {
        id: Set(Uuid::new_v4()),
        tenant_id: Set(tenant_id),
        user_id: Set(user_id),
        role: Set(role.as_str().to_string()),
        status: Set(AccountStatus::Active.as_str().to_string()),
        archived_at: Set(None),
        created_at: Set(now),
        creator: Set(Some(user_id)),
        updated_at: Set(now),
        updater: Set(Some(user_id)),
        expires_at: Set(None),
    }
    .insert(tx)
    .await
    .map_err(db_err)?;
    Ok(())
}

fn connection_to_r(m: sso_connection::Model) -> SsoConnectionR {
    SsoConnectionR {
        id: m.id.to_string(),
        tenant_id: m.tenant_id.to_string(),
        provider: m.provider,
        issuer: m.issuer,
        client_id: m.client_id,
        redirect_uri: m.redirect_uri,
        status: m.status,
        has_client_secret: !m.client_secret_enc.is_empty(),
        created_at: m.created_at.timestamp_millis(),
        updated_at: m.updated_at.timestamp_millis(),
    }
}

fn encrypt_secret(config: &Configure, secret: Option<&str>) -> Result<String, SsoError> {
    match secret {
        Some(s) if !s.is_empty() => {
            let aes_key = config.aes_key().ok_or(EncryptionError::InvalidKeyLength)?;
            Ok(encrypt_field(s, aes_key)?)
        }
        _ => Ok(String::new()),
    }
}

fn parse_status(value: Option<&str>) -> Result<String, SsoError> {
    match value.unwrap_or("ACTIVE") {
        "ACTIVE" | "DISABLED" => Ok(value.unwrap_or("ACTIVE").to_string()),
        _ => Err(SsoError::BadParam("状态无效".to_string())),
    }
}

fn state_key(state: &str) -> String {
    format!("sso:state:{state}")
}

fn db_err(err: sea_orm::DbErr) -> SsoError {
    SsoError::Db(err.to_string())
}
