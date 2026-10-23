//! 支付渠道签名原语：RSA-SHA256 签名/验签、请求 nonce、微信回调报文解密。
//!
//! 微信支付 APIv3 与支付宝 RSA2 都用 PKCS#1 v1.5 + SHA-256，只是「拼接待签串」的
//! 规则不同（各自在渠道文件里拼接后调用这里的原语）。

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use rsa::pkcs1::{DecodeRsaPrivateKey, DecodeRsaPublicKey};
use rsa::pkcs8::{DecodePrivateKey, DecodePublicKey};
use rsa::rand_core::RngCore;
use rsa::sha2::{Digest, Sha256};
use rsa::{Pkcs1v15Sign, RsaPrivateKey, RsaPublicKey};
use serde::Deserialize;

/// 签名 / 验签 / 报文解密失败。全部归到「不可信输入」，由上层映射成错误码。
#[derive(Debug, thiserror::Error)]
pub enum SignatureError {
    #[error("invalid private key: {0}")]
    PrivateKey(String),
    #[error("invalid public key: {0}")]
    PublicKey(String),
    #[error("sign failed: {0}")]
    Sign(String),
    #[error("signature verification failed")]
    Verify,
    #[error("invalid base64 content: {0}")]
    Base64(String),
    #[error("decrypt failed: {0}")]
    Decrypt(String),
}

/// 加载商户 / 应用私钥：优先 PKCS#8（`-----BEGIN PRIVATE KEY-----`），
/// 回落 PKCS#1（`-----BEGIN RSA PRIVATE KEY-----`，微信控制台早期下发格式）。
pub fn load_private_key(pem: &str) -> Result<RsaPrivateKey, SignatureError> {
    let pem = pem.trim();
    if let Ok(key) = RsaPrivateKey::from_pkcs8_pem(pem) {
        return Ok(key);
    }
    if let Ok(key) = RsaPrivateKey::from_pkcs1_pem(pem) {
        return Ok(key);
    }
    Err(SignatureError::PrivateKey(
        "期望 PKCS#8 或 PKCS#1 PEM 私钥".to_string(),
    ))
}

/// 加载平台 / 渠道公钥：SPKI 公钥 PEM（`openssl x509 -pubkey` 的输出）或
/// PKCS#1 公钥 PEM（`-----BEGIN RSA PUBLIC KEY-----`）。
pub fn load_public_key(pem: &str) -> Result<RsaPublicKey, SignatureError> {
    let pem = pem.trim();
    if let Ok(key) = RsaPublicKey::from_public_key_pem(pem) {
        return Ok(key);
    }
    if let Ok(key) = RsaPublicKey::from_pkcs1_pem(pem) {
        return Ok(key);
    }
    Err(SignatureError::PublicKey(
        "期望 SPKI 或 PKCS#1 PEM 公钥".to_string(),
    ))
}

/// SHA256withRSA（PKCS#1 v1.5）签名，返回 base64。
pub fn sign_sha256(private_key: &RsaPrivateKey, message: &[u8]) -> Result<String, SignatureError> {
    let digest = Sha256::digest(message);
    let signature = private_key
        .sign(Pkcs1v15Sign::new::<Sha256>(), &digest)
        .map_err(|err| SignatureError::Sign(err.to_string()))?;
    Ok(STANDARD.encode(signature))
}

/// SHA256withRSA（PKCS#1 v1.5）验签。签名非法一律返回 [`SignatureError::Verify`]，
/// 不向调用方泄露具体失败原因。
pub fn verify_sha256(
    public_key: &RsaPublicKey,
    message: &[u8],
    signature_b64: &str,
) -> Result<(), SignatureError> {
    let signature = STANDARD
        .decode(signature_b64.trim())
        .map_err(|err| SignatureError::Base64(err.to_string()))?;
    let digest = Sha256::digest(message);
    public_key
        .verify(Pkcs1v15Sign::new::<Sha256>(), &digest, &signature)
        .map_err(|_| SignatureError::Verify)
}

