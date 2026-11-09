#![allow(non_snake_case)]

use chrono::Utc;
use cogito_database::entity::agent_session as schema;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, Condition, ConnectionTrait, EntityTrait,
    QueryFilter, QueryOrder, TransactionTrait,
};
use uuid::Uuid;

use crate::exception::Exception;

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
        if touches_content {
            active.updatedAt = Set(now);
        }
        let updated = active.update(db).await?;
        Ok(updated.id)
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
}
