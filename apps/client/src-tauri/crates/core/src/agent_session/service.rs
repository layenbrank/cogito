#![allow(non_snake_case)]

use chrono::Utc;
use cogito_database::entity::agent_session as schema;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, Condition, ConnectionTrait, EntityTrait,
    QueryFilter, QueryOrder, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::exception::Exception;

/// 默认路由档位（S11 之前只有这一个值）。
pub const DEFAULT_ROUTE_TIER: &str = "local";

/// 会话 ↔ ACP 绑定（S9）：以前只活在渲染进程的 localStorage 里，现在库是唯一源。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub acp_session_id: String,
    pub cwd: String,
    pub last_seq: i64,
    pub route_tier: String,
}

/// 绑定请求：只写传了的字段（`None` = 不动），所以刷新序号不必重传 cwd。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindP {
    pub session_id: String,
    #[serde(default)]
    pub acp_session_id: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub last_seq: Option<i64>,
    #[serde(default)]
    pub route_tier: Option<String>,
}

/// 读一条绑定的入参。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadBindingP {
    pub session_id: String,
}

/// 列表项：`sessionID` + 绑定内容（前端启动时一次性灌进内存缓存）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundSession {
    pub session_id: String,
    pub acp_session_id: String,
    pub cwd: String,
    pub last_seq: i64,
    pub route_tier: String,
}

pub struct Service;

