use chrono::{Datelike, Utc};
use entity::{asset, auth};
use identity::{AccountStatus, PlatformRole, UserId};
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter, Set};
use std::str::FromStr;
use uuid::Uuid;

use crate::clients::redis::RedisPool;
use crate::configures::configure::Configure;
use crate::databases::database::{self, Storage};
use crate::filters::exception::Exception;
use crate::guards::account::AccountScope;
use crate::guards::blacklist;
use crate::services::auth::captcha::{CaptchaError, CaptchaService};
use crate::services::auth::otp::{OtpError, OtpPurpose, OtpService};
use crate::services::auth::schema::{
    CaptchaR, EmailSigninP, ForgotPasswordP, Gender, OtpChannel, OtpP, PasswordP, PhoneSigninP,
    ProfileP, ProfileR, ResetPasswordP, SigninP, SigninR, SignupP, SignupR,
};
use crate::services::upload::schema::Visibility;
use crate::utils::code::{auth as auth_codes, business, external, request, resource, system};
use crate::utils::db::is_unique_violation;
use crate::utils::encryption::{EncryptionError, encrypt_password, verify_password};
use crate::utils::jwt::{JwtError, generate_token};

#[derive(Debug, thiserror::Error)]
pub enum ProfileError {
    #[error("Phone already exists")]
    PhoneTaken,
    #[error("Avatar not found")]
    AvatarMissing,
    #[error("Avatar access denied")]
    AvatarDenied,
    #[error("Invalid parameter: {0}")]
    BadParam(String),
    #[error("Database error: {0}")]
    Db(String),
}

