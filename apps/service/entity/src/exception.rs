use sea_orm::entity::prelude::*;

/// 客户端 / 运维面异常事件（追加型；按 fingerprint 聚合）。
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "exception")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    /// 对外事件 ID（客户端生成；与库内主键分离）
    #[sea_orm(unique, column_name = "eventID")]
    pub event_id: String,
    /// 聚合指纹
    #[sea_orm(indexed)]
    pub fingerprint: String,
    /// 来源：项目名 / client / server
    pub source: String,
    /// fatal | error | warning | info
    pub level: String,
    pub message: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub stack: Option<String>,
    pub status: Option<i32>,
    pub method: Option<String>,
    pub url: String,
    #[sea_orm(column_name = "reqID", nullable)]
    pub req_id: Option<String>,
    pub ip: Option<String>,
    #[sea_orm(column_name = "userAgent", nullable)]
    pub user_agent: Option<String>,
    #[sea_orm(column_name = "userID", nullable)]
    pub user_id: Option<String>,
    pub environment: Option<String>,
    pub release: Option<String>,
    #[sea_orm(column_type = "JsonBinary", nullable)]
    pub context: Option<Json>,
    /// 异常发生时间（毫秒时间戳）
    pub timestamp: i64,
    /// 服务端入库时间
    #[sea_orm(column_name = "receivedAt", indexed)]
    pub received_at: DateTimeWithTimeZone,
    /// 有 Session 上报时记录创建人
    pub creator: Option<Uuid>,
}

impl ActiveModelBehavior for ActiveModel {}
