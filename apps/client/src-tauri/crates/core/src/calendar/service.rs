use chrono::Utc;
use cogito_database::entity::calendar as schema;
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
                    .order_by_asc(schema::Column::StartAt)
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
                    .order_by_asc(schema::Column::StartAt)
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
        let id = Uuid::new_v4().to_string();
        let model = schema::ActiveModel {
            id: Set(id.clone()),
            title: Set(p.title),
            notes: Set(p.notes),
            start_at: Set(p.start_at),
            end_at: Set(p.end_at),
            entire_day: Set(p.entire_day),
            color: Set(p.color),
            reminder_id: Set(p.reminder_id),
            archived_at: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
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
            .ok_or_else(|| Exception::NotFound(format!("calendar not found: {}", payload.key)))?;

        let mut active: schema::ActiveModel = model.into();
        let now = Utc::now().timestamp_millis();

        if let Some(v) = payload.change.title {
            active.title = Set(v);
        }
        if let Some(v) = payload.change.notes {
            active.notes = Set(v);
        }
        if let Some(v) = payload.change.start_at {
            active.start_at = Set(v);
        }
        if let Some(v) = payload.change.end_at {
            active.end_at = Set(v);
        }
        if let Some(v) = payload.change.entire_day {
            active.entire_day = Set(v);
        }
        if let Some(v) = payload.change.color {
            active.color = Set(v);
        }
        if let Some(v) = payload.change.reminder_id {
            active.reminder_id = Set(v);
        }
        if let Some(v) = payload.change.archived_at {
            active.archived_at = Set(v);
        }
        active.updated_at = Set(now);

        let updated = active.update(db).await?;
        Ok(updated.id)
    }

    fn build_read_filter(payload: &schema::Read) -> Condition {
        let mut cond = Condition::all();
        if let Some(ref id) = payload.id {
            cond = cond.add(schema::Column::Id.eq(id.clone()));
        }
        if let Some(ref title) = payload.title {
            cond = cond.add(schema::Column::Title.eq(title.clone()));
        }
        if let Some(ref reminder_id) = payload.reminder_id {
            cond = cond.add(schema::Column::ReminderId.eq(reminder_id.clone()));
        }
        if !payload.archived {
            cond = cond.add(schema::Column::ArchivedAt.is_null());
        }
        if let Some(range_from) = payload.range_from {
            cond = cond.add(schema::Column::EndAt.gte(range_from));
        }
        if let Some(range_to) = payload.range_to {
            cond = cond.add(schema::Column::StartAt.lt(range_to));
        }
        cond
    }
}
