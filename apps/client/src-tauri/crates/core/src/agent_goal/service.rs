#![allow(non_snake_case)]

use chrono::Utc;
use cogito_database::entity::agent_goal as schema;
use sea_orm::sea_query::OnConflict;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, EntityTrait, QueryFilter,
    QueryOrder, Set, TransactionTrait,
};
use uuid::Uuid;

use crate::exception::Exception;

pub struct Service;

impl Service {
    /// 按 `sessionID` upsert：一个会话只有一个进行中的目标。
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

    pub async fn toRead<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::ReadP,
    ) -> Result<Vec<schema::Model>, Exception> {
        match params {
            schema::ReadP::One(p) => {
                let rows = schema::Entity::find()
                    .filter(Self::build_read_filter(&p))
                    .order_by_desc(schema::Column::UpdatedAt)
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
                    .order_by_desc(schema::Column::UpdatedAt)
                    .all(db)
                    .await?;
                Ok(rows)
            }
        }
    }

    /// 只改状态位 / 轮次 / 进度 / 审批档；`updatedAt` 自动刷新。
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

    async fn write_one<C: ConnectionTrait>(db: &C, p: schema::Write) -> Result<String, Exception> {
        let now = Utc::now().timestamp_millis();
        let id = p.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let model = schema::ActiveModel {
            id: Set(id),
            sessionID: Set(p.sessionID.clone()),
            summary: Set(p.summary),
            detail: Set(p.detail),
            budget: Set(p.budget.max(1)),
            used: Set(p.used.max(0)),
            progressDone: Set(p.progressDone),
            progressTotal: Set(p.progressTotal),
            status: Set(p.status),
            approvalBefore: Set(p.approvalBefore),
            expectedPrompt: Set(p.expectedPrompt),
            leaseRunID: Set(p.leaseRunID),
            leaseUntil: Set(p.leaseUntil),
            modeBefore: Set(p.modeBefore),
            createdAt: Set(p.createdAt.unwrap_or(now)),
            updatedAt: Set(p.updatedAt.unwrap_or(now)),
        };
        let on_conflict = OnConflict::column(schema::Column::SessionId)
            .update_columns([
                schema::Column::Summary,
                schema::Column::Detail,
                schema::Column::Budget,
                schema::Column::Used,
                schema::Column::ProgressDone,
                schema::Column::ProgressTotal,
                schema::Column::Status,
                schema::Column::ApprovalBefore,
                schema::Column::ExpectedPrompt,
                schema::Column::LeaseRunId,
                schema::Column::LeaseUntil,
                schema::Column::ModeBefore,
                schema::Column::UpdatedAt,
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
            .ok_or_else(|| Exception::NotFound("agent_goal upsert 后查不到行".to_string()))?;
        Ok(saved.id)
    }

    async fn update_one<C: ConnectionTrait>(
        db: &C,
        payload: schema::Update,
    ) -> Result<String, Exception> {
        let model = schema::Entity::find()
            .filter(
                schema::Column::Id
                    .eq(payload.key.clone())
                    .or(schema::Column::SessionId.eq(payload.key.clone())),
            )
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("agent_goal not found: {}", payload.key)))?;

        let change = payload.change;
        let mut active: schema::ActiveModel = model.into();
        if let Some(v) = change.summary {
            active.summary = Set(v);
        }
        if let Some(v) = change.detail {
            active.detail = Set(v);
        }
        if let Some(v) = change.budget {
            active.budget = Set(v.max(1));
        }
        if let Some(v) = change.used {
            active.used = Set(v.max(0));
        }
        if let Some(v) = change.progressDone {
            active.progressDone = Set(v);
        }
        if let Some(v) = change.progressTotal {
            active.progressTotal = Set(v);
        }
        if let Some(v) = change.status {
            active.status = Set(v);
        }
        if let Some(v) = change.approvalBefore {
            active.approvalBefore = Set(v);
        }
        if let Some(v) = change.expectedPrompt {
            active.expectedPrompt = Set(v);
        }
        if let Some(v) = change.leaseRunID {
            active.leaseRunID = Set(v);
        }
        if let Some(v) = change.leaseUntil {
            active.leaseUntil = Set(v);
        }
        if let Some(v) = change.modeBefore {
            active.modeBefore = Set(v);
        }
        active.updatedAt = Set(change
            .updatedAt
            .unwrap_or_else(|| Utc::now().timestamp_millis()));
        let updated = active.update(db).await?;
        Ok(updated.id)
    }

    fn build_read_filter(payload: &schema::Read) -> Condition {
        let mut cond = Condition::all();
        if let Some(ref id) = payload.id {
            cond = cond.add(schema::Column::Id.eq(id.clone()));
        }
        if let Some(ref session_id) = payload.sessionID {
            cond = cond.add(schema::Column::SessionId.eq(session_id.clone()));
        }
        if let Some(ref status) = payload.status {
            cond = cond.add(schema::Column::Status.eq(status.clone()));
        }
        cond
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::DatabaseConnection;

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

    fn goal(session_id: &str, status: &str, used: i64) -> schema::Write {
        schema::Write {
            id: None,
            sessionID: session_id.to_string(),
            summary: "把单测跑绿".to_string(),
            detail: "把 pnpm unit 跑绿，覆盖率 ≥ 80%".to_string(),
            budget: 6,
            used,
            progressDone: None,
            progressTotal: None,
            status: status.to_string(),
            approvalBefore: Some("ask".to_string()),
            expectedPrompt: None,
            // 回合租约与启动前模式：默认空（这一轮还没开跑 / 不是从目标模式启的）
            leaseRunID: None,
            leaseUntil: None,
            modeBefore: None,
            createdAt: None,
            updatedAt: None,
        }
    }

    #[tokio::test]
    async fn upsert_and_partial_update() {
        let db = db().await;
        Service::toWrite(&*db, schema::WriteP::One(goal("s1", "running", 0)))
            .await
            .expect("write");
        Service::toWrite(&*db, schema::WriteP::One(goal("s1", "running", 2)))
            .await
            .expect("second write");

        let rows = Service::toRead(
            &*db,
            schema::ReadP::One(schema::Read {
                id: None,
                sessionID: Some("s1".to_string()),
                status: None,
            }),
        )
        .await
        .expect("read");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].used, 2);

        Service::toUpdate(
            &*db,
            schema::UpdateP::One(schema::Update {
                key: "s1".to_string(),
                change: schema::Change {
                    summary: None,
                    detail: None,
                    budget: None,
                    used: None,
                    progressDone: Some(Some(3)),
                    progressTotal: Some(Some(5)),
                    status: Some("paused".to_string()),
                    approvalBefore: None,
                    expectedPrompt: None,
                    leaseRunID: None,
                    leaseUntil: None,
                    modeBefore: None,
                    updatedAt: None,
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
                status: None,
            }),
        )
        .await
        .expect("read")
        .remove(0);
        assert_eq!(row.status, "paused");
        assert_eq!(row.progressDone, Some(3));
        assert_eq!(row.used, 2, "没指定的列不能被重置");
        assert_eq!(row.approvalBefore.as_deref(), Some("ask"));
    }
}
