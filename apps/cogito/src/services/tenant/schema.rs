use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// 租户内角色：OWNER / ADMIN / MEMBER
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TenantRole {
    Owner,
    Admin,
    Member,
}

impl TenantRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "OWNER",
            Self::Admin => "ADMIN",
            Self::Member => "MEMBER",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "OWNER" => Some(Self::Owner),
            "ADMIN" => Some(Self::Admin),
            "MEMBER" => Some(Self::Member),
            _ => None,
        }
    }

    /// 领域角色 → 契约角色。
    ///
    /// 两侧字面量一一对应；领域侧新增角色而这里没跟上时按最小权限（`MEMBER`）处理，
    /// 不放大权限。
    pub fn from_domain(role: identity::TenantRole) -> Self {
        Self::parse(role.as_str()).unwrap_or(Self::Member)
    }

    /// 能否管理租户（改租户/成员）
    ///
    /// 迁移遗留：新代码用 `authz` 判定权限，本方法只服务订阅 / 支付尚未迁走的分支。
    pub fn can_manage(self) -> bool {
        matches!(self, Self::Owner | Self::Admin)
    }
}

/// 租户类型：PERSONAL（个人，走免费/订阅档位）/ TEAM（团队，走全局兜底）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TenantType {
    Personal,
    Team,
}

impl TenantType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Personal => "PERSONAL",
            Self::Team => "TEAM",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "PERSONAL" => Some(Self::Personal),
            "TEAM" => Some(Self::Team),
            _ => None,
        }
    }

    /// 仅当明确解析为 `PERSONAL` 才算个人租户（走免费/订阅档位）；
    /// 未知 / 脏值一律按团队处理，与 gateway 侧保持一致。
    pub fn is_personal(value: &str) -> bool {
        matches!(Self::parse(value), Some(Self::Personal))
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TenantWriteP {
    pub name: String,
    /// 唯一标识（小写字母/数字/中划线）
    pub slug: String,
    /// PERSONAL / TEAM；缺省 PERSONAL
    pub r#type: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TenantUpdateP {
    pub name: Option<String>,
    pub status: Option<String>,
    /// PERSONAL / TEAM
    pub r#type: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TenantR {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub status: String,
    /// PERSONAL / TEAM
    pub r#type: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemberWriteP {
    #[serde(rename = "userID")]
    pub user_id: String,
    /// OWNER / ADMIN / MEMBER
    pub role: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemberUpdateP {
    pub role: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemberR {
    pub id: String,
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    #[serde(rename = "userID")]
    pub user_id: String,
    pub role: String,
    pub status: String,
    /// 展示用：账号用户名；账号已删则为 null
    pub username: Option<String>,
    /// 展示用：邮箱；可能为空
    pub email: Option<String>,
}

/// 平台运维面：租户列表查询
#[derive(Debug, Clone, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminTenantQueryP {
    /// 名称 / slug 模糊搜索
    pub q: Option<String>,
    /// PERSONAL / TEAM
    #[serde(rename = "type")]
    pub tenant_type: Option<String>,
    /// ACTIVE / DISABLED
    pub status: Option<String>,
    /// 页码，从 1 起，默认 1
    pub page: Option<u32>,
    /// 每页条数 1–100，默认 50
    pub size: Option<u32>,
}

/// 平台运维面：租户摘要（列表行）
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TenantSummaryR {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub status: String,
    /// PERSONAL / TEAM
    pub r#type: String,
    #[serde(rename = "memberCount")]
    pub member_count: u64,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

/// 平台运维面：租户详情聚合
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TenantDetailR {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub status: String,
    pub r#type: String,
    #[serde(rename = "memberCount")]
    pub member_count: u64,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    pub members: Vec<MemberR>,
    pub subscriptions: Vec<crate::services::subscription::schema::SubscriptionR>,
    pub quota: Option<crate::services::subscription::schema::QuotaR>,
    /// 近期审计（最多 20 条）；读失败时为空数组
    #[serde(rename = "recentAudit")]
    pub recent_audit: Vec<crate::services::gateway::schema::AuditR>,
}

/// 用户所属租户（后台联查）
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserTenantR {
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    pub name: String,
    pub slug: String,
    pub status: String,
    pub r#type: String,
    /// 该用户在租户内的角色
    pub role: String,
    /// 成员关系状态 ACTIVE / DISABLED
    #[serde(rename = "memberStatus")]
    pub member_status: String,
}
