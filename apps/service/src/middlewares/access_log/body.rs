//! 请求/响应 body 预览与敏感字段脱敏（可单测）。

use actix_web::{HttpMessage, dev::ServiceRequest, http::header, web::Bytes};
use futures::StreamExt;

const SENSITIVE_KEYS: &[&str] = &[
    "password",
    "passwd",
    "secret",
    "secretKey",
    "apiKey",
    "token",
    "accessToken",
    "refreshToken",
    "authorization",
];

const SENSITIVE_QUERY_KEYS: &[&str] = &[
    "password",
    "passwd",
    "secret",
    "token",
    "accessToken",
    "refreshToken",
    "authorization",
    "apiKey",
];

pub fn body_max() -> usize {
    crate::utils::logger::body_max()
}

pub fn header_str(req: &ServiceRequest, name: header::HeaderName) -> Option<String> {
    req.headers()
        .get(name)
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string())
}

pub fn is_json_ct(content_type: &str) -> bool {
    let ct = content_type.to_ascii_lowercase();
    ct.starts_with("application/json") || ct.contains("+json")
}

/// 是否跳过响应体采样（大文件 / 非文本 / 超限 Content-Length / 公开下载）。
pub fn skip_response_peek(
    path: &str,
    headers: &actix_web::http::header::HeaderMap,
    max: usize,
) -> bool {
    if path.starts_with("/api/v1/upload/files/") || path.starts_with("/api/v1/upload/asset/") {
        return true;
    }
    if let Some(len) = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.parse::<usize>().ok())
    {
        if len > max {
            return true;
        }
    }
    match headers
        .get(header::CONTENT_TYPE)
        .and_then(|h| h.to_str().ok())
    {
        Some(ct) => {
            let ct = ct.to_ascii_lowercase();
            !(is_json_ct(&ct) || ct.starts_with("text/"))
        }
        // 无 Content-Type 且可能是 chunked 大流：保守跳过，避免 to_bytes 打满内存
        None => headers.get(header::CONTENT_LENGTH).is_none(),
    }
}

pub async fn buffer_json_body(
    req: &mut ServiceRequest,
    content_type: &str,
    max: usize,
) -> Option<String> {
    if !is_json_ct(content_type) {
        return None;
    }
    // 仅在有明确 Content-Length 且未超限时缓冲，避免 chunked 半包回填
    let len = header_str(req, header::CONTENT_LENGTH)?
        .parse::<usize>()
        .ok()?;
    if len == 0 || len > max {
        return None;
    }

    let mut payload = req.take_payload();
    let mut buf = Vec::with_capacity(len);
    let mut read_ok = true;

    while let Some(chunk) = payload.next().await {
        match chunk {
            Ok(c) => {
                buf.extend_from_slice(&c);
                if buf.len() > max {
                    read_ok = false;
                    // 继续排空流，尽量把完整 body 交还给后续 handler
                }
            }
            Err(_) => {
                read_ok = false;
                break;
            }
        }
    }

    let bytes = Bytes::from(buf);
    // 无论成功与否都回填，避免 take_payload 后丢体
    req.set_payload(bytes.clone().into());

    if !read_ok || bytes.len() > max {
        return None;
    }
    Some(redact_text(&String::from_utf8_lossy(&bytes)))
}

pub fn preview_body(bytes: &Bytes, max: usize) -> Option<String> {
    if bytes.is_empty() {
        return None;
    }
    let slice = if bytes.len() > max {
        &bytes[..max]
    } else {
        bytes.as_ref()
    };
    let text = String::from_utf8_lossy(slice);
    let mut out = redact_text(&text);
    if bytes.len() > max {
        out.push_str("…(truncated)");
    }
    Some(out)
}

