use chrono::Utc;
use cogito_database::entity::signboard_entry_asset as schema;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, Condition, ConnectionTrait, EntityTrait,
    QueryFilter, QueryOrder, TransactionTrait,
};

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
                    .order_by_asc(schema::Column::Index)
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
                let key = Self::update_one(db, p).await?;
                Ok(vec![key])
            }
            schema::UpdateP::Many(ps) => {
                if ps.is_empty() {
                    return Ok(vec![]);
                }
                let txn = db.begin().await?;
                let mut keys = Vec::with_capacity(ps.len());
                for p in ps {
                    keys.push(Self::update_one(&txn, p).await?);
                }
                txn.commit().await?;
                Ok(keys)
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
        let key = format!("{}:{}", p.entry_id, p.asset_id);
        let exists = schema::Entity::find_by_id((p.entry_id.clone(), p.asset_id.clone()))
            .one(db)
            .await?;
        if exists.is_some() {
            return Ok(key);
        }

        let index = if let Some(index) = p.index {
            index
        } else {
            let count = schema::Entity::find()
                .filter(schema::Column::EntryId.eq(p.entry_id.clone()))
                .all(db)
                .await?
                .len() as i32;
            count
        };

        let now = Utc::now().timestamp_millis();
        let model = schema::ActiveModel {
            entry_id: Set(p.entry_id),
            asset_id: Set(p.asset_id),
            index: Set(index),
            created_at: Set(now),
        };
        schema::Entity::insert(model).exec(db).await?;
        Ok(key)
    }

    async fn update_one<C: ConnectionTrait>(
        db: &C,
        p: schema::Update,
    ) -> Result<String, Exception> {
        let key = format!("{}:{}", p.entry_id, p.asset_id);
        let Some(row) = schema::Entity::find_by_id((p.entry_id.clone(), p.asset_id.clone()))
            .one(db)
            .await?
        else {
            return Ok(key);
        };

        let mut active: schema::ActiveModel = row.into();
        if let Some(index) = p.change.index {
            active.index = Set(index);
        }
        active.update(db).await?;
        Ok(key)
    }

    async fn remove_one<C: ConnectionTrait>(
        db: &C,
        p: schema::Remove,
    ) -> Result<String, Exception> {
        if let Some(asset_id) = p.asset_id {
            let key = format!("{}:{}", p.entry_id, asset_id);
            schema::Entity::delete_many()
                .filter(schema::Column::EntryId.eq(p.entry_id))
                .filter(schema::Column::AssetId.eq(asset_id))
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
        if let Some(asset_id) = &p.asset_id {
            condition = condition.add(schema::Column::AssetId.eq(asset_id.clone()));
        }
        condition
    }
}
