use sea_orm::entity::prelude::*;

/// 消息：会话里的一条内容（客户端 `agent_message` 的服务端镜像）。
///
/// 服务端**不解读** `content`：它是客户端自己的消息格式（`format` 说明版本），
/// 服务端只负责按 `revision` 增量下发。`parentID` 刻意不做外键——消息是逐批同步的，
/// 父行可能落在别的批次（甚至还没推上来），拿外键拦住整批不值得；树的形状由客户端校验。
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "chat_message")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(column_name = "tenantID", indexed)]
    pub tenant_id: Uuid,
    /// 所属会话；会话先于消息同步（同一批次里也是这个次序），故外键成立
    #[sea_orm(column_name = "sessionID", indexed)]
    pub session_id: Uuid,
    /// 父消息（树形结构）；无外键，理由见上
    #[sea_orm(column_name = "parentID", nullable)]
    pub parent_id: Option<Uuid>,
    /// 内容格式标识（如 `ith/thread-message-like`）：服务端按它原样存回
    pub format: String,
    /// 内容原文
    #[sea_orm(column_type = "Text")]
    pub content: String,
    /// 客户端生成时间（毫秒）：展示与排序都用它，避免「多设备时钟各说各话」
    #[sea_orm(column_name = "clientCreatedAt")]
    pub client_created_at: i64,
    /// 服务端分配的同步水位
    pub revision: i64,
    /// 删除墓碑（客户端毫秒时间戳）；非空即已删
    #[sea_orm(column_name = "archivedAt", nullable)]
    pub archived_at: Option<i64>,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: DateTimeWithTimeZone,
    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: DateTimeWithTimeZone,
}

impl ActiveModelBehavior for ActiveModel {}
