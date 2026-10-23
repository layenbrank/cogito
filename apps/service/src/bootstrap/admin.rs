//! 启动时幂等就位平台超级管理员（`auth.role = ADMIN`）。
//!
//! Backend Console（`apps/backend`）全挂 `Auth::admin()`，公开注册只会建 `USER`，
//! 没有这条种子就永远进不了管理面。凭据来自 `auth.bootstrap_admin`（YAML / `COGITO__AUTH__BOOTSTRAP_ADMIN__*`）。

use chrono::Utc;
use entity::auth;
use identity::{AccountStatus, PlatformRole};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
use uuid::Uuid;

use crate::configures::configure::Configure;
use crate::databases::database::Storage;
use crate::utils::encryption::encrypt_password;

/// 按配置确保平台 ADMIN 账号存在且可用。
///
/// - 未启用配置：直接返回 Ok
/// - 账号不存在：创建 `ADMIN` + `ACTIVE`
/// - 账号已存在：补升 `ADMIN` / 启停为 `ACTIVE`；仅当 `sync_password` 时改密
pub async fn ensure_bootstrap_admin(
    storage: &Storage,
    config: &Configure,
) -> Result<(), BootstrapAdminError> {
    let bootstrap = &config.auth.bootstrap_admin;
    if !bootstrap.is_enabled() {
        tracing::debug!("auth.bootstrap_admin 未配置，跳过平台管理员种子");
        return Ok(());
    }

    let username = bootstrap.username.trim();
    let password = bootstrap.password.as_str();
    let now = Utc::now().fixed_offset();
    let encrypted = encrypt_password(password, &config.encryption(), config.aes_key())
        .map_err(BootstrapAdminError::Encryption)?;

    let existing = auth::Entity::find()
        .filter(auth::Column::Username.eq(username))
        .one(storage.raw())
        .await
        .map_err(|e| BootstrapAdminError::Database(e.to_string()))?;

    match existing {
        None => {
            auth::ActiveModel {
                id: Set(Uuid::new_v4()),
                username: Set(username.to_string()),
                password: Set(encrypted),
                email: Set(None),
                phone: Set(None),
                age: Set(None),
                gender: Set(None),
                birthday: Set(None),
                avatar: Set(None),
                role: Set(PlatformRole::Admin.as_str().to_string()),
                status: Set(AccountStatus::Active.as_str().to_string()),
                archived_at: Set(None),
                created_at: Set(now),
                creator: Set(None),
                updated_at: Set(now),
                updater: Set(None),
                expires_at: Set(None),
            }
            .insert(storage.raw())
            .await
            .map_err(|e| BootstrapAdminError::Database(e.to_string()))?;

            tracing::info!(
                username,
                "已创建平台超级管理员（auth.bootstrap_admin）"
            );
        }
        Some(user) => {
            let mut active: auth::ActiveModel = user.clone().into();
            let mut changed = false;

            if user.role != PlatformRole::Admin.as_str() {
                active.role = Set(PlatformRole::Admin.as_str().to_string());
                changed = true;
            }
            if user.status != AccountStatus::Active.as_str() {
                active.status = Set(AccountStatus::Active.as_str().to_string());
                changed = true;
            }
            if bootstrap.sync_password {
                active.password = Set(encrypted);
                changed = true;
            }

            if changed {
                active.updated_at = Set(now);
                active
                    .update(storage.raw())
                    .await
                    .map_err(|e| BootstrapAdminError::Database(e.to_string()))?;
                tracing::info!(
                    username,
                    sync_password = bootstrap.sync_password,
                    "已更新平台超级管理员（auth.bootstrap_admin）"
                );
            } else {
                tracing::debug!(username, "平台超级管理员已就位，无需变更");
            }
        }
    }

    Ok(())
}

#[derive(Debug, thiserror::Error)]
pub enum BootstrapAdminError {
    #[error("加密密码失败: {0}")]
    Encryption(#[from] crate::utils::encryption::EncryptionError),
    #[error("数据库错误: {0}")]
    Database(String),
}
