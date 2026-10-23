use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SsoConnectionWriteP {
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    /// oidc / saml（saml 预留）
    pub provider: String,
    pub issuer: String,
    #[serde(rename = "clientID")]
    pub client_id: String,
    /// 明文 client secret；入库前 AES 加密
    pub client_secret: Option<String>,
    pub redirect_uri: String,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SsoConnectionUpdateP {
    pub provider: Option<String>,
    pub issuer: Option<String>,
    #[serde(rename = "clientID")]
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub redirect_uri: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SsoConnectionR {
    pub id: String,
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    pub provider: String,
    pub issuer: String,
    #[serde(rename = "clientID")]
    pub client_id: String,
    pub redirect_uri: String,
    pub status: String,
    pub has_client_secret: bool,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SsoLoginR {
    /// JWT，登录成功后前端持有
    pub token: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SsoCallbackP {
    pub code: String,
    pub state: String,
}