/// 随机串（微信请求头 `nonce_str` / 支付宝 `nonce`）。
pub fn random_nonce() -> String {
    let mut bytes = [0u8; 16];
    rsa::rand_core::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// 微信支付回调 `resource` 的解密输入。
#[derive(Debug, Clone, Deserialize)]
pub struct WechatResource {
    pub ciphertext: String,
    pub nonce: String,
    #[serde(default)]
    pub associated_data: String,
}

/// 用 APIv3 密钥解密微信回调 `resource`（AES-256-GCM，AAD 为 `associated_data`）。
pub fn decrypt_wechat_resource(
    api_v3_key: &str,
    resource: &WechatResource,
) -> Result<String, SignatureError> {
    if api_v3_key.len() != 32 {
        return Err(SignatureError::Decrypt(
            "APIv3 密钥必须是 32 位".to_string(),
        ));
    }
    let cipher = Aes256Gcm::new_from_slice(api_v3_key.as_bytes())
        .map_err(|err| SignatureError::Decrypt(err.to_string()))?;
    let ciphertext = STANDARD
        .decode(resource.ciphertext.trim())
        .map_err(|err| SignatureError::Base64(err.to_string()))?;
    let nonce_bytes: [u8; 12] = resource
        .nonce
        .as_bytes()
        .try_into()
        .map_err(|_| SignatureError::Decrypt("回调 nonce 必须是 12 字节".to_string()))?;
    let nonce = Nonce::from(nonce_bytes);
    let plaintext = if resource.associated_data.is_empty() {
        cipher.decrypt(&nonce, ciphertext.as_ref())
    } else {
        use aes_gcm::aead::Payload;
        cipher.decrypt(
            &nonce,
            Payload {
                msg: ciphertext.as_ref(),
                aad: resource.associated_data.as_bytes(),
            },
        )
    }
    .map_err(|_| SignatureError::Decrypt("回调报文解密失败".to_string()))?;

    String::from_utf8(plaintext)
        .map_err(|err| SignatureError::Decrypt(format!("回调明文非 UTF-8: {err}")))
}

/// 金额字符串（元）转「分」。
///
/// 手写十进制解析而非 `f64`：浮点误差会让 0.1 + 0.2 这类金额对不上账。
pub fn yuan_to_cents(value: &str) -> Result<i64, SignatureError> {
    let text = value.trim();
    let (sign, digits) = match text.strip_prefix('-') {
        Some(rest) => (-1, rest),
        None => (1, text.strip_prefix('+').unwrap_or(text)),
    };
    let (yuan, fraction) = match digits.split_once('.') {
        Some((yuan, fraction)) => (yuan, fraction),
        None => (digits, ""),
    };
    if yuan.is_empty() && fraction.is_empty() {
        return Err(SignatureError::Sign("金额为空".to_string()));
    }
    // 上游可能返回 19 / 19.9 / 19.09 / 19.099，统一归一到「分」
    let fraction = if fraction.len() > 2 {
        &fraction[..2]
    } else {
        fraction
    };
    let yuan_value: i64 = if yuan.is_empty() {
        0
    } else {
        yuan.parse()
            .map_err(|_| SignatureError::Sign(format!("金额格式无效: {text}")))?
    };
    let mut fraction_text = fraction.to_string();
    while fraction_text.len() < 2 {
        fraction_text.push('0');
    }
    let fraction_value: i64 = fraction_text
        .parse()
        .map_err(|_| SignatureError::Sign(format!("金额格式无效: {text}")))?;

    Ok(sign * (yuan_value * 100 + fraction_value))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 测试用固定密钥（仅用于单测，与任何真实商户无关）。
    const TEST_PRIVATE_KEY: &str = include_str!("testdata/rsa_test_private.pem");

    #[test]
    fn sign_and_verify_roundtrip() {
        let private = load_private_key(TEST_PRIVATE_KEY).expect("load private key");
        let public = RsaPublicKey::from(&private);
        let message = b"GET\n/v3/certificates\n1700000000\nnonce\n\n";
        let signature = sign_sha256(&private, message).expect("sign");
        assert!(verify_sha256(&public, message, &signature).is_ok());
        assert!(verify_sha256(&public, b"tampered", &signature).is_err());
    }

    /// 与 Node.js `crypto` 生成的向量交叉验证，确认 DigestInfo 前缀与填充正确。
    #[test]
    fn verify_external_vector() {
        let public = load_public_key(include_str!("testdata/rsa_test_public.pem")).unwrap();
        let signature = include_str!("testdata/rsa_test_signature.txt");
        assert!(verify_sha256(&public, b"out_trade_no=demo&total_amount=19.00", signature).is_ok());
    }

    #[test]
    fn yuan_to_cents_parses_without_float_error() {
        assert_eq!(yuan_to_cents("19").unwrap(), 1900);
        assert_eq!(yuan_to_cents("19.9").unwrap(), 1990);
        assert_eq!(yuan_to_cents("19.09").unwrap(), 1909);
        assert_eq!(yuan_to_cents(" 0.1 ").unwrap(), 10);
        assert_eq!(yuan_to_cents("1234.567").unwrap(), 123456);
        assert!(yuan_to_cents("").is_err());
        assert!(yuan_to_cents("abc").is_err());
    }

    #[test]
    fn rejects_short_api_v3_key() {
        let resource = WechatResource {
            ciphertext: "AAAA".to_string(),
            nonce: "123456789012".to_string(),
            associated_data: String::new(),
        };
        assert!(decrypt_wechat_resource("short", &resource).is_err());
    }
}
