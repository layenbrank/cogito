use chrono::{DateTime, Utc};
use entity::{asset, auth};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::utils::timestamp::{from_ts, to_ts};

/// 后台管理员创建用户
#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "username": "alice",
    "password": "123456",
    "role": "USER"
}))]
pub struct WriteP {
    #[schema(example = "alice")]
    pub username: String,
    #[schema(example = "123456")]
    pub password: String,
    /// USER / ADMIN，默认 USER
    #[schema(example = "USER")]
    pub role: Option<String>,
}

/// 后台管理员更新用户（账号/密码/资料运维）
/// 用户自助修改个人信息请使用 PUT /api/v1/auth/profile
#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "username": "alice",
    "email": "alice@example.com",
    "phone": "13800138000",
    "gender": "FEMALE",
    "birthday": "1990-01-01",
    "age": 30,
    "role": "USER",
    "status": "ACTIVE"
}))]
pub struct UpdateP {
    #[schema(example = "alice")]
    pub username: Option<String>,
    #[schema(example = "123456")]
    pub password: Option<String>,
    #[schema(example = "alice@example.com")]
    pub email: Option<String>,
    #[schema(example = "13800138000")]
    pub phone: Option<String>,
    #[schema(example = "FEMALE")]
    pub gender: Option<String>,
    #[schema(example = "1990-01-01")]
    pub birthday: Option<String>,
    #[schema(example = 30)]
    pub age: Option<u32>,
    #[schema(example = "550e8400-e29b-41d4-a716-446655440000")]
    pub avatar: Option<Option<String>>,
    #[schema(example = "USER")]
    pub role: Option<String>,
    #[schema(example = "ACTIVE")]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Avatar {
    #[schema(example = "550e8400-e29b-41d4-a716-446655440000")]
    pub id: String,
    #[schema(example = "/api/v1/upload/asset/550e8400-e29b-41d4-a716-446655440000")]
    pub url: String,
    #[schema(example = "image/png")]
    pub mime: String,
    #[schema(example = "avatar.png")]
    pub name: String,
}

impl From<asset::Model> for Avatar {
    fn from(asset: asset::Model) -> Self {
        Self {
            id: asset.id.to_string(),
            url: format!("/api/v1/upload/files/{}", asset.hash),
            mime: asset.mime,
            name: asset.name,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserR {
    #[schema(example = "3c430c21-0891-43e1-bcd2-1a22eb4a5389")]
    pub id: String,
    #[schema(example = "admin")]
    pub username: String,
    #[schema(example = "USER")]
    pub role: String,
    #[schema(example = "ACTIVE")]
    pub status: String,
    #[schema(example = "admin@example.com")]
    pub email: Option<String>,
    #[schema(example = "13800138000")]
    pub phone: Option<String>,
    #[schema(example = "MALE")]
    pub gender: Option<String>,
    #[schema(example = "1990-01-01")]
    pub birthday: Option<String>,
    #[schema(example = 30)]
    pub age: Option<u32>,
    pub avatar: Option<Avatar>,
    #[serde(serialize_with = "to_ts", deserialize_with = "from_ts")]
    #[schema(value_type = i64, example = 1700000000000_i64)]
    pub created_at: DateTime<Utc>,
    #[serde(serialize_with = "to_ts", deserialize_with = "from_ts")]
    #[schema(value_type = i64, example = 1700000000000_i64)]
    pub updated_at: DateTime<Utc>,
}

impl UserR {
    pub fn from_parts(value: auth::Model, avatar: Option<asset::Model>) -> Self {
        UserR {
            id: value.id.to_string(),
            username: value.username,
            role: value.role,
            status: value.status,
            email: value.email,
            phone: value.phone,
            gender: value.gender,
            birthday: value.birthday.map(|d| d.to_string()),
            age: value.age.map(|v| v as u32),
            avatar: avatar.map(Avatar::from),
            created_at: value.created_at.with_timezone(&Utc),
            updated_at: value.updated_at.with_timezone(&Utc),
        }
    }
}