impl Service {
    pub async fn toWrite<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::WriteP,
    ) -> Result<Vec<String>, Exception> {
        match params {
            schema::WriteP::One(p) => {
                let id = Self::write_one(db, p).await?;
                Ok(vec![id])
            }
            schema::WriteP::Many(ps) => {
                if ps.is_empty() {
                    return Ok(vec![]);
                }
                let txn = db.begin().await?;
                let mut ids = Vec::with_capacity(ps.len());
                for p in ps {
                    ids.push(Self::write_one(&txn, p).await?);
                }
                txn.commit().await?;
                Ok(ids)
            }
        }
    }

    pub async fn toRead<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::ReadP,
    ) -> Result<Vec<schema::Model>, Exception> {
        match params {
            schema::ReadP::One(p) => {
                let rows = schema::Entity::find()
                    .filter(Self::build_read_filter(&p))
                    .order_by_desc(schema::Column::Pinned)
                    .order_by_desc(schema::Column::UpdatedAt)
                    .order_by_asc(schema::Column::Id)
                    .all(db)
                    .await?;
                Ok(rows)
            }
            schema::ReadP::Many(ps) => {
                if ps.is_empty() {
                    return Ok(vec![]);
                }
                let combined = ps.iter().fold(Condition::any(), |any, p| {
                    any.add(Self::build_read_filter(p))
                });
                let rows = schema::Entity::find()
                    .filter(combined)
                    .order_by_desc(schema::Column::Pinned)
                    .order_by_desc(schema::Column::UpdatedAt)
                    .order_by_asc(schema::Column::Id)
                    .all(db)
                    .await?;
                Ok(rows)
            }
        }
    }

    pub async fn toUpdate<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::UpdateP,
    ) -> Result<Vec<String>, Exception> {
        match params {
            schema::UpdateP::One(p) => Ok(vec![Self::update_one(db, p).await?]),
            schema::UpdateP::Many(ps) => {
                if ps.is_empty() {
                    return Ok(vec![]);
                }
                let txn = db.begin().await?;
                let mut ids = Vec::with_capacity(ps.len());
                for p in ps {
                    ids.push(Self::update_one(&txn, p).await?);
                }
                txn.commit().await?;
                Ok(ids)
            }
        }
    }

    pub async fn toRemove<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::RemoveP,
    ) -> Result<Vec<String>, Exception> {
        match params {
            schema::RemoveP::One(p) => {
                let exists = schema::Entity::find_by_id(p.clone()).one(db).await?;
                if exists.is_none() {
                    return Ok(vec![]);
                }
                schema::Entity::delete_many()
                    .filter(schema::Column::Id.eq(p.clone()))
                    .exec(db)
                    .await?;
                Ok(vec![p])
            }
            schema::RemoveP::Many(ps) => {
                if ps.is_empty() {
                    return Ok(vec![]);
                }
                let models = schema::Entity::find()
                    .filter(schema::Column::Id.is_in(ps.clone()))
                    .all(db)
                    .await?;
                if models.is_empty() {
                    return Ok(vec![]);
                }
                let ids: Vec<String> = models.into_iter().map(|m| m.id).collect();
                schema::Entity::delete_many()
                    .filter(schema::Column::Id.is_in(ids.clone()))
                    .exec(db)
                    .await?;
                Ok(ids)
            }
        }
    }

    async fn write_one<C: ConnectionTrait>(db: &C, p: schema::Write) -> Result<String, Exception> {
        let now = Utc::now().timestamp_millis();
        let id = p.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let created_at = p.createdAt.unwrap_or(now);
        let updated_at = p.updatedAt.unwrap_or(now);
        let model = schema::ActiveModel {
            id: Set(id.clone()),
            title: Set(p.title),
            pinned: Set(p.pinned),
            providerID: Set(p.providerID),
            workspaceID: Set(p.workspaceID),
            createdAt: Set(created_at),
            updatedAt: Set(updated_at),
            unread: Set(p.unread),
            acpSessionID: Set(p.acpSessionID),
            acpCwd: Set(p.acpCwd),
            lastSeq: Set(p.lastSeq),
            routeTier: Set(p
                .routeTier
                .unwrap_or_else(|| DEFAULT_ROUTE_TIER.to_string())),
        };
        schema::Entity::insert(model).exec(db).await?;
        Ok(id)
    }

    async fn update_one<C: ConnectionTrait>(
        db: &C,
        payload: schema::Update,
    ) -> Result<String, Exception> {
        let model = schema::Entity::find_by_id(payload.key.clone())
            .one(db)
            .await?
            .ok_or_else(|| {
                Exception::NotFound(format!("agent_session not found: {}", payload.key))
            })?;

        let mut active: schema::ActiveModel = model.into();
        // 「已读 / 未读」是阅读状态，不是会话内容变更：它不该把这一行顶到左栏最前面
        // （否则每点开一次会话，树就重排一次）。所以只有其余字段真的变了才推进 updatedAt。
        let touches_content = payload.change.title.is_some()
            || payload.change.pinned.is_some()
            || payload.change.providerID.is_some()
            || payload.change.workspaceID.is_some();
        let now = Utc::now().timestamp_millis();
        if let Some(v) = payload.change.title {
            active.title = Set(v);
        }
        if let Some(v) = payload.change.pinned {
            active.pinned = Set(v);
        }
        if let Some(v) = payload.change.providerID {
            active.providerID = Set(v);
        }
        if let Some(v) = payload.change.workspaceID {
            active.workspaceID = Set(v);
        }
        if let Some(v) = payload.change.unread {
            active.unread = Set(v);
        }
        if let Some(v) = payload.change.acpSessionID {
            active.acpSessionID = Set(v);
        }
        if let Some(v) = payload.change.acpCwd {
            active.acpCwd = Set(v);
        }
        if let Some(v) = payload.change.lastSeq {
            active.lastSeq = Set(v);
        }
        if let Some(v) = payload.change.routeTier {
            active.routeTier = Set(v);
        }
        if touches_content {
            active.updatedAt = Set(now);
        }
        let updated = active.update(db).await?;
        Ok(updated.id)
    }

    /// 绑定会话 ↔ ACP（S9）：第一次连上 goose、以及每轮结束时刷新 `lastSeq` 都走这里。
    ///
    /// 不推进 `updatedAt` —— 这是运行态元数据，不是「会话内容变了」。
    /// 会话行不存在直接报 `NotFound`：宁可让前端看到错，也不悄悄造一行假会话。
    pub async fn bind<C: ConnectionTrait>(db: &C, p: BindP) -> Result<Binding, Exception> {
        let acp_session_id = p
            .acp_session_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| Exception::Validation("bind: acpSessionID 不能为空".to_string()))?;
        let model = schema::Entity::find_by_id(p.session_id.clone())
            .one(db)
            .await?
            .ok_or_else(|| {
                Exception::NotFound(format!("agent_session not found: {}", p.session_id))
            })?;
        let mut active: schema::ActiveModel = model.into();
        active.acpSessionID = Set(Some(acp_session_id));
        if let Some(cwd) = p.cwd {
            active.acpCwd = Set(Some(cwd));
        }
        if let Some(last_seq) = p.last_seq {
            active.lastSeq = Set(last_seq.max(0));
        }
        if let Some(tier) = p.route_tier {
            active.routeTier = Set(tier);
        }
        let updated = active.update(db).await?;
        Ok(Self::binding_of(updated)
            .ok_or_else(|| Exception::Internal("bind 之后 acpSessionID 仍为空".to_string()))?)
    }

    /// 读一个会话的绑定；没有绑定返回 `Ok(None)`（不是错误 —— 新会话本来就没绑）。
    pub async fn read_binding<C: ConnectionTrait>(
        db: &C,
        session_id: &str,
    ) -> Result<Option<Binding>, Exception> {
        let model = schema::Entity::find_by_id(session_id.to_string())
            .one(db)
            .await?;
        Ok(model.and_then(Self::binding_of))
    }

    /// 列出所有已绑定会话：前端启动时一次性拉下来灌进内存缓存，
    /// 之后 `recall` 仍然是同步的（不用把恢复流程改成 async）。
    pub async fn list_bindings<C: ConnectionTrait>(db: &C) -> Result<Vec<BoundSession>, Exception> {
        let rows = schema::Entity::find()
            .filter(schema::Column::AcpSessionId.is_not_null())
            .all(db)
            .await?;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let session_id = row.id.clone();
                Self::binding_of(row).map(|binding| BoundSession {
                    session_id,
                    acp_session_id: binding.acp_session_id,
                    cwd: binding.cwd,
                    last_seq: binding.last_seq,
                    route_tier: binding.route_tier,
                })
            })
            .collect())
    }

    /// 解绑（S9）：goose 会话已经不可用（连接断开 / 显式关会话）时清掉绑定。
    ///
    /// 不清就会出现「库里还绑着一个死 sessionID」：刷新后 `resumeThreadRun` 拿它
    /// 去 `session/load`，goose 那边早就没有这个会话了，用户看到的是恢复失败。
    /// 只清 ACP 三列，不删会话行、不推进 `updatedAt`（会话内容没变）；
    /// 本来就没绑过返回 `false`，调用方不必把「没绑过」当异常。
    pub async fn unbind<C: ConnectionTrait>(db: &C, session_id: &str) -> Result<bool, Exception> {
        let id = session_id.trim();
        if id.is_empty() {
            return Err(Exception::Validation(
                "unbind: sessionID 不能为空".to_string(),
            ));
        }
        let model = schema::Entity::find_by_id(id.to_string())
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("agent_session not found: {id}")))?;
        if model.acpSessionID.is_none() {
            return Ok(false);
        }
        let mut active: schema::ActiveModel = model.into();
        active.acpSessionID = Set(None);
        active.acpCwd = Set(None);
        active.lastSeq = Set(0);
        active.update(db).await?;
        Ok(true)
    }

    /// 切档位（S11）：`local` ↔ `cloud` 由用户或「可判定失败」的降级触发，
    /// 写进库里下次启动还认，不用重新猜。
    ///
    /// 与 `bind` 分开：切档位可能发生在**还没绑 ACP** 的会话上（第一轮都没发），
    /// 复用 `bind` 会逼调用方编一个不存在的 `acpSessionID`。同样不推进 `updatedAt`
    /// —— 档位是运行态偏好，不是会话内容。
    pub async fn set_route_tier<C: ConnectionTrait>(
        db: &C,
        session_id: &str,
        tier: &str,
    ) -> Result<String, Exception> {
        let id = session_id.trim();
        if id.is_empty() {
            return Err(Exception::Validation(
                "set_route_tier: sessionID 不能为空".to_string(),
            ));
        }
        let parsed = crate::agent_route::Tier::parse(tier).map_err(Exception::Validation)?;
        let model = schema::Entity::find_by_id(id.to_string())
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("agent_session not found: {id}")))?;
        let mut active: schema::ActiveModel = model.into();
        active.routeTier = Set(parsed.as_str().to_string());
        let updated = active.update(db).await?;
        Ok(updated.routeTier)
    }

    fn binding_of(row: schema::Model) -> Option<Binding> {
        let acp_session_id = row.acpSessionID?;
        if acp_session_id.trim().is_empty() {
            return None;
        }
        Some(Binding {
            acp_session_id,
            cwd: row.acpCwd.unwrap_or_default(),
            last_seq: row.lastSeq,
            route_tier: row.routeTier,
        })
    }

    fn build_read_filter(payload: &schema::Read) -> Condition {
        let mut cond = Condition::all();
        if let Some(ref id) = payload.id {
            cond = cond.add(schema::Column::Id.eq(id.clone()));
        }
        if let Some(ref workspace_id) = payload.workspaceID {
            cond = cond.add(schema::Column::WorkspaceId.eq(workspace_id.clone()));
        }
        cond
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use cogito_database::migration;
    use sea_orm::Database;

    async fn db() -> std::sync::Arc<sea_orm::DatabaseConnection> {
        let connection = std::sync::Arc::new(
            Database::connect("sqlite::memory:")
                .await
                .expect("connect in-memory sqlite"),
        );
        migration::run(&connection)
            .await
            .expect("migration should succeed");
        connection
    }

    fn write(id: &str) -> schema::Write {
        schema::Write {
            id: Some(id.to_string()),
            title: "t".to_string(),
            pinned: false,
            providerID: None,
            workspaceID: None,
            createdAt: Some(1_000),
            updatedAt: Some(1_000),
            unread: false,
            acpSessionID: None,
            acpCwd: None,
            lastSeq: 0,
            routeTier: None,
        }
    }

    fn update(key: &str, unread: Option<bool>, title: Option<&str>) -> schema::Update {
        schema::Update {
            key: key.to_string(),
            change: schema::Change {
                title: title.map(|value| value.to_string()),
                pinned: None,
                providerID: None,
                workspaceID: None,
                unread,
                acpSessionID: None,
                acpCwd: None,
                lastSeq: None,
                routeTier: None,
            },
        }
    }

    async fn read_one(db: &std::sync::Arc<sea_orm::DatabaseConnection>) -> schema::Model {
        schema::Entity::find_by_id("s1")
            .one(db.as_ref())
            .await
            .expect("read session")
            .expect("session should exist")
    }

    /// 「已读 / 未读」是阅读状态：写它不该把会话顶到左栏最前面（否则每点开一次就重排）。
    #[tokio::test]
    async fn unread_update_keeps_updated_at() {
        let db = db().await;
        Service::toWrite(db.as_ref(), schema::WriteP::One(write("s1")))
            .await
            .expect("write session");

        let unread = schema::UpdateP::One(update("s1", Some(true), None));
        Service::toUpdate(db.as_ref(), unread)
            .await
            .expect("mark unread");

        let row = read_one(&db).await;
        assert!(row.unread, "未读标记应该落库");
        assert_eq!(
            row.updatedAt, 1_000,
            "未读不推进 updatedAt：它只是阅读状态，不是内容变更"
        );

        // 内容字段照旧推进：`updateThread` 的元数据编辑依赖这一点
        let rename = schema::UpdateP::One(update("s1", None, Some("改名")));
        Service::toUpdate(db.as_ref(), rename)
            .await
            .expect("rename session");

        let row = read_one(&db).await;
        assert_eq!(row.title, "改名");
        assert!(row.updatedAt > 1_000, "改标题仍要推进 updatedAt");
        assert!(row.unread, "改标题不该顺手把未读清掉");
    }

    /// 老前端（请求体里没有 `unread`）写的会话必须默认已读，不能因为缺字段反序列化失败。
    #[test]
    fn write_payload_without_unread_deserializes_as_read() {
        let payload: schema::Write = serde_json::from_str(
            r#"{"title":"t","pinned":false,"providerID":null,"workspaceID":null}"#,
        )
        .expect("反序列化应成功");
        assert!(!payload.unread, "缺字段时默认已读");
    }

    /// S9：绑定落库之后，刷新 / 重启都能恢复「会话 → ACP session」。
    #[tokio::test]
    async fn bind_persists_acp_session_without_touching_updated_at() {
        let db = db().await;
        Service::toWrite(db.as_ref(), schema::WriteP::One(write("s1")))
            .await
            .expect("write session");

        let bound = Service::bind(
            db.as_ref(),
            BindP {
                session_id: "s1".to_string(),
                acp_session_id: Some(" acp-42 ".to_string()),
                cwd: Some("C:\\repo".to_string()),
                last_seq: Some(17),
                route_tier: Some("local".to_string()),
            },
        )
        .await
        .expect("bind");
        assert_eq!(bound.acp_session_id, "acp-42", "两侧空白要 trim 掉");
        assert_eq!(bound.cwd, "C:\\repo");
        assert_eq!(bound.last_seq, 17);

        let row = read_one(&db).await;
        assert_eq!(
            row.updatedAt, 1_000,
            "绑定是运行态元数据，不该把会话顶到最前"
        );
        assert_eq!(row.routeTier, "local");

        // 只刷序号：cwd 不能被清掉
        let rebound = Service::bind(
            db.as_ref(),
            BindP {
                session_id: "s1".to_string(),
                acp_session_id: Some("acp-42".to_string()),
                cwd: None,
                last_seq: Some(23),
                route_tier: None,
            },
        )
        .await
        .expect("rebind");
        assert_eq!(rebound.last_seq, 23);
        assert_eq!(rebound.cwd, "C:\\repo", "没传的字段保持原值");

        let binding = Service::read_binding(db.as_ref(), "s1")
            .await
            .expect("read binding")
            .expect("should be bound");
        assert_eq!(binding.last_seq, 23);
    }

    #[tokio::test]
    async fn bind_rejects_empty_acp_session_id() {
        let db = db().await;
        Service::toWrite(db.as_ref(), schema::WriteP::One(write("s1")))
            .await
            .expect("write session");
        let outcome = Service::bind(
            db.as_ref(),
            BindP {
                session_id: "s1".to_string(),
                acp_session_id: Some("   ".to_string()),
                cwd: None,
                last_seq: None,
                route_tier: None,
            },
        )
        .await;
        assert!(
            matches!(outcome, Err(Exception::Validation(_))),
            "空 id 必须拒绝"
        );
    }

    #[tokio::test]
    async fn bind_unknown_session_is_not_found() {
        let db = db().await;
        let outcome = Service::bind(
            db.as_ref(),
            BindP {
                session_id: "nope".to_string(),
                acp_session_id: Some("acp-1".to_string()),
                cwd: None,
                last_seq: None,
                route_tier: None,
            },
        )
        .await;
        assert!(
            matches!(outcome, Err(Exception::NotFound(_))),
            "不许悄悄造一行假会话"
        );
    }

    #[tokio::test]
    async fn list_bindings_only_returns_bound_sessions() {
        let db = db().await;
        for id in ["s1", "s2"] {
            Service::toWrite(db.as_ref(), schema::WriteP::One(write(id)))
                .await
                .expect("write session");
        }
        Service::bind(
            db.as_ref(),
            BindP {
                session_id: "s2".to_string(),
                acp_session_id: Some("acp-2".to_string()),
                cwd: Some("/tmp".to_string()),
                last_seq: None,
                route_tier: None,
            },
        )
        .await
        .expect("bind s2");

        let rows = Service::list_bindings(db.as_ref()).await.expect("list");
        assert_eq!(rows.len(), 1, "没绑定的会话不该出现在列表里");
        assert_eq!(rows[0].session_id, "s2");
        assert_eq!(rows[0].acp_session_id, "acp-2");
        assert_eq!(rows[0].route_tier, "local", "默认档位");
        assert!(
            Service::read_binding(db.as_ref(), "s1")
                .await
                .expect("read")
                .is_none(),
            "没绑定返回 None，不是错误"
        );
    }

    #[tokio::test]
    async fn unbind_clears_acp_columns_and_is_idempotent() {
        let db = db().await;
        Service::toWrite(db.as_ref(), schema::WriteP::One(write("s1")))
            .await
            .expect("write session");
        Service::bind(
            db.as_ref(),
            BindP {
                session_id: "s1".to_string(),
                acp_session_id: Some("acp-1".to_string()),
                cwd: Some("/tmp".to_string()),
                last_seq: Some(9),
                route_tier: None,
            },
        )
        .await
        .expect("bind");

        assert!(
            Service::unbind(db.as_ref(), "s1").await.expect("unbind"),
            "有绑定时应该清掉"
        );
        let after = read_one(&db).await;
        assert!(after.acpSessionID.is_none(), "acpSessionID 要清空");
        assert!(after.acpCwd.is_none(), "acpCwd 要清空");
        assert_eq!(after.lastSeq, 0, "序号归零");
        assert_eq!(
            after.routeTier, DEFAULT_ROUTE_TIER,
            "解绑不动路由档位（那是偏好，不是绑定）"
        );
        assert!(
            Service::read_binding(db.as_ref(), "s1")
                .await
                .expect("read")
                .is_none(),
            "解绑后读不到绑定"
        );
        assert!(
            !Service::unbind(db.as_ref(), "s1")
                .await
                .expect("unbind again"),
            "第二次解绑返回 false，不该报错"
        );
    }
}
