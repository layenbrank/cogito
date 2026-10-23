use chrono::NaiveDate;
use entity::{asset, auth};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

const ASSET_URL_PREFIX: &str = "/api/v1/upload/asset";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Gender {
    Male,
    Female,
}

impl Gender {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Male => "MALE",
            Self::Female => "FEMALE",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "MALE" => Some(Self::Male),
            "FEMALE" => Some(Self::Female),
            _ => None,
        }
    }
}

#[derive(Debug, Serialize, Clone, ToSchema)]
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
            url: format!("{ASSET_URL_PREFIX}/{}", asset.id),
            mime: asset.mime,
            name: asset.name,
        }
    }
}

#[derive(Debug, Serialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuthR {
    #[schema(example = "3c430c21-0891-43e1-bcd2-1a22eb4a5389")]
    pub id: String,
    #[schema(example = "admin")]
    pub username: String,
    #[schema(example = "USER")]
    pub role: String,
    #[schema(example = "ACTIVE")]
    pub status: String,
    #[serde(rename = "createdAt")]
    #[schema(example = 1700000000000_i64)]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    #[schema(example = 1700000000000_i64)]
    pub updated_at: i64,
}

impl From<auth::Model> for AuthR {
    fn from(user: auth::Model) -> Self {
        AuthR {
            id: user.id.to_string(),
            username: user.username,
            role: user.role,
            status: user.status,
            created_at: user.created_at.timestamp_millis(),
            updated_at: user.updated_at.timestamp_millis(),
        }
    }
}

#[derive(Debug, Serialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProfileR {
    pub id: String,
    pub username: String,
    pub role: String,
    pub status: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub gender: Option<String>,
    pub birthday: Option<String>,
    pub age: Option<u32>,
    pub avatar: Option<Avatar>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

