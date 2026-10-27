use chrono::Utc;
use cogito_database::entity::signboard_entry as schema;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, Condition, ConnectionTrait, EntityTrait,
    QueryFilter, QueryOrder, TransactionTrait,
};
use uuid::Uuid;

use crate::exception::Exception;

pub struct Service;

impl Service {
    #[allow(non_snake_case)]
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

    #[allow(non_snake_case)]
    pub async fn toRead<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::ReadP,
    ) -> Result<Vec<schema::Model>, Exception> {
        match params {
            schema::ReadP::One(p) => {
                let rows = schema::Entity::find()
                    .filter(Self::build_read_filter(&p))
                    .order_by_asc(schema::Column::Index)
                    .order_by_desc(schema::Column::CreatedAt)
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
                    .order_by_asc(schema::Column::Index)
                    .order_by_desc(schema::Column::CreatedAt)
                    .all(db)
                    .await?;
                Ok(rows)
            }
        }
    }

    #[allow(non_snake_case)]
    pub async fn toUpdate<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::UpdateP,
    ) -> Result<Vec<String>, Exception> {
        match params {
            schema::UpdateP::One(p) => {
                let updated_id = Self::update_one(db, p).await?;
                Ok(vec![updated_id])
            }
            schema::UpdateP::Many(ps) => {
                if ps.is_empty() {
                    return Ok(vec![]);
                }
                let txn = db.begin().await?;
                let mut updated_ids = Vec::with_capacity(ps.len());
                for p in ps {
                    updated_ids.push(Self::update_one(&txn, p).await?);
                }
                txn.commit().await?;
                Ok(updated_ids)
            }
        }
    }

    #[allow(non_snake_case)]
    pub async fn toRemove<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::RemoveP,
    ) -> Result<Vec<String>, Exception> {
        match params {
            schema::RemoveP::One(id) => {
                let exists = schema::Entity::find_by_id(id.clone()).one(db).await?;
                if exists.is_none() {
                    return Ok(vec![]);
                }
                schema::Entity::delete_many()
                    .filter(schema::Column::Id.eq(id.clone()))
                    .exec(db)
                    .await?;
                Ok(vec![id])
            }
            schema::RemoveP::Many(ids) => {
                if ids.is_empty() {
                    return Ok(vec![]);
                }
                let models = schema::Entity::find()
                    .filter(schema::Column::Id.is_in(ids.clone()))
                    .all(db)
                    .await?;
                if models.is_empty() {
                    return Ok(vec![]);
                }
                let found_ids: Vec<String> = models.into_iter().map(|m| m.id).collect();
                schema::Entity::delete_many()
                    .filter(schema::Column::Id.is_in(found_ids.clone()))
                    .exec(db)
                    .await?;
                Ok(found_ids)
            }
        }
    }

    async fn write_one<C: ConnectionTrait>(db: &C, p: schema::Write) -> Result<String, Exception> {
        let now = Utc::now().timestamp_millis();
        let id = Uuid::new_v4().to_string();
        let model = schema::ActiveModel {
            id: Set(id.clone()),
            column_id: Set(p.column_id),
            title: Set(p.title),
            notes: Set(p.notes),
            index: Set(p.index),
            due_at: Set(p.due_at),
            start_at: Set(p.start_at),
            reminder_id: Set(p.reminder_id),
            priority: Set(p.priority),
            progress: Set(p.progress.clamp(0, 100)),
            color: Set(p.color),
            archived_at: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
        };
        schema::Entity::insert(model).exec(db).await?;
        Ok(id)
    }

    async fn update_one<C: ConnectionTrait>(
        db: &C,
        p: schema::Update,
    ) -> Result<String, Exception> {
        let existing = schema::Entity::find_by_id(p.key.clone())
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("signboard_entry:{}", p.key)))?;
        let mut active: schema::ActiveModel = existing.into();
        let change = p.change;
        if let Some(column_id) = change.column_id {
            active.column_id = Set(column_id);
        }
        if let Some(title) = change.title {
            active.title = Set(title);
        }
        if let Some(notes) = change.notes {
            active.notes = Set(notes);
        }
        if let Some(index) = change.index {
            active.index = Set(index);
        }
        if let Some(due_at) = change.due_at {
            active.due_at = Set(due_at);
        }
        if let Some(start_at) = change.start_at {
            active.start_at = Set(start_at);
        }
        if let Some(reminder_id) = change.reminder_id {
            active.reminder_id = Set(reminder_id);
        }
        if let Some(priority) = change.priority {
            active.priority = Set(priority);
        }
        if let Some(progress) = change.progress {
            active.progress = Set(progress.clamp(0, 100));
        }
        if let Some(color) = change.color {
            active.color = Set(color);
        }
        if let Some(archived_at) = change.archived_at {
            active.archived_at = Set(archived_at);
        }
        active.updated_at = Set(Utc::now().timestamp_millis());
        active.update(db).await?;
        Ok(p.key)
    }

    fn build_read_filter(p: &schema::Read) -> Condition {
        let mut condition = Condition::all();
        if let Some(id) = &p.id {
            condition = condition.add(schema::Column::Id.eq(id.clone()));
        }
        if let Some(column_id) = &p.column_id {
            condition = condition.add(schema::Column::ColumnId.eq(column_id.clone()));
        }
        if let Some(title) = &p.title {
            condition = condition.add(schema::Column::Title.eq(title.clone()));
        }
        if let Some(reminder_id) = &p.reminder_id {
            condition = condition.add(schema::Column::ReminderId.eq(reminder_id.clone()));
        }
        if !p.archived {
            condition = condition.add(schema::Column::ArchivedAt.is_null());
        }
        condition
    }
}