impl From<ProfileError> for Exception {
    fn from(err: ProfileError) -> Self {
        match err {
            ProfileError::PhoneTaken => {
                Exception::custom(business::user::PHONE_EXISTS, "手机号已被注册")
            }
            ProfileError::AvatarMissing => {
                Exception::custom(business::upload::FILE_NOT_FOUND, "文件不存在")
            }
            ProfileError::AvatarDenied => {
                Exception::custom(resource::ACCESS_RESTRICTED, "资源访问被限制")
            }
            ProfileError::BadParam(msg) => Exception::custom(request::INVALID_PARAMETER_VALUE, msg),
            ProfileError::Db(msg) => {
                tracing::error!(error = %msg, "profile database error");
                Exception::custom(external::DATABASE_ERROR, "数据库错误")
            }
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("User already exists")]
    UserAlreadyExists,
    #[error("User not found")]
    UserNotFound,
    #[error("Invalid password")]
    InvalidPassword,
    #[error("Wrong old password")]
    WrongOldPassword,
    #[error("Weak password")]
    WeakPassword,
    #[error("Password reset failed")]
    ResetPasswordFailed,
    #[error("Account disabled")]
    AccountDisabled,
    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
    #[error(transparent)]
    Profile(#[from] ProfileError),
    #[error("Encryption error: {0}")]
    EncryptionError(#[from] EncryptionError),
    #[error("JWT error: {0}")]
    JwtError(#[from] JwtError),
    #[error("Database error: {0}")]
    DatabaseError(String),
    #[error("Cache error: {0}")]
    CacheError(String),
    #[error("Captcha error: {0}")]
    Captcha(#[from] CaptchaError),
    #[error("OTP error: {0}")]
    Otp(#[from] OtpError),
    #[error("Too many attempts")]
    TooManyAttempts,
}

impl From<AuthError> for Exception {
    fn from(err: AuthError) -> Self {
        match err {
            AuthError::UserAlreadyExists => {
                Exception::custom(business::user::USERNAME_EXISTS, "用户名已存在")
            }
            AuthError::UserNotFound => Exception::custom(business::user::NOT_FOUND, "用户不存在"),
            AuthError::InvalidPassword => {
                Exception::custom(business::login::INVALID_CREDENTIALS, "用户名或密码错误")
            }
            AuthError::WrongOldPassword => {
                Exception::custom(business::login::INVALID_CREDENTIALS, "原密码错误")
            }
            AuthError::WeakPassword => {
                Exception::custom(business::user::WEAK_PASSWORD, "密码强度不够")
            }
            AuthError::ResetPasswordFailed => {
                Exception::custom(business::login::RESET_PASSWORD_FAILED, "密码重置失败")
            }
            AuthError::AccountDisabled => {
                Exception::custom(auth_codes::ACCOUNT_DISABLED, "账号已禁用")
            }
            AuthError::InvalidParameter(msg) => {
                Exception::custom(request::INVALID_PARAMETER_VALUE, msg)
            }
            AuthError::Profile(e) => Exception::from(e),
            AuthError::EncryptionError(_) => {
                Exception::custom(system::INTERNAL_ERROR, "加密服务异常")
            }
            AuthError::JwtError(_) => Exception::custom(system::INTERNAL_ERROR, "令牌服务异常"),
            AuthError::DatabaseError(msg) => {
                tracing::error!(error = %msg, "auth database error");
                Exception::custom(external::DATABASE_ERROR, "数据库错误")
            }
            AuthError::CacheError(msg) => {
                tracing::error!(error = %msg, "auth cache error");
                Exception::custom(external::CACHE_ERROR, "缓存错误")
            }
            AuthError::Captcha(e) => match e {
                CaptchaError::Invalid => {
                    Exception::custom(business::login::INVALID_CAPTCHA, "验证码错误")
                }
                CaptchaError::Expired => {
                    Exception::custom(business::login::CAPTCHA_EXPIRED, "验证码已过期")
                }
                CaptchaError::RateLimited => Exception::custom(
                    business::login::TOO_MANY_ATTEMPTS,
                    "尝试次数过多，请稍后再试",
                ),
                CaptchaError::Cache(msg) => {
                    tracing::error!(error = %msg, "captcha cache error");
                    Exception::custom(external::CACHE_ERROR, "缓存错误")
                }
                CaptchaError::Upstream(msg) => {
                    tracing::error!(error = %msg, "captcha upstream error");
                    Exception::custom(system::SERVICE_UNAVAILABLE, "验证码服务不可用")
                }
            },
            AuthError::Otp(e) => match e {
                OtpError::Invalid => Exception::custom(business::login::INVALID_OTP, "验证码错误"),
                OtpError::Expired => {
                    Exception::custom(business::login::OTP_EXPIRED, "验证码已过期")
                }
                OtpError::RateLimited | OtpError::Locked => Exception::custom(
                    business::login::TOO_MANY_ATTEMPTS,
                    "尝试次数过多，请稍后再试",
                ),
                OtpError::SendFailed => {
                    Exception::custom(system::SERVICE_UNAVAILABLE, "验证码发送失败，请稍后再试")
                }
                OtpError::Cache(msg) => {
                    tracing::error!(error = %msg, "otp cache error");
                    Exception::custom(external::CACHE_ERROR, "缓存错误")
                }
            },
            AuthError::TooManyAttempts => Exception::custom(
                business::login::TOO_MANY_ATTEMPTS,
                "尝试次数过多，请稍后再试",
            ),
        }
    }
}

fn map_db_err(err: sea_orm::DbErr) -> AuthError {
    if is_unique_violation(&err) {
        AuthError::UserAlreadyExists
    } else {
        AuthError::DatabaseError(err.to_string())
    }
}

pub fn age_from_birthday(birthday: chrono::NaiveDate) -> i32 {
    let today = Utc::now().date_naive();
    let mut age = today.year() - birthday.year();
    if (today.month(), today.day()) < (birthday.month(), birthday.day()) {
        age -= 1;
    }
    age.max(0)
}

/// 在**已开启的作用域**里读头像行；可见性完全交给 `asset` 的策略决定
/// （看不到的行返回 `None`，不区分「不存在」与「不可见」）。
///
/// # Errors
/// 查询失败时返回 [`ProfileError::Db`]。
pub async fn load_avatar(
    tx: &DatabaseTransaction,
    avatar_id: Option<Uuid>,
) -> Result<Option<asset::Model>, ProfileError> {
    let Some(id) = avatar_id else {
        return Ok(None);
    };
    asset::Entity::find_by_id(id)
        .one(tx)
        .await
        .map_err(|e| ProfileError::Db(e.to_string()))
}

/// 以**头像所属账号**的账号作用域读一份档案的头像。
///
/// 头像是档案数据（`asset.creator` 就是这个人），所以读它用这个人的作用域最贴切：
/// 本人档案、管理面单账号档案都走这一条；批量列表按公开可见性读，见 `user::service`。
///
/// # Errors
/// 作用域无法开启或查询失败时返回 [`ProfileError::Db`]。
pub async fn load_avatar_of(
    db: &Storage,
    owner: Uuid,
    avatar_id: Option<Uuid>,
) -> Result<Option<asset::Model>, ProfileError> {
    if avatar_id.is_none() {
        return Ok(None);
    }

    let scope = AccountScope::open(db, UserId::from_uuid(owner))
        .await
        .map_err(|e| ProfileError::Db(e.to_string()))?;
    let avatar = load_avatar(scope.tx(), avatar_id).await;
    scope
        .rollback()
        .await
        .map_err(|e| ProfileError::Db(e.to_string()))?;

    avatar
}

pub async fn phone_free(
    db: &Storage,
    phone: &str,
    exclude_id: Option<Uuid>,
) -> Result<(), ProfileError> {
    let existing = auth::Entity::find()
        .filter(auth::Column::Phone.eq(phone))
        .one(db.raw())
        .await
        .map_err(|e| ProfileError::Db(e.to_string()))?;

    if let Some(user) = existing {
        if exclude_id != Some(user.id) {
            return Err(ProfileError::PhoneTaken);
        }
    }

    Ok(())
}

/// 校验「这份资产可以当这个人的头像吗」，并把头像登记为**公开档案数据**。
///
/// 头像会出现在别人的档案与列表里，所以绑定成功时把 `visibility` 提升为 `PUBLIC`：
/// 公开档案数据就该按公开可见性读，读的人也不必是本人。历史头像由运维 SQL 回填
/// （见 `auth/README.md`）。
///
/// # Errors
/// 资产不可见/未完成时返回 [`ProfileError::AvatarMissing`]，
/// 不是本人上传的返回 [`ProfileError::AvatarDenied`]，非图片返回 [`ProfileError::BadParam`]。
pub async fn check_avatar(
    db: &Storage,
    user_id: Uuid,
    asset_id: &str,
) -> Result<Uuid, ProfileError> {
    let id = Uuid::parse_str(asset_id)
        .map_err(|_| ProfileError::BadParam("头像资源 ID 无效".to_string()))?;

    let scope = AccountScope::open(db, UserId::from_uuid(user_id))
        .await
        .map_err(|e| ProfileError::Db(e.to_string()))?;

    let asset = asset::Entity::find_by_id(id)
        .one(scope.tx())
        .await
        .map_err(|e| ProfileError::Db(e.to_string()))?
        .ok_or(ProfileError::AvatarMissing)?;

    if asset.status != "COMPLETED" {
        return Err(ProfileError::AvatarMissing);
    }

    if asset.creator != Some(user_id) {
        return Err(ProfileError::AvatarDenied);
    }

    if !asset.mime.starts_with("image/") {
        return Err(ProfileError::BadParam("头像文件必须是图片类型".to_string()));
    }

    if asset.visibility != Visibility::Public.as_str() {
        asset::ActiveModel {
            id: Set(id),
            visibility: Set(Visibility::Public.as_str().to_string()),
            updated_at: Set(Utc::now().fixed_offset()),
            updater: Set(Some(user_id)),
            ..Default::default()
        }
        .update(scope.tx())
        .await
        .map_err(|e| ProfileError::Db(e.to_string()))?;
    }

    scope
        .commit()
        .await
        .map_err(|e| ProfileError::Db(e.to_string()))?;

    Ok(id)
}

pub struct AuthService;

impl AuthService {
    pub async fn captcha(
        redis: &RedisPool,
        config: &Configure,
        client_ip: &str,
        kind: Option<&str>,
    ) -> Result<CaptchaR, AuthError> {
        Ok(CaptchaService::create(redis, config, client_ip, kind).await?)
    }

    pub async fn otp(
        redis: &RedisPool,
        config: &Configure,
        db: &database::Storage,
        req: OtpP,
    ) -> Result<(), AuthError> {
        validate_otp_target(req.channel, &req.target)?;

        CaptchaService::verify(
            config,
            req.captcha_kind.as_deref(),
            &req.captcha_key,
            &req.captcha_value,
        )
        .await?;

        let bound = match req.channel {
            OtpChannel::Phone => Self::find_user_by_phone(db, &req.target).await?.is_some(),
            OtpChannel::Email => Self::find_user_by_email(db, &req.target).await?.is_some(),
        };

        if !bound {
            tracing::info!(
                event = "auth.otp.send",
                channel = req.channel.as_str(),
                target_not_bound = true,
                "otp skipped for unbound target"
            );
            return Ok(());
        }

        OtpService::send(redis, config, OtpPurpose::Login, req.channel, &req.target).await?;
        Ok(())
    }

    pub async fn forgot_password(
        redis: &RedisPool,
        config: &Configure,
        db: &database::Storage,
        req: ForgotPasswordP,
    ) -> Result<(), AuthError> {
        CaptchaService::verify(
            config,
            req.captcha_kind.as_deref(),
            &req.captcha_key,
            &req.captcha_value,
        )
        .await?;

        let mode =
            parse_password_identifier(req.username.as_deref(), req.channel, req.target.as_deref())?;

        let user = match mode {
            PasswordIdentifier::Username(username) => auth::Entity::find_by_username(&username)
                .one(db.raw())
                .await
                .map_err(|e| AuthError::DatabaseError(e.to_string()))?,
            PasswordIdentifier::Channel(channel, target) => {
                validate_otp_target(channel, &target)?;
                match channel {
                    OtpChannel::Phone => Self::find_user_by_phone(db, &target).await?,
                    OtpChannel::Email => Self::find_user_by_email(db, &target).await?,
                }
            }
        };

        let Some(user) = user else {
            tracing::info!(
                event = "auth.password.forgot",
                skipped = true,
                "user not found"
            );
            return Ok(());
        };

        let targets = bound_otp_targets(&user);
        if targets.is_empty() {
            tracing::info!(
                event = "auth.password.forgot",
                skipped = true,
                "no bound channel"
            );
            return Ok(());
        }

        let target_refs: Vec<(OtpChannel, &str)> =
            targets.iter().map(|(ch, t)| (*ch, t.as_str())).collect();

        OtpService::send_same_code_to_targets(
            redis,
            config,
            OtpPurpose::PasswordReset,
            &target_refs,
        )
        .await?;
        Ok(())
    }

    pub async fn reset_password(
        redis: &RedisPool,
        config: &Configure,
        db: &database::Storage,
        req: ResetPasswordP,
    ) -> Result<(), AuthError> {
        validate_password_strength(&req.new_password)?;

        let mode =
            parse_password_identifier(req.username.as_deref(), req.channel, req.target.as_deref())?;

        let user = match mode {
            PasswordIdentifier::Username(username) => {
                let user = auth::Entity::find_by_username(&username)
                    .one(db.raw())
                    .await
                    .map_err(|e| AuthError::DatabaseError(e.to_string()))?
                    .ok_or(AuthError::ResetPasswordFailed)?;
                verify_reset_otp_for_user(redis, config, &user, &req.code).await?;
                user
            }
            PasswordIdentifier::Channel(channel, target) => {
                validate_otp_target(channel, &target)?;
                OtpService::verify(
                    redis,
                    config,
                    OtpPurpose::PasswordReset,
                    channel,
                    &target,
                    &req.code,
                )
                .await?;
                let user = match channel {
                    OtpChannel::Phone => Self::find_user_by_phone(db, &target).await?,
                    OtpChannel::Email => Self::find_user_by_email(db, &target).await?,
                }
                .ok_or(AuthError::ResetPasswordFailed)?;
                user
            }
        };

        Self::ensure_active(&user)?;
        Self::update_password_hash(db, config, &user, &req.new_password).await?;
        tracing::info!(event = "auth.password.reset", user_id = %user.id, success = true);
        Ok(())
    }

    pub async fn change_password(
        db: &database::Storage,
        redis: &RedisPool,
        config: &Configure,
        user_id: &str,
        token: &str,
        token_exp: i64,
        req: PasswordP,
    ) -> Result<(), AuthError> {
        validate_password_strength(&req.new_password)?;

        let user = Self::find_user(db, user_id).await?;
        let old_valid = verify_password(
            &req.old_password,
            &user.password,
            &config.encryption(),
            config.aes_key(),
        )?;
        if !old_valid {
            return Err(AuthError::WrongOldPassword);
        }

        let same_as_old = verify_password(
            &req.new_password,
            &user.password,
            &config.encryption(),
            config.aes_key(),
        )?;
        if same_as_old {
            return Err(AuthError::InvalidParameter(
                "新密码不能与旧密码相同".to_string(),
            ));
        }

        Self::update_password_hash(db, config, &user, &req.new_password).await?;
        Self::signout(redis, token, token_exp).await?;
        tracing::info!(event = "auth.password.change", user_id = %user.id, success = true);
        Ok(())
    }

    pub async fn signin(
        db: &database::Storage,
        redis: &RedisPool,
        req: SigninP,
        config: &Configure,
    ) -> Result<SigninR, AuthError> {
        Self::check_signin_failures(redis, config, &req.username).await?;

        CaptchaService::verify(
            config,
            req.captcha_kind.as_deref(),
            &req.captcha_key,
            &req.captcha_value,
        )
        .await?;

        let user = auth::Entity::find_by_username(&req.username)
            .one(db.raw())
            .await
            .map_err(|e| AuthError::DatabaseError(e.to_string()))?
            .ok_or(AuthError::UserNotFound)?;

        let is_valid = verify_password(
            &req.password,
            &user.password,
            &config.encryption(),
            config.aes_key(),
        )?;

        if !is_valid {
            Self::record_signin_fail(redis, config, &req.username).await?;
            tracing::info!(
                event = "auth.signin",
                username = %req.username,
                success = false,
                reason = "invalid_password"
            );
            return Err(AuthError::InvalidPassword);
        }

        Self::clear_signin_fail(redis, &req.username).await?;
        let response = Self::issue_token(&user, config)?;
        tracing::info!(
            event = "auth.signin",
            username = %user.username,
            success = true
        );
        Ok(response)
    }

    pub async fn signin_phone(
        db: &database::Storage,
        redis: &RedisPool,
        req: PhoneSigninP,
        config: &Configure,
    ) -> Result<SigninR, AuthError> {
        validate_phone(&req.phone)?;

        OtpService::verify(
            redis,
            config,
            OtpPurpose::Login,
            OtpChannel::Phone,
            &req.phone,
            &req.code,
        )
        .await?;

        let user = Self::find_user_by_phone(db, &req.phone)
            .await?
            .ok_or(AuthError::UserNotFound)?;

        Self::ensure_active(&user)?;
        let response = Self::issue_token(&user, config)?;
        tracing::info!(event = "auth.signin.phone", success = true);
        Ok(response)
    }

    pub async fn signin_email(
        db: &database::Storage,
        redis: &RedisPool,
        req: EmailSigninP,
        config: &Configure,
    ) -> Result<SigninR, AuthError> {
        validate_email(&req.email)?;

        OtpService::verify(
            redis,
            config,
            OtpPurpose::Login,
            OtpChannel::Email,
            &req.email,
            &req.code,
        )
        .await?;

        let user = Self::find_user_by_email(db, &req.email)
            .await?
            .ok_or(AuthError::UserNotFound)?;

        Self::ensure_active(&user)?;
        let response = Self::issue_token(&user, config)?;
        tracing::info!(event = "auth.signin.email", success = true);
        Ok(response)
    }

    pub async fn signup(
        db: &database::Storage,
        _redis: &RedisPool,
        req: SignupP,
        config: &Configure,
    ) -> Result<SignupR, AuthError> {
        CaptchaService::verify(
            config,
            req.captcha_kind.as_deref(),
            &req.captcha_key,
            &req.captcha_value,
        )
        .await?;

        let existing = auth::Entity::find_by_username(&req.username)
            .one(db.raw())
            .await
            .map_err(|e| AuthError::DatabaseError(e.to_string()))?;

        if existing.is_some() {
            return Err(AuthError::UserAlreadyExists);
        }

        validate_password_strength(&req.password)?;

        let encrypted_password =
            encrypt_password(&req.password, &config.encryption(), config.aes_key())?;

        let now = Utc::now().fixed_offset();
        let user = auth::ActiveModel {
            id: Set(Uuid::new_v4()),
            username: Set(req.username),
            password: Set(encrypted_password),
            email: Set(None),
            phone: Set(None),
            age: Set(None),
            gender: Set(None),
            birthday: Set(None),
            avatar: Set(None),
            role: Set(PlatformRole::User.as_str().to_string()),
            status: Set(AccountStatus::Active.as_str().to_string()),
            archived_at: Set(None),
            created_at: Set(now),
            creator: Set(None),
            updated_at: Set(now),
            updater: Set(None),
            expires_at: Set(None),
        }
        .insert(db.raw())
        .await
        .map_err(map_db_err)?;

        let token = generate_token(
            &user.id.to_string(),
            &user.username,
            PlatformRole::User,
            config.jwt_secret(),
            None,
        )?;

        Ok(SignupR {
            token,
            auth: user.into(),
        })
    }

    pub async fn toRead(db: &database::Storage, user_id: &str) -> Result<ProfileR, AuthError> {
        let user = Self::find_user(db, user_id).await?;
        let avatar = load_avatar_of(db, user.id, user.avatar).await?;
        Ok(ProfileR::from_user(user, avatar))
    }

    pub async fn signout(redis: &RedisPool, token: &str, exp: i64) -> Result<(), AuthError> {
        let now = Utc::now().timestamp();
        let ttl = (exp - now).max(1);
        blacklist::add(redis, token, ttl)
            .await
            .map_err(|e| AuthError::CacheError(e.to_string()))
    }

    pub async fn toUpdate(
        db: &database::Storage,
        user_id: &str,
        req: ProfileP,
    ) -> Result<ProfileR, AuthError> {
        let id = Uuid::parse_str(user_id)
            .map_err(|_| AuthError::InvalidParameter("用户 ID 无效".to_string()))?;
        let user = Self::find_user(db, user_id).await?;

        if let Some(phone) = req.phone.as_ref() {
            phone_free(db, phone, Some(id)).await?;
        }

        let gender = if let Some(value) = req.gender.as_ref() {
            Some(
                Gender::parse(value)
                    .ok_or_else(|| AuthError::InvalidParameter("性别参数无效".to_string()))?
                    .as_str()
                    .to_string(),
            )
        } else {
            None
        };

        let birthday = if let Some(value) = req.birthday.as_ref() {
            Some(ProfileP::parse_birthday(value).ok_or_else(|| {
                AuthError::InvalidParameter("生日格式无效，应为 YYYY-MM-DD".to_string())
            })?)
        } else {
            None
        };

        let mut active: auth::ActiveModel = user.into();
        if let Some(email) = req.email {
            active.email = Set(Some(email));
        }
        if req.phone.is_some() {
            active.phone = Set(req.phone);
        }
        if gender.is_some() {
            active.gender = Set(gender);
        }
        if let Some(date) = birthday {
            active.birthday = Set(Some(date));
            active.age = Set(Some(age_from_birthday(date)));
        }
        if let Some(value) = req.avatar {
            let avatar = match value {
                Some(asset_id) => Some(check_avatar(db, id, &asset_id).await?),
                None => None,
            };
            active.avatar = Set(avatar);
        }

        let now = Utc::now().fixed_offset();
        active.updated_at = Set(now);
        active.updater = Set(Some(id));

        let updated = active.update(db.raw()).await.map_err(|err| {
            if is_unique_violation(&err) {
                AuthError::Profile(ProfileError::PhoneTaken)
            } else {
                AuthError::DatabaseError(err.to_string())
            }
        })?;

        let avatar_model = load_avatar_of(db, id, updated.avatar).await?;
        Ok(ProfileR::from_user(updated, avatar_model))
    }

    async fn find_user(db: &database::Storage, user_id: &str) -> Result<auth::Model, AuthError> {
        let id = Uuid::parse_str(user_id)
            .map_err(|_| AuthError::InvalidParameter("用户 ID 无效".to_string()))?;
        auth::Entity::find_by_id(id)
            .one(db.raw())
            .await
            .map_err(|e| AuthError::DatabaseError(e.to_string()))?
            .ok_or(AuthError::UserNotFound)
    }

    async fn find_user_by_phone(
        db: &database::Storage,
        phone: &str,
    ) -> Result<Option<auth::Model>, AuthError> {
        auth::Entity::find()
            .filter(auth::Column::Phone.eq(phone.trim()))
            .one(db.raw())
            .await
            .map_err(|e| AuthError::DatabaseError(e.to_string()))
    }

    async fn find_user_by_email(
        db: &database::Storage,
        email: &str,
    ) -> Result<Option<auth::Model>, AuthError> {
        auth::Entity::find()
            .filter(auth::Column::Email.eq(email.trim().to_ascii_lowercase()))
            .one(db.raw())
            .await
            .map_err(|e| AuthError::DatabaseError(e.to_string()))
    }

    fn issue_token(user: &auth::Model, config: &Configure) -> Result<SigninR, AuthError> {
        Self::ensure_active(user)?;
        // 声明里的角色只是提示，无法识别的字面量按最小权限签发：
        // 每次请求的授权结论由 `guards::session::Session` 依库重新判定。
        let role = PlatformRole::from_str(&user.role).unwrap_or(PlatformRole::User);
        let token = generate_token(
            &user.id.to_string(),
            &user.username,
            role,
            config.jwt_secret(),
            None,
        )?;
        Ok(SigninR {
            token,
            auth: user.clone().into(),
        })
    }

    fn ensure_active(user: &auth::Model) -> Result<(), AuthError> {
        let status = AccountStatus::from_str(&user.status).unwrap_or(AccountStatus::Disabled);
        if !status.is_active() {
            return Err(AuthError::AccountDisabled);
        }
        Ok(())
    }

    async fn check_signin_failures(
        redis: &RedisPool,
        config: &Configure,
        username: &str,
    ) -> Result<(), AuthError> {
        use fred::interfaces::KeysInterface;

        let key = signin_fail_key(username);
        let fails: Option<i64> = redis
            .pool()
            .get(key)
            .await
            .map_err(|e| AuthError::CacheError(e.to_string()))?;

        if fails.unwrap_or(0) >= config.auth.signin.max_failures as i64 {
            return Err(AuthError::TooManyAttempts);
        }
        Ok(())
    }

    async fn record_signin_fail(
        redis: &RedisPool,
        config: &Configure,
        username: &str,
    ) -> Result<(), AuthError> {
        use fred::interfaces::KeysInterface;

        let key = signin_fail_key(username);
        let count: i64 = redis
            .pool()
            .incr(key.clone())
            .await
            .map_err(|e| AuthError::CacheError(e.to_string()))?;

        if count == 1 {
            let _: () = redis
                .pool()
                .expire(key, 900, None)
                .await
                .map_err(|e| AuthError::CacheError(e.to_string()))?;
        }

        if count >= config.auth.signin.max_failures as i64 {
            return Err(AuthError::TooManyAttempts);
        }
        Ok(())
    }

    async fn clear_signin_fail(redis: &RedisPool, username: &str) -> Result<(), AuthError> {
        use fred::interfaces::KeysInterface;

        redis
            .pool()
            .del::<(), _>(signin_fail_key(username))
            .await
            .map_err(|e| AuthError::CacheError(e.to_string()))?;
        Ok(())
    }

    async fn update_password_hash(
        db: &database::Storage,
        config: &Configure,
        user: &auth::Model,
        new_password: &str,
    ) -> Result<(), AuthError> {
        let encrypted = encrypt_password(new_password, &config.encryption(), config.aes_key())
            .map_err(|_| AuthError::ResetPasswordFailed)?;

        let mut active: auth::ActiveModel = user.clone().into();
        active.password = Set(encrypted);
        active.updated_at = Set(Utc::now().fixed_offset());
        active
            .update(db.raw())
            .await
            .map_err(|e| AuthError::DatabaseError(e.to_string()))?;
        Ok(())
    }
}

fn signin_fail_key(username: &str) -> String {
    format!("auth:signin:fail:{}", username.trim().to_ascii_lowercase())
}

fn validate_phone(phone: &str) -> Result<(), AuthError> {
    let p = phone.trim();
    if p.len() >= 8
        && p.chars()
            .all(|c| c.is_ascii_digit() || c == '+' || c == '-')
    {
        Ok(())
    } else {
        Err(AuthError::InvalidParameter("手机号格式无效".to_string()))
    }
}

fn validate_email(email: &str) -> Result<(), AuthError> {
    let e = email.trim();
    if e.contains('@') && e.len() >= 5 {
        Ok(())
    } else {
        Err(AuthError::InvalidParameter("邮箱格式无效".to_string()))
    }
}

fn validate_otp_target(channel: OtpChannel, target: &str) -> Result<(), AuthError> {
    match channel {
        OtpChannel::Phone => validate_phone(target),
        OtpChannel::Email => validate_email(target),
    }
}

fn validate_password_strength(password: &str) -> Result<(), AuthError> {
    if password.trim().len() < 6 {
        return Err(AuthError::WeakPassword);
    }
    Ok(())
}

enum PasswordIdentifier {
    Username(String),
    Channel(OtpChannel, String),
}

fn parse_password_identifier(
    username: Option<&str>,
    channel: Option<OtpChannel>,
    target: Option<&str>,
) -> Result<PasswordIdentifier, AuthError> {
    let has_username = username.is_some_and(|u| !u.trim().is_empty());
    let has_channel = channel.is_some() && target.is_some_and(|t| !t.trim().is_empty());

    match (has_username, has_channel) {
        (true, false) => Ok(PasswordIdentifier::Username(
            username.unwrap().trim().to_string(),
        )),
        (false, true) => Ok(PasswordIdentifier::Channel(
            channel.unwrap(),
            target.unwrap().trim().to_string(),
        )),
        (false, false) => Err(AuthError::InvalidParameter(
            "请提供 username 或 channel+target".to_string(),
        )),
        (true, true) => Err(AuthError::InvalidParameter(
            "username 与 channel+target 不能同时填写".to_string(),
        )),
    }
}

fn bound_otp_targets(user: &auth::Model) -> Vec<(OtpChannel, String)> {
    let mut targets = Vec::new();
    if let Some(phone) = user.phone.as_ref().filter(|p| !p.trim().is_empty()) {
        targets.push((OtpChannel::Phone, phone.clone()));
    }
    if let Some(email) = user.email.as_ref().filter(|e| !e.trim().is_empty()) {
        targets.push((OtpChannel::Email, email.clone()));
    }
    targets
}

async fn verify_reset_otp_for_user(
    redis: &RedisPool,
    config: &Configure,
    user: &auth::Model,
    code: &str,
) -> Result<(), AuthError> {
    let mut last_err: Option<OtpError> = None;

    if let Some(email) = user.email.as_ref().filter(|e| !e.trim().is_empty()) {
        match OtpService::verify(
            redis,
            config,
            OtpPurpose::PasswordReset,
            OtpChannel::Email,
            email,
            code,
        )
        .await
        {
            Ok(()) => return Ok(()),
            Err(e) => last_err = Some(e),
        }
    }

    if let Some(phone) = user.phone.as_ref().filter(|p| !p.trim().is_empty()) {
        match OtpService::verify(
            redis,
            config,
            OtpPurpose::PasswordReset,
            OtpChannel::Phone,
            phone,
            code,
        )
        .await
        {
            Ok(()) => return Ok(()),
            Err(e) => last_err = Some(e),
        }
    }

    match last_err {
        Some(e) => Err(e.into()),
        None => Err(AuthError::InvalidParameter(
            "账号未绑定手机或邮箱".to_string(),
        )),
    }
}
