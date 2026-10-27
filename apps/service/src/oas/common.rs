use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::services::{
    agent::schema::{ApprovalR, TaskR},
    application::schema::App,
    auth::schema::{AuthR, Avatar, CaptchaR, ProfileR, SigninR, SignupR},
    chat::schema::{ChatChangesR, ChatSyncR},
    console::schema::PreferenceR,
    engine::schema::SuggestionR,
    exception::schema::{ExceptionR, GroupPageR, PageR, SummaryR},
    gateway::schema::{ModelR, PlansR, ProviderR, SelfQuotaR},
    payment::schema::{CatalogR, OrderR, PriceR, ReconcileR},
    rag::schema::{IndexTaskR, SearchR},
    sso::schema::{SsoConnectionR, SsoLoginR},
    subscription::schema::{QuotaR, SubscriptionR},
    tenant::schema::{MemberR, TenantR},
    upload::schema::{ChunkR, FilesR, FinalizeR, HashR, PrepareR, ProgressR},
    user::schema::UserR,
};

/// 生成具象 Envelope schema（OpenAPI 不支持泛型包装）
macro_rules! envelope {
    ($name:ident, $data:ty) => {
        #[derive(Debug, Serialize, ToSchema)]
        #[serde(rename_all = "camelCase")]
        pub struct $name {
            /// 业务状态码（200000=成功）
            pub code: i32,
            pub success: bool,
            pub msg: String,
            pub data: Option<$data>,
            pub timestamp: i64,
            /// 链路追踪 ID（W3C `traceparent` 的 trace-id），用于串联入口日志与下游调用
            // 运行时信封没有 rename_all，字段名本身就是 traceID，这里显式覆盖 camelCase
            #[serde(rename = "traceID")]
            pub traceID: Option<String>,
        }
    };
}

envelope!(CaptchaEnvelope, CaptchaR);
envelope!(HealthEnvelope, Health);
envelope!(LivenessEnvelope, Liveness);
envelope!(ReadinessEnvelope, Readiness);
envelope!(SigninEnvelope, SigninR);
envelope!(SignupEnvelope, SignupR);
envelope!(ProfileEnvelope, ProfileR);
envelope!(UserEnvelope, UserR);
envelope!(UserListEnvelope, Vec<UserR>);
envelope!(PreferenceEnvelope, PreferenceR);
envelope!(ExceptionEnvelope, ExceptionR);
envelope!(ExceptionPageEnvelope, PageR);
envelope!(ExceptionGroupPageEnvelope, GroupPageR);
envelope!(ExceptionSummaryEnvelope, SummaryR);
envelope!(ExceptionSourcesEnvelope, Vec<String>);
envelope!(UploadPrepareEnvelope, PrepareR);
envelope!(UploadHashEnvelope, HashR);
envelope!(ChunkUploadEnvelope, ChunkR);
envelope!(FinalizeUploadEnvelope, FinalizeR);
envelope!(UploadProgressEnvelope, ProgressR);
envelope!(UploadFilesEnvelope, FilesR);
envelope!(SuggestionEnvelope, SuggestionR);
envelope!(ApplicationEnvelope, App);
envelope!(EmptyEnvelope, EmptyR);
envelope!(TenantEnvelope, TenantR);
envelope!(TenantListEnvelope, Vec<TenantR>);
envelope!(MemberEnvelope, MemberR);
envelope!(MemberListEnvelope, Vec<MemberR>);
envelope!(SubscriptionEnvelope, SubscriptionR);
envelope!(SubscriptionListEnvelope, Vec<SubscriptionR>);
envelope!(QuotaEnvelope, QuotaR);
envelope!(ProviderEnvelope, ProviderR);
envelope!(ProviderListEnvelope, Vec<ProviderR>);
envelope!(ModelEnvelope, ModelR);
envelope!(ModelListEnvelope, Vec<ModelR>);
envelope!(SelfQuotaEnvelope, SelfQuotaR);
envelope!(PlansEnvelope, PlansR);
envelope!(SsoConnectionEnvelope, SsoConnectionR);
envelope!(SsoConnectionListEnvelope, Vec<SsoConnectionR>);
envelope!(SsoLoginEnvelope, SsoLoginR);
envelope!(CatalogEnvelope, CatalogR);
envelope!(OrderEnvelope, OrderR);
envelope!(OrderListEnvelope, Vec<OrderR>);
envelope!(PriceEnvelope, PriceR);
envelope!(PriceListEnvelope, Vec<PriceR>);
envelope!(ReconcileEnvelope, ReconcileR);
envelope!(TaskEnvelope, TaskR);
envelope!(ApprovalEnvelope, ApprovalR);
envelope!(IndexTaskEnvelope, IndexTaskR);
envelope!(SearchEnvelope, SearchR);
envelope!(ChatSyncEnvelope, ChatSyncR);
envelope!(ChatChangesEnvelope, ChatChangesR);