impl ProfileR {
    pub fn from_user(user: auth::Model, avatar: Option<asset::Model>) -> Self {
        Self {
            id: user.id.to_string(),
            username: user.username,
            role: user.role,
            status: user.status,
            email: user.email,
            phone: user.phone,
            gender: user.gender,
            birthday: user.birthday.map(|d| d.to_string()),
            age: user.age.map(|v| v as u32),
            avatar: avatar.map(Avatar::from),
            created_at: user.created_at.timestamp_millis(),
            updated_at: user.updated_at.timestamp_millis(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
#[schema(example = json!({
    "username": "admin",
    "password": "123456",
    "captchaKey": "xxxx-xxxxx",
    "captchaValue": "120"
}))]
pub struct SigninP {
    /// 用户名
    #[schema(example = "admin", default = "admin", required)]
    pub username: String,
    /// 密码
    #[schema(example = "123456", default = "123456", required)]
    pub password: String,
    /// 行为验证码 key（来自 `POST /api/v1/auth/captcha` 的 `data.captchaKey`）
    #[serde(rename = "captchaKey")]
    #[schema(example = "xxxx-xxxxx", required)]
    pub captcha_key: String,
    /// 滑块 X 偏移或点选坐标（与 go-captcha-service `check-data` 的 `value` 一致）
    #[serde(rename = "captchaValue")]
    #[schema(example = "120", required)]
    pub captcha_value: String,
    /// 题型 ID，默认 `auth.captcha.kind`（如 `slide-default`）
    #[serde(rename = "captchaKind", default)]
    #[schema(example = "slide-default")]
    pub captcha_kind: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
#[schema(example = json!({
    "username": "newuser",
    "password": "123456",
    "captchaKey": "xxxx-xxxxx",
    "captchaValue": "120"
}))]
pub struct SignupP {
    /// 用户名（唯一）
    #[schema(example = "newuser", required)]
    pub username: String,
    /// 密码
    #[schema(example = "123456", required)]
    pub password: String,
    #[serde(rename = "captchaKey")]
    #[schema(example = "xxxx-xxxxx", required)]
    pub captcha_key: String,
    #[serde(rename = "captchaValue")]
    #[schema(example = "120", required)]
    pub captcha_value: String,
    #[serde(rename = "captchaKind", default)]
    #[schema(example = "slide-default")]
    pub captcha_kind: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaptchaP {
    /// 题型 ID，默认 `auth.captcha.kind`
    #[schema(example = "slide-default")]
    pub kind: Option<String>,
}

#[derive(Debug, Serialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaptchaR {
    /// 题型 ID（如 `slide-default`）
    #[schema(example = "slide-default")]
    pub kind: String,
    /// 提交登录/注册/OTP 时作为 `captchaKey`
    #[schema(example = "xxxx-xxxxx")]
    pub captcha_key: String,
    /// 主图 Base64（对齐 go-captcha-react `data.image`）
    #[schema(example = "/9j/4AAQSkZJRg...")]
    pub master_image: String,
    /// 滑块/拼图块 Base64（对齐 `data.thumb`）
    #[schema(example = "iVBORw0KGgo...")]
    pub thumb_image: String,
    #[schema(example = 0)]
    pub thumb_x: i32,
    #[schema(example = 80)]
    pub thumb_y: i32,
    #[schema(example = 60)]
    pub thumb_width: i32,
    #[schema(example = 60)]
    pub thumb_height: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OtpChannel {
    Phone,
    Email,
}

impl OtpChannel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Phone => "phone",
            Self::Email => "email",
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "channel": "PHONE",
    "target": "13800138000",
    "captchaKey": "xxxx-xxxxx",
    "captchaValue": "120"
}))]
pub struct OtpP {
    #[schema(example = "PHONE", required)]
    pub channel: OtpChannel,
    /// 手机号或邮箱
    #[schema(example = "13800138000", required)]
    pub target: String,
    #[serde(rename = "captchaKey")]
    #[schema(example = "xxxx-xxxxx", required)]
    pub captcha_key: String,
    #[serde(rename = "captchaValue")]
    #[schema(example = "120", required)]
    pub captcha_value: String,
    #[serde(rename = "captchaKind", default)]
    #[schema(example = "slide-default")]
    pub captcha_kind: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "phone": "13800138000",
    "code": "123456"
}))]
pub struct PhoneSigninP {
    /// 手机号（须已绑定账号）
    #[schema(example = "13800138000", required)]
    pub phone: String,
    /// OTP 六位数字
    #[schema(example = "123456", required)]
    pub code: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "email": "admin@example.com",
    "code": "123456"
}))]
pub struct EmailSigninP {
    /// 邮箱（须已绑定账号）
    #[schema(example = "admin@example.com", required)]
    pub email: String,
    /// OTP 六位数字
    #[schema(example = "123456", required)]
    pub code: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "username": "admin",
    "captchaKey": "xxxx-xxxxx",
    "captchaValue": "120"
}))]
pub struct ForgotPasswordP {
    #[schema(example = "admin")]
    pub username: Option<String>,
    pub channel: Option<OtpChannel>,
    #[schema(example = "13800138000")]
    pub target: Option<String>,
    #[serde(rename = "captchaKey")]
    #[schema(example = "xxxx-xxxxx", required)]
    pub captcha_key: String,
    #[serde(rename = "captchaValue")]
    #[schema(example = "120", required)]
    pub captcha_value: String,
    #[serde(rename = "captchaKind", default)]
    #[schema(example = "slide-default")]
    pub captcha_kind: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "channel": "PHONE",
    "target": "13800138000",
    "code": "123456",
    "newPassword": "654321"
}))]
pub struct ResetPasswordP {
    pub username: Option<String>,
    pub channel: Option<OtpChannel>,
    #[schema(example = "13800138000")]
    pub target: Option<String>,
    #[schema(example = "123456", required)]
    pub code: String,
    #[serde(rename = "newPassword")]
    #[schema(example = "654321", required)]
    pub new_password: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "oldPassword": "123456",
    "newPassword": "654321"
}))]
pub struct PasswordP {
    #[serde(rename = "oldPassword")]
    #[schema(example = "123456", required)]
    pub old_password: String,
    #[serde(rename = "newPassword")]
    #[schema(example = "654321", required)]
    pub new_password: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({
    "email": "admin@example.com",
    "phone": "13800138000",
    "gender": "MALE",
    "birthday": "1990-01-01",
    "avatar": "550e8400-e29b-41d4-a716-446655440000"
}))]
pub struct ProfileP {
    #[schema(example = "admin@example.com")]
    pub email: Option<String>,
    #[schema(example = "13800138000")]
    pub phone: Option<String>,
    #[schema(example = "MALE")]
    pub gender: Option<String>,
    #[schema(example = "1990-01-01")]
    pub birthday: Option<String>,
    #[schema(example = "550e8400-e29b-41d4-a716-446655440000")]
    pub avatar: Option<Option<String>>,
}

impl ProfileP {
    pub fn parse_birthday(value: &str) -> Option<NaiveDate> {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
    }
}

#[derive(Debug, Serialize, Clone, ToSchema)]
pub struct SigninR {
    /// JWT；Apifox 请写入环境变量 `token`，鉴权填 `{{token}}`
    #[schema(example = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example")]
    pub token: String,
    #[serde(flatten)]
    pub auth: AuthR,
}

#[derive(Debug, Serialize, Clone, ToSchema)]
pub struct SignupR {
    #[schema(example = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example")]
    pub token: String,
    #[serde(flatten)]
    pub auth: AuthR,
}

#[cfg(test)]
mod tests {
    use super::{Gender, ProfileP};

    #[test]
    fn gender_roundtrip() {
        assert_eq!(Gender::parse("MALE"), Some(Gender::Male));
        assert_eq!(Gender::parse("FEMALE"), Some(Gender::Female));
        assert_eq!(Gender::Male.as_str(), "MALE");
        assert_eq!(Gender::Female.as_str(), "FEMALE");
        assert_eq!(Gender::parse("OTHER"), None);
        assert_eq!(Gender::parse("invalid"), None);
    }

    #[test]
    fn birthday_parse() {
        let date = ProfileP::parse_birthday("1990-01-01");
        assert!(date.is_some());
        assert_eq!(date.unwrap().format("%Y-%m-%d").to_string(), "1990-01-01");
    }
}
