//! JWT 黑名单（基于 Redis）

use anyhow::{Context, Result};
use fred::prelude::*;
use sha2::{Digest, Sha256};

use crate::clients::redis::RedisPool;

fn key(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    let mut hex = String::with_capacity(64);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    format!("auth:jwt:bl:{hex}")
}

/// 将 JWT 写入黑名单，TTL 为剩余有效秒数（至少 1 秒）。
pub async fn add(redis: &RedisPool, token: &str, ttl_secs: i64) -> Result<()> {
    let ttl = ttl_secs.max(1);
    redis
        .pool()
        .set::<(), _, _>(key(token), "1", Some(Expiration::EX(ttl)), None, false)
        .await
        .context("redis blacklist set failed")?;
    Ok(())
}

pub async fn has(redis: &RedisPool, token: &str) -> Result<bool> {
    let exists: bool = redis
        .pool()
        .exists(key(token))
        .await
        .context("redis blacklist exists failed")?;
    Ok(exists)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_stable_sha256_prefix() {
        let a = key("token-a");
        let b = key("token-a");
        assert_eq!(a, b);
        assert!(a.starts_with("auth:jwt:bl:"));
        assert_eq!(a.len(), "auth:jwt:bl:".len() + 64);
        assert_ne!(key("token-a"), key("token-b"));
    }
}
