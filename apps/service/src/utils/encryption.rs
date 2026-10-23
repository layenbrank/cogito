use aes_gcm::{
    Aes256Gcm, Key, Nonce,
    aead::{Aead, Generate, KeyInit},
};
use argon2::password_hash::{SaltString, rand_core::OsRng};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use base64::{Engine, engine::general_purpose::STANDARD};

use crate::configures::configure::Encryption;
use configures::runtime;

#[derive(Debug, thiserror::Error)]
pub enum EncryptionError {
    #[error("AES encryption error: {0}")]
    AesError(String),
    #[error("Argon2 error: {0}")]
    Argon2Error(String),
    #[error("Base64 decode error: {0}")]
    Base64Error(String),
    #[error("Invalid key length")]
    InvalidKeyLength,
}

/// 密码哈希 / 校验。
///
/// - **推荐**：`Encryption::Argon2`（单向哈希）
/// - `Encryption::Aes`：兼容遗留配置，内部走可逆 [`encrypt_field`]；**不应用于新密码存储**
pub fn encrypt_password(
    password: &str,
    method: &Encryption,
    aes_key: Option<&str>,
) -> Result<String, EncryptionError> {
    match method {
        Encryption::Aes => {
            if runtime::is_production() {
                return Err(EncryptionError::AesError(
                    "ENCRYPTION=aes is forbidden in production; use argon2".into(),
                ));
            }
            tracing::warn!(
                "ENCRYPTION=aes stores reversible password ciphertext; prefer argon2 for new deployments"
            );
            encrypt_field(password, aes_key.ok_or(EncryptionError::InvalidKeyLength)?)
        }
        Encryption::Argon2 => hash_password(password),
    }
}

/// 验证密码
pub fn verify_password(
    password: &str,
    encrypted: &str,
    method: &Encryption,
    aes_key: Option<&str>,
) -> Result<bool, EncryptionError> {
    match method {
        Encryption::Aes => verify_field(
            password,
            encrypted,
            aes_key.ok_or(EncryptionError::InvalidKeyLength)?,
        ),
        Encryption::Argon2 => verify_password_hash(password, encrypted),
    }
}

/// 可逆字段加密（AES-256-GCM）。用于敏感字段，**禁止**当作密码哈希。
pub fn encrypt_field(plaintext: &str, key_str: &str) -> Result<String, EncryptionError> {
    let key_bytes = STANDARD
        .decode(key_str)
        .map_err(|e| EncryptionError::Base64Error(e.to_string()))?;

    if key_bytes.len() != 32 {
        return Err(EncryptionError::InvalidKeyLength);
    }

    let key_array: [u8; 32] = key_bytes
        .try_into()
        .map_err(|_| EncryptionError::InvalidKeyLength)?;
    let key: &Key<Aes256Gcm> = (&key_array).into();
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::generate();

    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| EncryptionError::AesError(e.to_string()))?;

    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&ciphertext);
    Ok(STANDARD.encode(&combined))
}

/// 解密 AES-256-GCM 密文，返回明文（用于运行时读取集中加密的密钥）。
pub fn decrypt_field(encrypted: &str, key_str: &str) -> Result<String, EncryptionError> {
    let key_bytes = STANDARD
        .decode(key_str)
        .map_err(|e| EncryptionError::Base64Error(e.to_string()))?;

    if key_bytes.len() != 32 {
        return Err(EncryptionError::InvalidKeyLength);
    }

    let key_array: [u8; 32] = key_bytes
        .try_into()
        .map_err(|_| EncryptionError::InvalidKeyLength)?;
    let key: &Key<Aes256Gcm> = (&key_array).into();
    let cipher = Aes256Gcm::new(key);

    let combined = STANDARD
        .decode(encrypted)
        .map_err(|e| EncryptionError::Base64Error(e.to_string()))?;

    if combined.len() < 12 {
        return Err(EncryptionError::AesError(
            "Invalid ciphertext length".to_string(),
        ));
    }

    let nonce_bytes: [u8; 12] = combined[..12]
        .try_into()
        .map_err(|_| EncryptionError::AesError("Invalid nonce length".to_string()))?;
    let nonce = Nonce::from(nonce_bytes);
    let ciphertext = &combined[12..];

    let decrypted = cipher
        .decrypt(&nonce, ciphertext)
        .map_err(|_| EncryptionError::AesError("Decryption failed".to_string()))?;

    String::from_utf8(decrypted).map_err(|e| EncryptionError::AesError(e.to_string()))
}

