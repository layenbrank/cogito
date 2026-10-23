//! 从 HTTP 请求解析客户端 IP（与 captcha / governor 共用）。

use std::net::IpAddr;

use actix_web::HttpRequest;
use actix_web::dev::ServiceRequest;
use actix_web::http::header;

pub fn from_http_request(req: &HttpRequest, trust_proxy: bool) -> String {
    if trust_proxy {
        if let Some(ip) = forwarded_ip(req) {
            return ip;
        }
    }
    req.connection_info()
        .peer_addr()
        .map(str::to_string)
        .unwrap_or_else(|| "unknown".to_string())
}

pub fn from_service_request(req: &ServiceRequest, trust_proxy: bool) -> String {
    if trust_proxy {
        if let Some(ip) = forwarded_ip(req.request()) {
            return ip;
        }
    }
    req.connection_info()
        .peer_addr()
        .map(str::to_string)
        .unwrap_or_else(|| "unknown".to_string())
}

pub fn parse_ip_addr(value: &str) -> Option<IpAddr> {
    let host = value
        .trim()
        .trim_start_matches('[')
        .split(']')
        .next()
        .unwrap_or(value)
        .split(':')
        .next()
        .unwrap_or(value)
        .trim();
    host.parse().ok()
}

fn forwarded_ip(req: &HttpRequest) -> Option<String> {
    req.headers()
        .get(header::FORWARDED)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split("for=").nth(1))
        .map(|v| {
            v.split(';')
                .next()
                .unwrap_or(v)
                .trim()
                .trim_matches('"')
                .to_string()
        })
        .or_else(|| {
            req.headers()
                .get("X-Forwarded-For")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.split(',').next())
                .map(str::trim)
                .map(str::to_string)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::test::TestRequest;

    #[test]
    fn peer_addr_fallback() {
        let req = TestRequest::default().to_http_request();
        assert_eq!(from_http_request(&req, false), "unknown");
    }

    #[test]
    fn parse_ipv4() {
        assert_eq!(
            parse_ip_addr("192.168.1.1"),
            Some("192.168.1.1".parse().unwrap())
        );
    }
}
