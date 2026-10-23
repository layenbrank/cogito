use base64::{Engine, engine::general_purpose::STANDARD};
use rand::{Rng, RngExt};

/// 生成 JWT_SECRET (64 字符的随机字符串)
pub fn generate_jwt_secret() -> String {
    const CHARSET: &[u8] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let mut rng = rand::rng();
    (0..64)
        .map(|_| {
            let idx = rng.random_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

/// 生成 AES_KEY (32 字节的随机密钥，base64 编码)
pub fn generate_aes_key() -> String {
    let mut key = [0u8; 32];
    rand::rng().fill_bytes(&mut key);
    STANDARD.encode(&key)
}

/// 生成安全的 CVID (加密随机数，符合 GUID v4 标准)
///
/// 参考 TypeScript 逻辑：
/// - 生成 16 字节随机数组
/// - 设置版本位（第 6 字节）：(byte6 & 0x0f) | 0x40
/// - 设置变体位（第 8 字节）：(byte8 & 0x3f) | 0x80
/// - 转换为十六进制字符串并大写
pub fn generate_secure_cvid() -> String {
    let mut array = [0u8; 16];
    rand::rng().fill_bytes(&mut array);

    // 设置版本位（GUID v4 标准）
    // 第 6 字节：保留低 4 位，设置高 4 位为 0x40 (版本 4)
    array[6] = (array[6] & 0x0f) | 0x40;

    // 设置变体位
    // 第 8 字节：保留低 6 位，设置高 2 位为 0x80 (变体 10)
    array[8] = (array[8] & 0x3f) | 0x80;

    // 转换为十六进制字符串并大写
    array
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<String>()
}
