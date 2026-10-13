use sea_orm::entity::prelude::*;

/// 用量：一次运行（一轮 prompt）的 token 账（客户端 `agent_usage` 的服务端镜像）。
///
/// 与 `gateway_usage` 分开：那张表记的是**经过网关**的调用（服务端视角，含失败与延迟），
/// 这张记的是**客户端自报**的会话账（含 BYOK 直连上游的用量，服务端看不见）。
/// 口径不同，两张都能留，不要互相合并。
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "chat_usage")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(column_name = "tenantID", indexed)]
    pub tenant_id: Uuid,
    /// 所属会话；无外键：用量是账本，会话行缺失（例如只同步了用量）不该让整批落不了库
    #[sea_orm(column_name = "sessionID", nullable)]
    pub session_id: Option<Uuid>,
    /// 运行标识（客户端生成）；同一次运行重复上报即同一条，靠唯一索引兜并发
    #[sea_orm(column_name = "runID", column_type = "Text")]
    pub run_id: String,
    /// 供应商标识（BYOK 与网关各有取值，服务端不解读）
    #[sea_orm(column_name = "providerID", column_type = "Text", nullable)]
    pub provider_id: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub model: Option<String>,
    /// 账目来源（如 `gateway` / `byok`）：同一次运行的口径由它说明
    #[sea_orm(column_type = "Text", nullable)]
    pub source: Option<String>,
    /// 结局（如 `SUCCEEDED` / `FAILED` / `ABORTED`）；客户端词汇，服务端只存
    #[sea_orm(column_type = "Text", nullable)]
    pub outcome: Option<String>,
    /// token 数；未上报时为 NULL（与 0 不同）
    #[sea_orm(column_name = "inputTokens", nullable)]
    pub input_tokens: Option<i32>,
    #[sea_orm(column_name = "outputTokens", nullable)]
    pub output_tokens: Option<i32>,
    #[sea_orm(column_name = "totalTokens", nullable)]
    pub total_tokens: Option<i32>,
    /// 客户端生成时间（毫秒）
    #[sea_orm(column_name = "clientCreatedAt")]
    pub client_created_at: i64,
    /// 服务端分配的同步水位
    pub revision: i64,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: DateTimeWithTimeZone,
    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: DateTimeWithTimeZone,
}

impl ActiveModelBehavior for ActiveModel {}
