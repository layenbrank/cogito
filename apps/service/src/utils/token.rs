//! Authorization: Bearer 解析（原始 token；签发/校验见 `jwt`）

use actix_web::http::header::{self, HeaderMap};

/// 从 `Authorization: Bearer <token>` 提取 token。
pub fn bearer(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    // 用 `get(..7)` 而不是 `value[..7]`：切片下标落在多字节字符中间会 **panic**
    // （日志里实测到过 `byte index 7 is not a char boundary`）。`get` 越界或不在
    // 字符边界都返回 None，语义正好是「这不是 Bearer 头」。
    if !value.get(..7)?.eq_ignore_ascii_case("bearer ") {
        return None;
    }
    let token = value[7..].trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::http::header::{HeaderName, HeaderValue};

    fn headers(auth: &str) -> HeaderMap {
        let mut map = HeaderMap::new();
        map.insert(
            HeaderName::from_static("authorization"),
            HeaderValue::from_str(auth).unwrap(),
        );
        map
    }

    #[test]
    fn extracts_bearer_token() {
        assert_eq!(
            bearer(&headers("Bearer abc.def.ghi")).as_deref(),
            Some("abc.def.ghi")
        );
        assert_eq!(bearer(&headers("bearer xyz")).as_deref(), Some("xyz"));
    }

    #[test]
    fn rejects_empty_or_non_bearer() {
        assert!(bearer(&headers("Bearer ")).is_none());
        assert!(bearer(&headers("Bearer   ")).is_none());
        assert!(bearer(&headers("Basic abc")).is_none());
        assert!(bearer(&HeaderMap::new()).is_none());
    }

    #[test]
    fn short_or_odd_headers_do_not_panic() {
        // 不足 7 字节、以及（若上游允许）多字节内容都不该 panic：
        // 日志里出现过 `byte index 7 is not a char boundary`。
        for value in ["", "Beare", "bearer", "Bearer", "abcdefg", "Bearer abc"] {
            let _ = bearer(&headers(value));
        }
        // obs-text 头：`to_str()` 会拒掉，走到 `Option::None` 而不是切片 panic
        let mut map = HeaderMap::new();
        map.insert(
            HeaderName::from_static("authorization"),
            HeaderValue::from_bytes(b"Bearer \xe8\xa1\xa5").unwrap(),
        );
        assert!(bearer(&map).is_none());
    }
}
