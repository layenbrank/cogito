use chrono::Utc;
use cogito_database::entity::signboard_check as schema;
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
                    .order_by_asc(schema::Column::Index)
                    .order_by_asc(schema::Column::CreatedAt)
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
            schema::UpdateP::One(p) => Ok(vec![Self::update_one(db, p).await?]),
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
            entry_id: Set(p.entry_id),
            title: Set(p.title),
            done: Set(p.done),
            index: Set(p.index),
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
            .ok_or_else(|| Exception::NotFound(format!("signboard_check:{}", p.key)))?;
        let mut active: schema::ActiveModel = existing.into();
        let change = p.change;
        if let Some(title) = change.title {
            active.title = Set(title);
        }
        if let Some(done) = change.done {
            active.done = Set(done);
        }
        if let Some(index) = change.index {
            active.index = Set(index);
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
        if let Some(entry_id) = &p.entry_id {
            condition = condition.add(schema::Column::EntryId.eq(entry_id.clone()));
        }
        condition
    }
}
