use sea_orm::entity::prelude::*;

/// 会话：一次对话的头部（客户端 `agent_session` 的服务端镜像）。
///
/// 本地为主、服务端只做同步：`revision` 是服务端分配的同步水位，客户端的 `clientUpdatedAt`
/// 原样保留（冲突判定要看的是「谁的这次改动更晚」，用哪个时钟由客户端说明）。
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "chat_session")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(column_name = "tenantID", indexed)]
    pub tenant_id: Uuid,
    /// 创建者；同步由本人发起，故非空（服务端代建场景留空）
    #[sea_orm(column_name = "userID", nullable)]
    pub user_id: Option<Uuid>,
    /// 会话标题（可改名，冲突面之一）
    pub title: String,
    /// 是否置顶（可改动，冲突面之一）
    pub pinned: bool,
    /// 关联的本地工作区；工作区是客户端概念，服务端只存它的标识
    #[sea_orm(column_name = "workspaceID", column_type = "Text", nullable)]
    pub workspace_id: Option<String>,
    /// 服务端分配的同步水位（单调递增，增量拉取的游标）
    pub revision: i64,
    /// 客户端改写时间（毫秒）；只作冲突参考，不参与排序
    #[sea_orm(column_name = "clientUpdatedAt")]
    pub client_updated_at: i64,
    /// 删除墓碑（客户端毫秒时间戳）；非空即已删
    #[sea_orm(column_name = "archivedAt", nullable)]
    pub archived_at: Option<i64>,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: DateTimeWithTimeZone,
    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: DateTimeWithTimeZone,
}

impl ActiveModelBehavior for ActiveModel {}