/// 健康检查 data 字段
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub status: String,
    pub version: String,
    pub timestamp: i64,
    pub uptime: String,
    /// PostgreSQL：up / down
    pub postgres: String,
    /// Redis：up / down
    pub redis: String,
}

/// 存活探针 data：只描述进程自身，**不含任何依赖**
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Liveness {
    /// 恒为 `alive`
    pub status: String,
    pub version: String,
    pub timestamp: i64,
}

/// 就绪探针 data：能否接流量 + 各依赖快照
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Readiness {
    /// `ready`（关键依赖全通）/ `degraded`（关键依赖全通但有非关键依赖异常）
    pub status: String,
    pub version: String,
    pub timestamp: i64,
    pub checks: Vec<DependencyCheck>,
}

/// 单个依赖的探测结果
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DependencyCheck {
    /// `postgres` / `redis` / `compute`
    pub name: String,
    /// 是否关键依赖：关键依赖故障 ⇒ 503（不接流量）
    pub critical: bool,
    /// `up` / `down` / `unconfigured`
    pub status: String,
    /// 补充说明（如 compute 版本与能力）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// 无 data 载荷（如登出成功）
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EmptyR {}

/// multipart 分片上传表单
#[derive(Debug, ToSchema)]
pub struct ChunkUploadForm {
    /// 上传会话 ID
    #[schema(example = "550e8400-e29b-41d4-a716-446655440000")]
    pub id: String,
    /// 分片序号（从 0 开始）
    #[schema(example = 0)]
    pub index: u32,
    /// 分片 SHA-256（64 hex）
    #[schema(example = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")]
    pub hash: String,
    /// 分片二进制；CAS 已存在时可省略（分片秒传）
    #[schema(format = Binary, content_media_type = "application/octet-stream")]
    pub chunk: Option<String>,
}

pub use crate::filters::exception::Exception;

/// 登录成功示例
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SigninSuccessExample {
    pub code: i32,
    pub success: bool,
    pub msg: String,
    pub data: Option<SigninExampleData>,
    pub timestamp: i64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SigninExampleData {
    pub token: String,
    pub id: String,
    pub username: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 登录失败示例（凭证无效）
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SigninErrorExample {
    pub code: i32,
    pub success: bool,
    pub msg: String,
    pub timestamp: i64,
}

#[allow(dead_code)]
pub fn signin_success_example() -> SigninSuccessExample {
    SigninSuccessExample {
        code: 200_000,
        success: true,
        msg: "登录成功".to_string(),
        data: Some(SigninExampleData {
            token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...".to_string(),
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            username: "demo".to_string(),
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
        }),
        timestamp: 1_700_000_000_000,
    }
}

#[allow(dead_code)]
pub fn signin_error_example() -> SigninErrorExample {
    SigninErrorExample {
        code: 500_301,
        success: false,
        msg: "用户名或密码错误".to_string(),
        timestamp: 1_700_000_000_000,
    }
}

// 确保 common 模块引用 auth schema 类型（供 components 注册）
#[allow(dead_code)]
pub fn _schema_refs() {
    let _: Option<Avatar> = None;
    let _: Option<AuthR> = None;
}
