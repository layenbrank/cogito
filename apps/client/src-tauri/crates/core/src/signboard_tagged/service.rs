use sea_orm::{
    ActiveValue::Set, ColumnTrait, Condition, ConnectionTrait, EntityTrait, QueryFilter,
    TransactionTrait,
};
use thinking_database::entity::signboard_tagged as schema;

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
                let key = Self::write_one(db, p).await?;
                Ok(vec![key])
            }
            schema::WriteP::Many(ps) => {
                if ps.is_empty() {
                    return Ok(vec![]);
                }
                let txn = db.begin().await?;
                let mut keys = Vec::with_capacity(ps.len());
                for p in ps {
                    keys.push(Self::write_one(&txn, p).await?);
                }
                txn.commit().await?;
                Ok(keys)
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
                    .all(db)
                    .await?;
                Ok(rows)
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
                let key = Self::remove_one(db, p).await?;
                Ok(vec![key])
            }
            schema::RemoveP::Many(ps) => {
                if ps.is_empty() {
                    return Ok(vec![]);
                }
                let txn = db.begin().await?;
                let mut keys = Vec::with_capacity(ps.len());
                for p in ps {
                    keys.push(Self::remove_one(&txn, p).await?);
                }
                txn.commit().await?;
                Ok(keys)
            }
        }
    }

    async fn write_one<C: ConnectionTrait>(db: &C, p: schema::Write) -> Result<String, Exception> {
        let key = format!("{}:{}", p.entry_id, p.tag_id);
        let model = schema::ActiveModel {
            entry_id: Set(p.entry_id),
            tag_id: Set(p.tag_id),
        };
        schema::Entity::insert(model).exec(db).await?;
        Ok(key)
    }

    async fn remove_one<C: ConnectionTrait>(
        db: &C,
        p: schema::Remove,
    ) -> Result<String, Exception> {
        if let Some(tag_id) = p.tag_id {
            let key = format!("{}:{}", p.entry_id, tag_id);
            let exists = schema::Entity::find_by_id((p.entry_id.clone(), tag_id.clone()))
                .one(db)
                .await?;
            if exists.is_none() {
                return Ok(key);
            }
            schema::Entity::delete_many()
                .filter(schema::Column::EntryId.eq(p.entry_id))
                .filter(schema::Column::TagId.eq(tag_id))
                .exec(db)
                .await?;
            Ok(key)
        } else {
            schema::Entity::delete_many()
                .filter(schema::Column::EntryId.eq(p.entry_id.clone()))
                .exec(db)
                .await?;
            Ok(p.entry_id)
        }
    }

    fn build_read_filter(p: &schema::Read) -> Condition {
        let mut condition = Condition::all();
        if let Some(entry_id) = &p.entry_id {
            condition = condition.add(schema::Column::EntryId.eq(entry_id.clone()));
        }
        if let Some(tag_id) = &p.tag_id {
            condition = condition.add(schema::Column::TagId.eq(tag_id.clone()));
        }
        condition
    }
}
