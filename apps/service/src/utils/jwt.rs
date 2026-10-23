use chrono::{Duration, Utc};
use identity::{PlatformRole, UnknownRole};
use jsonwebtoken::{
    DecodingKey, EncodingKey, Header, Validation, decode, encode, errors::ErrorKind,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub username: String,
    /// 签发时的平台角色字面量（USER / ADMIN），仅作提示；
    /// 授权结论一律以库为准（见 `guards::session`），这里不提供任何回退默认值的入口。
    #[serde(default)]
    pub role: String,
    pub exp: i64,
    pub iat: i64,
}

impl Claims {
    /// 声明中的平台角色；字面量无法识别即报错。
    pub fn platform_role(&self) -> Result<PlatformRole, UnknownRole> {
        self.role.parse()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum JwtError {
    #[error("JWT encoding error: {0}")]
    EncodingError(String),
    #[error("JWT decoding error: {0}")]
    DecodingError(String),
    #[error("Invalid token")]
    InvalidToken,
}

/// 生成 JWT token
pub fn generate_token(
    user_id: &str,
    username: &str,
    role: PlatformRole,
    secret: &str,
    expiration_hours: Option<u64>,
) -> Result<String, JwtError> {
    let now = Utc::now();
    let exp = now + Duration::hours(expiration_hours.unwrap_or(24) as i64);

    let claims = Claims {
        sub: user_id.to_string(),
        username: username.to_string(),
        role: role.as_str().to_string(),
        exp: exp.timestamp(),
        iat: now.timestamp(),
    };

    let header = Header::default();
    let encoding_key = EncodingKey::from_secret(secret.as_ref());

    encode(&header, &claims, &encoding_key).map_err(|e| JwtError::EncodingError(e.to_string()))
}

/// 验证 JWT token；过期映射为 [`JwtError::InvalidToken`]。
pub fn verify_token(token: &str, secret: &str) -> Result<Claims, JwtError> {
    let decoding_key = DecodingKey::from_secret(secret.as_ref());
    let validation = Validation::default();

    let token_data =
        decode::<Claims>(token, &decoding_key, &validation).map_err(|e| match e.kind() {
            ErrorKind::ExpiredSignature => JwtError::InvalidToken,
            _ => JwtError::DecodingError(e.to_string()),
        })?;

    Ok(token_data.claims)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_and_verify_token() {
        let secret = "test-secret-key-at-least-32-characters-long";
        let user_id = "123456";
        let username = "testuser";

        let token =
            generate_token(user_id, username, PlatformRole::Admin, secret, Some(1)).unwrap();
        assert!(!token.is_empty());

        let claims = verify_token(&token, secret).unwrap();
        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.username, username);
        assert!(claims.platform_role().unwrap().is_platform_admin());
    }

    #[test]
    fn test_invalid_token() {
        let secret = "test-secret-key-at-least-32-characters-long";
        let invalid_token = "invalid.token.here";

        let result = verify_token(invalid_token, secret);
        assert!(matches!(result, Err(JwtError::DecodingError(_))));
    }

    #[test]
    fn expired_token_maps_to_invalid_token() {
        let secret = "test-secret-key-at-least-32-characters-long";
        let now = Utc::now();
        let claims = Claims {
            sub: "u1".into(),
            username: "alice".into(),
            role: "USER".into(),
            exp: (now - Duration::hours(1)).timestamp(),
            iat: (now - Duration::hours(2)).timestamp(),
        };
        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(secret.as_ref()),
        )
        .unwrap();

        assert!(matches!(
            verify_token(&token, secret),
            Err(JwtError::InvalidToken)
        ));
    }

    #[test]
    fn missing_role_is_rejected_instead_of_defaulting() {
        let secret = "test-secret-key-at-least-32-characters-long";
        let now = Utc::now();
        #[derive(Serialize)]
        struct Legacy {
            sub: String,
            username: String,
            exp: i64,
            iat: i64,
        }
        let token = encode(
            &Header::default(),
            &Legacy {
                sub: "u1".into(),
                username: "a".into(),
                exp: (now + Duration::hours(1)).timestamp(),
                iat: now.timestamp(),
            },
            &EncodingKey::from_secret(secret.as_ref()),
        )
        .unwrap();
        let claims = verify_token(&token, secret).unwrap();

        // 老令牌没有 role：不猜测，交给调用方按「无效凭证」处理。
        assert!(claims.platform_role().is_err());
    }

    #[test]
    fn unknown_role_literal_is_rejected() {
        let secret = "test-secret-key-at-least-32-characters-long";
        let now = Utc::now();
        let claims = Claims {
            sub: "u1".into(),
            username: "alice".into(),
            role: "SUPERUSER".into(),
            exp: (now + Duration::hours(1)).timestamp(),
            iat: now.timestamp(),
        };
        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(secret.as_ref()),
        )
        .unwrap();
        let claims = verify_token(&token, secret).unwrap();

        assert_eq!(claims.platform_role().unwrap_err().as_str(), "SUPERUSER");
    }
}