/// 校验明文是否等于 AES 密文解密结果。
pub fn verify_field(
    plaintext: &str,
    encrypted: &str,
    key_str: &str,
) -> Result<bool, EncryptionError> {
    let key_bytes = STANDARD
        .decode(key_str)
        .map_err(|e| EncryptionError::Base64Error(e.to_string()))?;

    if key_bytes.len() != 32 {
        return Err(EncryptionError::InvalidKeyLength);
    }

    let key_array: [u8; 32] = key_bytes
        .try_into()
        .map_err(|_| EncryptionError::InvalidKeyLength)?;
    let key: &Key<Aes256Gcm> = (&key_array).into();
    let cipher = Aes256Gcm::new(key);

    let combined = STANDARD
        .decode(encrypted)
        .map_err(|e| EncryptionError::Base64Error(e.to_string()))?;

    if combined.len() < 12 {
        return Ok(false);
    }

    let nonce_bytes: [u8; 12] = combined[..12]
        .try_into()
        .map_err(|_| EncryptionError::AesError("Invalid nonce length".to_string()))?;
    let nonce = Nonce::from(nonce_bytes);
    let ciphertext = &combined[12..];

    let decrypted = cipher
        .decrypt(&nonce, ciphertext)
        .map_err(|_| EncryptionError::AesError("Decryption failed".to_string()))?;

    Ok(decrypted == plaintext.as_bytes())
}

fn hash_password(password: &str) -> Result<String, EncryptionError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| EncryptionError::Argon2Error(e.to_string()))?;
    Ok(password_hash.to_string())
}

fn verify_password_hash(password: &str, hashed: &str) -> Result<bool, EncryptionError> {
    let parsed_hash =
        PasswordHash::new(hashed).map_err(|e| EncryptionError::Argon2Error(e.to_string()))?;
    let argon2 = Argon2::default();
    match argon2.verify_password(password.as_bytes(), &parsed_hash) {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{Engine, engine::general_purpose::STANDARD};

    #[test]
    fn test_argon2_encryption() {
        let password = "test_password_123";
        let encrypted = hash_password(password).unwrap();
        assert_ne!(encrypted, password);
        assert!(verify_password_hash(password, &encrypted).unwrap());
        assert!(!verify_password_hash("wrong_password", &encrypted).unwrap());
    }

    #[test]
    fn test_aes_field_encryption() {
        let key_bytes: [u8; 32] = [0u8; 32];
        let key_str = STANDARD.encode(key_bytes);
        let password = "test_password_123";
        let encrypted = encrypt_field(password, &key_str).unwrap();
        assert_ne!(encrypted, password);
        assert!(verify_field(password, &encrypted, &key_str).unwrap());
        assert!(!verify_field("wrong_password", &encrypted, &key_str).unwrap());
    }

    #[test]
    fn test_aes_field_roundtrip() {
        let key_bytes: [u8; 32] = [7u8; 32];
        let key_str = STANDARD.encode(key_bytes);
        let secret = "sk-1234567890";
        let encrypted = encrypt_field(secret, &key_str).unwrap();
        let decrypted = decrypt_field(&encrypted, &key_str).unwrap();
        assert_eq!(decrypted, secret);
    }

    #[test]
    fn aes_password_forbidden_in_production() {
        runtime::init(true);
        let err = encrypt_password("x", &Encryption::Aes, Some("ignored")).unwrap_err();
        assert!(matches!(err, EncryptionError::AesError(_)));
        runtime::init(false);
    }
}
