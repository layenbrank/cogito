//! Authorization: Bearer 解析（原始 token；签发/校验见 `jwt`）

use actix_web::http::header::{self, HeaderMap};

/// 从 `Authorization: Bearer <token>` 提取 token。
pub fn bearer(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    if value.len() > 7 && value[..7].eq_ignore_ascii_case("bearer ") {
        let token = value[7..].trim();
        if token.is_empty() {
            None
        } else {
            Some(token.to_string())
        }
    } else {
        None
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
}
