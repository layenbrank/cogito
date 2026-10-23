use std::sync::Arc;

use actix_web::{HttpRequest, HttpResponse, Result, web};

use crate::clients::redis::RedisPool;
use crate::configures::configure::Configure;
use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::session::Session;
use crate::interceptors::envelope::Envelope;
use crate::services::auth::captcha::client_ip_from_request;
use crate::services::auth::schema::{
    CaptchaP, EmailSigninP, ForgotPasswordP, OtpP, PasswordP, PhoneSigninP, ProfileP,
    ResetPasswordP, SigninP, SignupP,
};
use crate::services::auth::service::AuthService;

pub struct AuthController;

impl AuthController {
    /// 获取图形验证码
    pub async fn captcha(
        redis: web::Data<Arc<RedisPool>>,
        config: web::Data<Arc<Configure>>,
        http: HttpRequest,
        body: Option<web::Json<CaptchaP>>,
    ) -> Result<HttpResponse> {
        let ip = client_ip_from_request(&http);
        let kind = body.as_ref().and_then(|b| b.kind.as_deref());
        match AuthService::captcha(&redis, &config, &ip, kind).await {
            Ok(response) => Envelope::success(response, "验证码已生成").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 发送 OTP
    pub async fn otp(
        db: web::Data<Arc<Storage>>,
        redis: web::Data<Arc<RedisPool>>,
        config: web::Data<Arc<Configure>>,
        req: web::Json<OtpP>,
    ) -> Result<HttpResponse> {
        match AuthService::otp(&redis, &config, &db, req.into_inner()).await {
            Ok(()) => Envelope::message_only("验证码已发送").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 用户登录
    pub async fn signin(
        db: web::Data<Arc<Storage>>,
        redis: web::Data<Arc<RedisPool>>,
        config: web::Data<Arc<Configure>>,
        req: web::Json<SigninP>,
    ) -> Result<HttpResponse> {
        match AuthService::signin(&db, &redis, req.into_inner(), &config).await {
            Ok(response) => Envelope::success(response, "登录成功").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 手机号登录
    pub async fn signin_phone(
        db: web::Data<Arc<Storage>>,
        redis: web::Data<Arc<RedisPool>>,
        config: web::Data<Arc<Configure>>,
        req: web::Json<PhoneSigninP>,
    ) -> Result<HttpResponse> {
        match AuthService::signin_phone(&db, &redis, req.into_inner(), &config).await {
            Ok(response) => Envelope::success(response, "登录成功").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 邮箱登录
    pub async fn signin_email(
        db: web::Data<Arc<Storage>>,
        redis: web::Data<Arc<RedisPool>>,
        config: web::Data<Arc<Configure>>,
        req: web::Json<EmailSigninP>,
    ) -> Result<HttpResponse> {
        match AuthService::signin_email(&db, &redis, req.into_inner(), &config).await {
            Ok(response) => Envelope::success(response, "登录成功").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 用户注册
    pub async fn signup(
        db: web::Data<Arc<Storage>>,
        redis: web::Data<Arc<RedisPool>>,
        config: web::Data<Arc<Configure>>,
        req: web::Json<SignupP>,
    ) -> Result<HttpResponse> {
        match AuthService::signup(&db, &redis, req.into_inner(), &config).await {
            Ok(response) => Envelope::success(response, "注册成功").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 找回密码（发 OTP）
    pub async fn forgot_password(
        db: web::Data<Arc<Storage>>,
        redis: web::Data<Arc<RedisPool>>,
        config: web::Data<Arc<Configure>>,
        req: web::Json<ForgotPasswordP>,
    ) -> Result<HttpResponse> {
        match AuthService::forgot_password(&redis, &config, &db, req.into_inner()).await {
            Ok(()) => Envelope::message_only("验证码已发送").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 重置密码（OTP + 新密码）
    pub async fn reset_password(
        db: web::Data<Arc<Storage>>,
        redis: web::Data<Arc<RedisPool>>,
        config: web::Data<Arc<Configure>>,
        req: web::Json<ResetPasswordP>,
    ) -> Result<HttpResponse> {
        match AuthService::reset_password(&redis, &config, &db, req.into_inner()).await {
            Ok(()) => Envelope::message_only("密码已重置").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 修改密码（已登录）
    pub async fn password(
        db: web::Data<Arc<Storage>>,
        redis: web::Data<Arc<RedisPool>>,
        config: web::Data<Arc<Configure>>,
        http: HttpRequest,
        req: web::Json<PasswordP>,
    ) -> Result<HttpResponse> {
        let Some(session) = Session::of(&http) else {
            return Exception::unauthorized("用户未登录").transform();
        };

        let user_id = session.user_id().to_string();

        match AuthService::change_password(
            &db,
            &redis,
            &config,
            &user_id,
            session.token(),
            session.expires_at(),
            req.into_inner(),
        )
        .await
        {
            Ok(()) => Envelope::message_only("密码已修改").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 获取当前用户 profile
    pub async fn toRead(db: web::Data<Arc<Storage>>, http: HttpRequest) -> Result<HttpResponse> {
        let Some(session) = Session::of(&http) else {
            return Exception::unauthorized("用户未登录").transform();
        };

        match AuthService::toRead(&db, &session.user_id().to_string()).await {
            Ok(response) => Envelope::success(response, "获取个人信息成功").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 更新当前用户 profile
    pub async fn toUpdate(
        db: web::Data<Arc<Storage>>,
        http: HttpRequest,
        req: web::Json<ProfileP>,
    ) -> Result<HttpResponse> {
        let Some(session) = Session::of(&http) else {
            return Exception::unauthorized("用户未登录").transform();
        };

        match AuthService::toUpdate(&db, &session.user_id().to_string(), req.into_inner()).await {
            Ok(response) => Envelope::success(response, "更新个人信息成功").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }

    /// 登出：将当前 JWT 写入 Redis 黑名单
    pub async fn signout(
        redis: web::Data<Arc<RedisPool>>,
        http: HttpRequest,
    ) -> Result<HttpResponse> {
        let Some(session) = Session::of(&http) else {
            return Exception::unauthorized("用户未登录").transform();
        };

        match AuthService::signout(&redis, session.token(), session.expires_at()).await {
            Ok(()) => Envelope::message_only("登出成功").transform(),
            Err(err) => Exception::from(err).transform(),
        }
    }
}
