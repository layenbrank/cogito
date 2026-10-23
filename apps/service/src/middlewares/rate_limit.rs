//! Auth 路由 IP 限流。
//!
//! 限流算法由 `governor`（MIT）提供，actix-web 的 `Transform` / `Service` 粘合层在本仓库实现，
//! 用于替代 `actix-governor`（GPL-3.0-or-later，本项目不可用）。
//!
//! 令牌桶状态保存在进程内存中，故多副本部署时每个副本独立计数；跨副本的共享限额属于网关层职责。

use std::fmt;
use std::net::IpAddr;
use std::num::NonZeroU32;
use std::sync::Arc;
use std::time::Duration;

use actix_web::body::{EitherBody, MessageBody};
use actix_web::dev::{Service, ServiceRequest, ServiceResponse, Transform, forward_ready};
use actix_web::{Error, HttpResponse, HttpResponseBuilder, error::ErrorInternalServerError};
use futures::TryFutureExt;
use futures::future::{Either, MapOk, Ready, err, ok};
use governor::clock::{Clock, DefaultClock, QuantaInstant};
use governor::{DefaultKeyedRateLimiter, NotUntil, Quota, RateLimiter};

use crate::configures::configure::Configure;
use crate::filters::exception::Exception;
use crate::utils::client_ip;
use crate::utils::code::request;

/// 无法从请求中解析出客户端 IP。
#[derive(Debug)]
pub struct KeyExtractionError(&'static str);

impl fmt::Display for KeyExtractionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0)
    }
}

impl std::error::Error for KeyExtractionError {}

#[derive(Debug, Clone)]
pub struct ClientIpKeyExtractor {
    trust_proxy: bool,
}

impl ClientIpKeyExtractor {
    pub fn new(trust_proxy: bool) -> Self {
        Self { trust_proxy }
    }

    pub fn extract(&self, req: &ServiceRequest) -> Result<IpAddr, KeyExtractionError> {
        let raw = client_ip::from_service_request(req, self.trust_proxy);
        let mut ip = client_ip::parse_ip_addr(&raw)
            .ok_or(KeyExtractionError("无法从请求中解析客户端 IP"))?;

        // 同一 /64 前缀归并为一个桶，避免终端用户轮换 IPv6 地址绕过限流。
        if let IpAddr::V6(ipv6) = ip {
            let mut octets = ipv6.octets();
            octets[7..16].fill(0);
            ip = IpAddr::V6(octets.into());
        }

        Ok(ip)
    }
}

pub struct AuthGovernorConfig {
    extractor: ClientIpKeyExtractor,
    limiter: DefaultKeyedRateLimiter<IpAddr>,
    burst_size: u32,
    replenish_interval: Duration,
}

impl fmt::Debug for AuthGovernorConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AuthGovernorConfig")
            .field("trust_proxy", &self.extractor.trust_proxy)
            .field("burst_size", &self.burst_size)
            .field("replenish_interval", &self.replenish_interval)
            .finish()
    }
}

impl AuthGovernorConfig {
    fn exceed_rate_limit_response(
        &self,
        _negative: &NotUntil<QuantaInstant>,
        mut response: HttpResponseBuilder,
    ) -> HttpResponse {
        let err = Exception::custom(request::RATE_LIMIT_EXCEEDED, "请求频率过高");
        response.status(err.status()).json(err)
    }
}

#[derive(Debug, Clone)]
pub struct AuthGovernor(pub Option<Arc<AuthGovernorConfig>>);

pub fn build_auth_governor(config: &Configure) -> AuthGovernor {
    let rl = &config.auth.rate_limit;
    if !rl.enabled {
        return AuthGovernor(None);
    }

    let burst = rl.burst_size.max(1);
    let rpm = rl.requests_per_minute.max(1);

    // 等价于 governor 的 `requests_per_minute(rpm) + burst_size(burst)`：
    // 每 60s/rpm 补充一个令牌，桶容量为 burst。
    let replenish_interval =
        Duration::from_nanos((Duration::from_secs(60).as_nanos() / rpm as u128).max(1) as u64);
    let quota = Quota::with_period(replenish_interval)
        .expect("replenish interval is non-zero")
        .allow_burst(NonZeroU32::new(burst).expect("burst size is non-zero"));

    AuthGovernor(Some(Arc::new(AuthGovernorConfig {
        extractor: ClientIpKeyExtractor::new(config.auth.trust_proxy),
        limiter: RateLimiter::keyed(quota),
        burst_size: burst,
        replenish_interval,
    })))
}

type ServiceFuture<S, B> = MapOk<
    <S as Service<ServiceRequest>>::Future,
    fn(ServiceResponse<B>) -> ServiceResponse<EitherBody<B>>,
>;

pub struct AuthRateLimitMiddleware<S> {
    service: S,
    config: Option<Arc<AuthGovernorConfig>>,
}

impl<S, B> Transform<S, ServiceRequest> for AuthGovernor
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>,
    B: MessageBody,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Transform = AuthRateLimitMiddleware<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(AuthRateLimitMiddleware {
            service,
            config: self.0.clone(),
        })
    }
}

impl<S, B> Service<ServiceRequest> for AuthRateLimitMiddleware<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>,
    B: MessageBody,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Future =
        Either<ServiceFuture<S, B>, Ready<Result<ServiceResponse<EitherBody<B>>, Self::Error>>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let Some(config) = self.config.as_ref() else {
            return Either::Left(
                self.service
                    .call(req)
                    .map_ok(|resp| resp.map_into_left_body()),
            );
        };

        match config.extractor.extract(&req) {
            Ok(ip) => match config.limiter.check_key(&ip) {
                Ok(_) => Either::Left(
                    self.service
                        .call(req)
                        .map_ok(|resp| resp.map_into_left_body()),
                ),
                Err(negative) => {
                    let wait_time = negative
                        .wait_time_from(DefaultClock::default().now())
                        .as_secs();

                    let mut response_builder = HttpResponse::TooManyRequests();
                    response_builder.insert_header(("retry-after", wait_time));
                    response_builder.insert_header(("x-ratelimit-after", wait_time));
                    let response = config.exceed_rate_limit_response(&negative, response_builder);

                    Either::Right(ok(req.into_response(response).map_into_right_body()))
                }
            },
            Err(e) => Either::Right(err(ErrorInternalServerError(e))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::test::TestRequest;

    #[test]
    fn extractor_unknown_peer_errors() {
        let req = TestRequest::default().to_srv_request();
        let extractor = ClientIpKeyExtractor::new(false);
        assert!(extractor.extract(&req).is_err());
    }

    #[test]
    fn keyed_limiter_rejects_after_burst_exhausted() {
        let quota =
            Quota::per_minute(NonZeroU32::new(1).unwrap()).allow_burst(NonZeroU32::new(2).unwrap());
        let limiter: DefaultKeyedRateLimiter<IpAddr> = RateLimiter::keyed(quota);
        let ip: IpAddr = "192.168.1.1".parse().unwrap();

        assert!(limiter.check_key(&ip).is_ok());
        assert!(limiter.check_key(&ip).is_ok());
        assert!(limiter.check_key(&ip).is_err());
    }
}