/// 遮蔽 query 中的敏感键（`token=…` → `token=***`）。
pub fn redact_query(query: &str) -> String {
    if query.is_empty() {
        return String::new();
    }
    query
        .split('&')
        .map(|pair| {
            let mut parts = pair.splitn(2, '=');
            let key = parts.next().unwrap_or("");
            let val = parts.next();
            let key_l = key.to_ascii_lowercase();
            if SENSITIVE_QUERY_KEYS
                .iter()
                .any(|k| key_l == k.to_ascii_lowercase())
            {
                match val {
                    Some(_) => format!("{key}=***"),
                    None => key.to_string(),
                }
            } else {
                pair.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("&")
}

/// 遮蔽常见敏感字段（password / token / authorization）。同一字段多次出现全部替换。
pub fn redact_text(input: &str) -> String {
    let mut s = input.to_string();
    for key in SENSITIVE_KEYS {
        let pattern = format!("\"{key}\"");
        let mut from = 0;
        while let Some(rel) = s[from..].find(&pattern) {
            let idx = from + rel;
            let Some(colon_rel) = s[idx..].find(':') else {
                break;
            };
            let start = idx + colon_rel + 1;
            let rest = &s[start..];
            let trimmed = rest.trim_start();
            if let Some(stripped) = trimmed.strip_prefix('"') {
                if let Some(end) = stripped.find('"') {
                    let value_start = start + (rest.len() - trimmed.len()) + 1;
                    let value_end = value_start + end;
                    s.replace_range(value_start..value_end, "***");
                    from = value_start + 3;
                    continue;
                }
            }
            from = idx + pattern.len();
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::http::header::{HeaderMap, HeaderValue};

    #[test]
    fn redact_password_and_token() {
        let raw = r#"{"password":"secret","token":"abc","ok":true}"#;
        let out = redact_text(raw);
        assert!(out.contains(r#""password":"***""#));
        assert!(out.contains(r#""token":"***""#));
        assert!(out.contains(r#""ok":true"#));
        assert!(!out.contains("secret"));
        assert!(!out.contains("abc"));
    }

    #[test]
    fn redact_repeated_keys() {
        let raw = r#"{"token":"a","nested":{"token":"b"}}"#;
        let out = redact_text(raw);
        assert_eq!(out.matches("***").count(), 2);
        assert!(!out.contains("\"a\""));
        assert!(!out.contains("\"b\""));
    }

    #[test]
    fn redact_query_masks_token() {
        let out = redact_query("q=rust&token=secret&x=1");
        assert_eq!(out, "q=rust&token=***&x=1");
        assert!(!out.contains("secret"));
    }

    #[test]
    fn preview_truncates() {
        let bytes = Bytes::from(vec![b'x'; 20]);
        let out = preview_body(&bytes, 8).unwrap();
        assert!(out.ends_with("…(truncated)"));
        assert!(out.starts_with("xxxxxxxx"));
    }

    #[test]
    fn json_content_type() {
        assert!(is_json_ct("application/json"));
        assert!(is_json_ct("application/vnd.api+json; charset=utf-8"));
        assert!(!is_json_ct("multipart/form-data"));
    }

    #[test]
    fn skip_public_files_and_large_and_binary() {
        let mut h = HeaderMap::new();
        assert!(skip_response_peek("/api/v1/upload/files/abc", &h, 1024));
        assert!(skip_response_peek("/api/v1/upload/asset/abc", &h, 1024));

        h.insert(header::CONTENT_LENGTH, HeaderValue::from_static("99999"));
        h.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        assert!(skip_response_peek("/api/v1/auth/signin", &h, 1024));

        let mut h2 = HeaderMap::new();
        h2.insert(header::CONTENT_LENGTH, HeaderValue::from_static("100"));
        h2.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/octet-stream"),
        );
        assert!(skip_response_peek("/api/v1/x", &h2, 1024));

        let mut h3 = HeaderMap::new();
        h3.insert(header::CONTENT_LENGTH, HeaderValue::from_static("100"));
        h3.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        assert!(!skip_response_peek("/api/v1/auth/signin", &h3, 1024));
    }
}
