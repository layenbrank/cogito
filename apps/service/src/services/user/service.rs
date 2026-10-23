use chrono::Utc;
use entity::auth;
use identity::{AccountStatus, PlatformRole};
use sea_orm::{ActiveModelTrait, EntityTrait, Set};
use std::str::FromStr;
use uuid::Uuid;

use crate::{
    configures::configure::Configure,
    databases::database::Storage,
    filters::exception::Exception,
    guards::asset::AssetReader,
    services::{
        auth::{
            schema::{Gender, ProfileP},
            service::{
                ProfileError, age_from_birthday, check_avatar, load_avatar, load_avatar_of,
                phone_free,
            },
        },
        user::schema::{UpdateP, UserR, WriteP},
    },
    utils::{
        code::{business, request},
        db::is_unique_violation,
        encryption::{EncryptionError, encrypt_password},
    },
};

#[derive(Debug, thiserror::Error)]
pub enum UserError {
    #[error("User already exists")]
    UserAlreadyExists,
    #[error("User not found")]
    UserNotFound,
    #[error("Invalid user ID")]
    InvalidId,
    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
    #[error(transparent)]
    Profile(#[from] ProfileError),
    #[error("Encryption error: {0}")]
    EncryptionError(#[from] EncryptionError),
    #[error("Database error: {0}")]
    DatabaseError(String),
}

impl From<UserError> for Exception {
    fn from(err: UserError) -> Self {
        match err {
            UserError::UserAlreadyExists => {
                Exception::custom(business::user::USERNAME_EXISTS, "用户名已存在")
            }
            UserError::UserNotFound => Exception::custom(business::user::NOT_FOUND, "用户不存在"),
            UserError::InvalidId => {
                Exception::custom(request::INVALID_PARAMETER_VALUE, "用户 ID 无效")
            }
            UserError::InvalidParameter(msg) => {
                Exception::custom(request::INVALID_PARAMETER_VALUE, msg)
            }
            UserError::Profile(e) => Exception::from(e),
            UserError::EncryptionError(_) => Exception::internal_error("加密服务异常"),
            UserError::DatabaseError(msg) => {
                tracing::error!(error = %msg, "user database error");
                Exception::custom(crate::utils::code::external::DATABASE_ERROR, "数据库错误")
            }
        }
    }
}

fn map_db_err(err: sea_orm::DbErr) -> UserError {
    if is_unique_violation(&err) {
        UserError::UserAlreadyExists
    } else {
        UserError::DatabaseError(err.to_string())
    }
}

pub enum ReadR {
    One(UserR),
    Many(Vec<UserR>),
}

pub struct UserService;

impl UserService {
    pub async fn toWrite(
        db: &Storage,
        config: &Configure,
        req: WriteP,
    ) -> Result<UserR, UserError> {
        if auth::Entity::find_by_username(&req.username)
            .one(db.raw())
            .await
            .map_err(|e| UserError::DatabaseError(e.to_string()))?
            .is_some()
        {
            return Err(UserError::UserAlreadyExists);
        }

        let password = encrypt_password(&req.password, &config.encryption(), config.aes_key())?;
        let role = match req.role.as_deref() {
            None => PlatformRole::User,
            Some(v) => PlatformRole::from_str(v)
                .map_err(|_| UserError::InvalidParameter("角色无效，应为 USER 或 ADMIN".into()))?,
        };
        let now = Utc::now().fixed_offset();
        let user = auth::ActiveModel {
            id: Set(Uuid::new_v4()),
            username: Set(req.username),
            password: Set(password),
            email: Set(None),
            phone: Set(None),
            age: Set(None),
            gender: Set(None),
            birthday: Set(None),
            avatar: Set(None),
            role: Set(role.as_str().to_string()),
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

        Ok(UserR::from_parts(user, None))
    }

    pub async fn toRead(db: &Storage, id: Option<&str>) -> Result<ReadR, UserError> {
        match id {
            Some(id) => {
                let user = Self::find_model(db, id).await?;
                let avatar = load_avatar_of(db, user.id, user.avatar).await?;
                Ok(ReadR::One(UserR::from_parts(user, avatar)))
            }
            None => {
                let users = auth::Entity::find()
                    .all(db.raw())
                    .await
                    .map_err(|e| UserError::DatabaseError(e.to_string()))?;

                // 列表是批量公开视图：一个匿名读事务读完全部头像，不给每个账号单开作用域；
                // 因此只读得到 `PUBLIC` 的头像（绑定头像时会提升为 PUBLIC，见 auth::check_avatar）。
                let reader = AssetReader::enter(db, None)
                    .await
                    .map_err(|e| UserError::DatabaseError(e.to_string()))?;

                let mut result = Vec::with_capacity(users.len());
                for user in users {
                    let avatar = load_avatar(reader.tx(), user.avatar).await?;
                    result.push(UserR::from_parts(user, avatar));
                }

                reader
                    .rollback()
                    .await
                    .map_err(|e| UserError::DatabaseError(e.to_string()))?;

                Ok(ReadR::Many(result))
            }
        }
    }

    pub async fn toUpdate(
        db: &Storage,
        config: &Configure,
        id: &str,
        req: UpdateP,
    ) -> Result<UserR, UserError> {
        let user_id = Uuid::parse_str(id).map_err(|_| UserError::InvalidId)?;
        let model = Self::find_model(db, id).await?;

        if let Some(phone) = req.phone.as_ref() {
            phone_free(db, phone, Some(user_id)).await?;
        }

        let gender = if let Some(value) = req.gender.as_ref() {
            Some(
                Gender::parse(value)
                    .ok_or_else(|| UserError::InvalidParameter("性别参数无效".to_string()))?
                    .as_str()
                    .to_string(),
            )
        } else {
            None
        };

        let birthday = if let Some(value) = req.birthday.as_ref() {
            Some(ProfileP::parse_birthday(value).ok_or_else(|| {
                UserError::InvalidParameter("生日格式无效，应为 YYYY-MM-DD".to_string())
            })?)
        } else {
            None
        };

        let mut active: auth::ActiveModel = model.into();
        if let Some(username) = req.username {
            active.username = Set(username);
        }
        if let Some(password) = req.password {
            active.password = Set(encrypt_password(
                &password,
                &config.encryption(),
                config.aes_key(),
            )?);
        }
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
        if let Some(age) = req.age {
            active.age = Set(Some(age as i32));
        }
        if let Some(value) = req.avatar {
            let avatar = match value {
                Some(asset_id) => Some(check_avatar(db, user_id, &asset_id).await?),
                None => None,
            };
            active.avatar = Set(avatar);
        }
        if let Some(role) = req.role {
            let role = PlatformRole::from_str(&role)
                .map_err(|_| UserError::InvalidParameter("角色无效，应为 USER 或 ADMIN".into()))?;
            active.role = Set(role.as_str().to_string());
        }
        if let Some(status) = req.status {
            let status = AccountStatus::from_str(&status).map_err(|_| {
                UserError::InvalidParameter("状态无效，应为 ACTIVE 或 DISABLED".into())
            })?;
            active.status = Set(status.as_str().to_string());
        }
        active.updated_at = Set(Utc::now().fixed_offset());

        let updated = active.update(db.raw()).await.map_err(|err| {
            if is_unique_violation(&err) {
                UserError::Profile(ProfileError::PhoneTaken)
            } else {
                UserError::DatabaseError(err.to_string())
            }
        })?;

        let avatar_model = load_avatar_of(db, user_id, updated.avatar).await?;
        Ok(UserR::from_parts(updated, avatar_model))
    }

    pub async fn toRemove(db: &Storage, id: &str) -> Result<(), UserError> {
        let id = Uuid::parse_str(id).map_err(|_| UserError::InvalidId)?;
        let result = auth::Entity::delete_by_id(id)
            .exec(db.raw())
            .await
            .map_err(|e| UserError::DatabaseError(e.to_string()))?;

        if result.rows_affected == 0 {
            return Err(UserError::UserNotFound);
        }

        Ok(())
    }

    async fn find_model(db: &Storage, id: &str) -> Result<auth::Model, UserError> {
        let id = Uuid::parse_str(id).map_err(|_| UserError::InvalidId)?;
        auth::Entity::find_by_id(id)
            .one(db.raw())
            .await
            .map_err(|e| UserError::DatabaseError(e.to_string()))?
            .ok_or(UserError::UserNotFound)
    }
}
