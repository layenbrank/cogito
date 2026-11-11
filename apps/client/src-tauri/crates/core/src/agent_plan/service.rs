#![allow(non_snake_case)]

use chrono::Utc;
use cogito_database::entity::agent_plan as schema;
use sea_orm::sea_query::{Expr, OnConflict};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect, Set, TransactionTrait,
};
use uuid::Uuid;

use crate::exception::Exception;

pub struct Service;

impl Service {
    /// 按 `sessionID` upsert：前端不必先查 id，一个会话永远只有一行。
    pub async fn toWrite<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::WriteP,
    ) -> Result<Vec<String>, Exception> {
        match params {
            schema::WriteP::One(p) => Ok(vec![Self::write_one(db, p).await?]),
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

    /// 读档案。**列表查询默认不带 `body`**（数 KB 级正文不该搬进前端），
    /// 按 `id` / `sessionID` 精读时默认带正文（显式 `includeBody` 优先）。
    pub async fn toRead<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::ReadP,
    ) -> Result<Vec<schema::Model>, Exception> {
        match params {
            schema::ReadP::One(p) => Self::read_one(db, p).await,
            schema::ReadP::Many(ps) => {
                let mut rows = Vec::new();
                for p in ps {
                    rows.extend(Self::read_one(db, p).await?);
                }
                Ok(rows)
            }
        }
    }

    /// 部分更新：只动 `Change` 里列出的列，`updatedAt` 自动刷新。
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

    /// 按 `id` 或 `sessionID` 删除：删会话时一并清掉档案，不留孤儿行。
    pub async fn toRemove<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::RemoveP,
    ) -> Result<Vec<String>, Exception> {
        let keys = match params {
            schema::RemoveP::One(p) => vec![p],
            schema::RemoveP::Many(ps) => ps,
        };
        if keys.is_empty() {
            return Ok(vec![]);
        }
        let models = schema::Entity::find()
            .filter(
                schema::Column::Id
                    .is_in(keys.clone())
                    .or(schema::Column::SessionId.is_in(keys.clone())),
            )
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

    async fn read_one<C: ConnectionTrait>(
        db: &C,
        p: schema::Read,
    ) -> Result<Vec<schema::Model>, Exception> {
        let with_body = p.includeBody || p.id.is_some() || p.sessionID.is_some();
        let mut query = schema::Entity::find();
        if let Some(id) = p.id {
            query = query.filter(schema::Column::Id.eq(id));
        }
        if let Some(session_id) = p.sessionID {
            query = query.filter(schema::Column::SessionId.eq(session_id));
        }
        query = query.order_by_desc(schema::Column::UpdatedAt);
        if with_body {
            return Ok(query.all(db).await?);
        }
        // 列表模式：只取元数据，`body` 用空串占位（保持 `Model` 形状一致）。
        Ok(query
            .select_only()
            .columns([
                schema::Column::Id,
                schema::Column::SessionId,
                schema::Column::Title,
                schema::Column::Overview,
                schema::Column::Steps,
                schema::Column::Status,
                schema::Column::Source,
                schema::Column::FilePath,
                schema::Column::Revision,
                schema::Column::Digest,
                schema::Column::Truncated,
                schema::Column::CreatedAt,
                schema::Column::UpdatedAt,
                schema::Column::ExecutedAt,
                schema::Column::FinishedAt,
                schema::Column::ExecutedRevision,
                schema::Column::SupersededBy,
            ])
            .column_as(Expr::val(""), schema::Column::Body)
            .all(db)
            .await?)
    }

    async fn write_one<C: ConnectionTrait>(db: &C, p: schema::Write) -> Result<String, Exception> {
        let now = Utc::now().timestamp_millis();
        let id = p.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let steps = if p.steps.trim().is_empty() {
            "[]".to_string()
        } else {
            p.steps
        };
        let model = schema::ActiveModel {
            id: Set(id),
            sessionID: Set(p.sessionID.clone()),
            title: Set(p.title),
            overview: Set(p.overview),
            steps: Set(steps),
            body: Set(p.body),
            status: Set(p.status),
            source: Set(p.source),
            filePath: Set(p.filePath),
            revision: Set(p.revision.max(1)),
            digest: Set(p.digest),
            truncated: Set(p.truncated),
            createdAt: Set(p.createdAt.unwrap_or(now)),
            updatedAt: Set(p.updatedAt.unwrap_or(now)),
            executedAt: Set(p.executedAt),
            finishedAt: Set(p.finishedAt),
            executedRevision: Set(p.executedRevision),
            supersededBy: Set(p.supersededBy),
        };
        // `createdAt` / `id` 不在更新集里：upsert 保留首次落库的身份与时间。
        let on_conflict = OnConflict::column(schema::Column::SessionId)
            .update_columns([
                schema::Column::Title,
                schema::Column::Overview,
                schema::Column::Steps,
                schema::Column::Body,
                schema::Column::Status,
                schema::Column::Source,
                schema::Column::FilePath,
                schema::Column::Revision,
                schema::Column::Digest,
                schema::Column::Truncated,
                schema::Column::UpdatedAt,
                schema::Column::ExecutedAt,
                schema::Column::FinishedAt,
                schema::Column::ExecutedRevision,
                schema::Column::SupersededBy,
            ])
            .to_owned();
        schema::Entity::insert(model)
            .on_conflict(on_conflict)
            .exec_without_returning(db)
            .await?;
        let saved = schema::Entity::find()
            .filter(schema::Column::SessionId.eq(p.sessionID))
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound("agent_plan upsert 后查不到行".to_string()))?;
        Ok(saved.id)
    }

    async fn update_one<C: ConnectionTrait>(
        db: &C,
        payload: schema::Update,
    ) -> Result<String, Exception> {
        let model = Self::find_by_key(db, &payload.key).await?;
        let change = payload.change;
        let mut active: schema::ActiveModel = model.into();
        if let Some(v) = change.title {
            active.title = Set(v);
        }
        if let Some(v) = change.overview {
            active.overview = Set(v);
        }
        if let Some(v) = change.steps {
            active.steps = Set(v);
        }
        if let Some(v) = change.body {
            active.body = Set(v);
        }
        if let Some(v) = change.status {
            active.status = Set(v);
        }
        if let Some(v) = change.source {
            active.source = Set(v);
        }
        if let Some(v) = change.filePath {
            active.filePath = Set(v);
        }
        if let Some(v) = change.revision {
            active.revision = Set(v.max(1));
        }
        if let Some(v) = change.digest {
            active.digest = Set(v);
        }
        if let Some(v) = change.truncated {
            active.truncated = Set(v);
        }
        if let Some(v) = change.executedAt {
            active.executedAt = Set(v);
        }
        if let Some(v) = change.finishedAt {
            active.finishedAt = Set(v);
        }
        if let Some(v) = change.executedRevision {
            active.executedRevision = Set(v);
        }
        if let Some(v) = change.supersededBy {
            active.supersededBy = Set(v);
        }

        active.updatedAt = Set(change
            .updatedAt
            .unwrap_or_else(|| Utc::now().timestamp_millis()));
        let updated = active.update(db).await?;
        Ok(updated.id)
    }

    async fn find_by_key<C: ConnectionTrait>(
        db: &C,
        key: &str,
    ) -> Result<schema::Model, Exception> {
        schema::Entity::find()
            .filter(
                schema::Column::Id
                    .eq(key)
                    .or(schema::Column::SessionId.eq(key)),
            )
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("agent_plan not found: {key}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{ConnectionTrait, DatabaseConnection};

    async fn db() -> std::sync::Arc<DatabaseConnection> {
        let connection = std::sync::Arc::new(
            sea_orm::Database::connect("sqlite::memory:")
                .await
                .expect("connect in-memory sqlite"),
        );
        cogito_database::migration::run(&connection)
            .await
            .expect("migration should succeed");
        connection
    }

    fn write(session_id: &str, body: &str) -> schema::Write {
        schema::Write {
            id: None,
            sessionID: session_id.to_string(),
            title: "T".to_string(),
            overview: "O".to_string(),
            steps: "[\"a\",\"b\"]".to_string(),
            body: body.to_string(),
            status: "draft".to_string(),
            source: "thread".to_string(),
            filePath: None,
            revision: 1,
            digest: "d1".to_string(),
            truncated: false,
            createdAt: None,
            updatedAt: None,
            executedAt: None,
            finishedAt: None,
            executedRevision: None,
            supersededBy: None,
        }
    }

    #[tokio::test]
    async fn upsert_keeps_single_row_per_session() {
        let db = db().await;
        Service::toWrite(&*db, schema::WriteP::One(write("s1", "v1")))
            .await
            .expect("first write");
        Service::toWrite(&*db, schema::WriteP::One(write("s1", "v2")))
            .await
            .expect("second write");

        let rows = Service::toRead(
            &*db,
            schema::ReadP::One(schema::Read {
                id: None,
                sessionID: Some("s1".to_string()),
                includeBody: true,
            }),
        )
        .await
        .expect("read");
        assert_eq!(rows.len(), 1, "sessionID 唯一索引必须保证只有一行");
        assert_eq!(rows[0].body, "v2");
    }

    #[tokio::test]
    async fn update_only_touches_given_columns() {
        let db = db().await;
        Service::toWrite(&*db, schema::WriteP::One(write("s1", "body")))
            .await
            .expect("write");
        Service::toUpdate(
            &*db,
            schema::UpdateP::One(schema::Update {
                key: "s1".to_string(),
                change: schema::Change {
                    title: None,
                    overview: None,
                    steps: None,
                    body: None,
                    status: Some("running".to_string()),
                    source: None,
                    filePath: None,
                    revision: None,
                    digest: None,
                    truncated: None,
                    updatedAt: None,
                    executedAt: Some(Some(1234)),
                    finishedAt: None,
                    executedRevision: None,
                    supersededBy: None,
                },
            }),
        )
        .await
        .expect("update");

        let row = Service::toRead(
            &*db,
            schema::ReadP::One(schema::Read {
                id: None,
                sessionID: Some("s1".to_string()),
                includeBody: true,
            }),
        )
        .await
        .expect("read")
        .remove(0);
        assert_eq!(row.status, "running");
        assert_eq!(row.executedAt, Some(1234));
        assert_eq!(row.body, "body", "没指定的列不能被清空");
        assert_eq!(row.title, "T");
    }

    #[tokio::test]
    async fn list_read_does_not_carry_body() {
        let db = db().await;
        Service::toWrite(
            &*db,
            schema::WriteP::One(write("s1", "x".repeat(4096).as_str())),
        )
        .await
        .expect("write");
        let rows = Service::toRead(
            &*db,
            schema::ReadP::One(schema::Read {
                id: None,
                sessionID: None,
                includeBody: false,
            }),
        )
        .await
        .expect("list read");
        assert_eq!(rows.len(), 1);
        assert!(rows[0].body.is_empty(), "列表查询不能把正文搬出来");
        assert_eq!(rows[0].digest, "d1", "元数据仍要齐全");
    }

    #[tokio::test]
    async fn remove_by_session_id_leaves_no_orphan() {
        let db = db().await;
        Service::toWrite(&*db, schema::WriteP::One(write("s1", "b")))
            .await
            .expect("write");
        Service::toRemove(&*db, schema::RemoveP::One("s1".to_string()))
            .await
            .expect("remove");
        let count = db
            .query_one(sea_orm::Statement::from_string(
                sea_orm::DatabaseBackend::Sqlite,
                "SELECT count(*) AS v FROM agent_plan".to_string(),
            ))
            .await
            .expect("query")
            .expect("row");
        let value: i64 = count.try_get("", "v").expect("count");
        assert_eq!(value, 0);
    }
}
