#![allow(non_snake_case)]

use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, Condition, ConnectionTrait, EntityTrait,
    QueryFilter, QueryOrder, TransactionTrait,
};
use thinking_database::entity::agent_message as schema;
use uuid::Uuid;

use crate::exception::Exception;

/// 消息内容格式（assistant-ui 内置格式）：内容是不透明的 JSON 载荷，
/// 与 `packages/chat` 的 `LOCAL_FORMAT` 必须是同一个字串。
pub const LOCAL_FORMAT: &str = "ith/thread-message-like";

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
                    .order_by_asc(schema::Column::CreatedAt)
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
                    .order_by_asc(schema::Column::CreatedAt)
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
        let seed: Vec<String> = match params {
            schema::RemoveP::One(p) => vec![p],
            schema::RemoveP::Many(ps) => ps,
        };
        if seed.is_empty() {
            return Ok(vec![]);
        }

        // 删除一条消息时，它在分支树上的所有子孙一起删（assistant-ui 删分支通常整段给，
        // 但旧库/手写调用可能只给 head；这里按 parentID 递归补齐，避免留下孤儿分支）。
        // `visited` 防 parentID 环把 BFS 打成死循环。
        let mut visited: std::collections::HashSet<String> = seed.iter().cloned().collect();
        let mut ids: Vec<String> = seed;
        let mut frontier: Vec<String> = ids.clone();
        while !frontier.is_empty() {
            let rows = schema::Entity::find()
                .filter(schema::Column::ParentId.is_in(frontier))
                .all(db)
                .await?;
            frontier = Vec::new();
            for row in rows {
                if visited.insert(row.id.clone()) {
                    frontier.push(row.id.clone());
                    ids.push(row.id);
                }
            }
        }

        if ids.is_empty() {
            return Ok(vec![]);
        }
        schema::Entity::delete_many()
            .filter(schema::Column::Id.is_in(ids.clone()))
            .exec(db)
            .await?;
        Ok(ids)
    }

    async fn write_one<C: ConnectionTrait>(db: &C, p: schema::Write) -> Result<String, Exception> {
        let now = Utc::now().timestamp_millis();
        let id = p.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let created_at = p.createdAt.unwrap_or(now);
        let updated_at = p.updatedAt.unwrap_or(now);
        let model = schema::ActiveModel {
            id: Set(id.clone()),
            content: Set(p.content),
            parentID: Set(p.parentID),
            format: Set(p.format.unwrap_or_else(|| LOCAL_FORMAT.to_owned())),
            sessionID: Set(p.sessionID),
            createdAt: Set(created_at),
            updatedAt: Set(updated_at),
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
            .ok_or_else(|| Exception::NotFound(format!("agent_message not found: {}", payload.key)))?;

        let mut active: schema::ActiveModel = model.into();
        let now = Utc::now().timestamp_millis();
        if let Some(v) = payload.change.content {
            active.content = Set(v);
        }
        if let Some(v) = payload.change.parentID {
            active.parentID = Set(v);
        }
        if let Some(v) = payload.change.format {
            active.format = Set(v);
        }
        if let Some(v) = payload.change.sessionID {
            active.sessionID = Set(v);
        }
        active.updatedAt = Set(now);
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
        cond
    }
}
