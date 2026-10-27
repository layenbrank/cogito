use chrono::Utc;
use cogito_database::entity::mirror as schema;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, Condition, ConnectionTrait, EntityTrait,
    QueryFilter, QueryOrder, TransactionTrait,
};
use uuid::Uuid;

use crate::exception::Exception;

fn json_to_string<T: serde::Serialize>(v: T) -> Option<String> {
    serde_json::to_string(&v).ok()
}

pub struct Service;

impl Service {
    #[allow(non_snake_case)]
    pub async fn toWrite<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::WriteP,
    ) -> Result<Vec<String>, Exception> {
        match params {
            schema::WriteP::One(p) => {
                let now = Utc::now().timestamp_millis();
                let id = Uuid::new_v4().to_string();
                let model = schema::ActiveModel {
                    id: Set(id.clone()),
                    index: Set(p.index),
                    title: Set(p.title),
                    mark: Set(p.mark),
                    description: Set(p.description),
                    overlay: Set(p.overlay),
                    background: Set(p.background.and_then(json_to_string)),
                    backdrop: Set(p.backdrop.and_then(json_to_string)),
                    archived_at: Set(None),
                    updated_at: Set(now),
                    created_at: Set(now),
                };

                schema::Entity::insert(model).exec(db).await?;
                Ok(vec![id])
            }
            schema::WriteP::Many(ps) => {
                if ps.is_empty() {
                    return Ok(vec![]);
                }

                let now = Utc::now().timestamp_millis();
                let mut ids = Vec::with_capacity(ps.len());
                let models = ps
                    .into_iter()
                    .map(|p| {
                        let id = Uuid::new_v4().to_string();
                        ids.push(id.clone());
                        schema::ActiveModel {
                            id: Set(id),
                            index: Set(p.index),
                            title: Set(p.title),
                            mark: Set(p.mark),
                            description: Set(p.description),
                            overlay: Set(p.overlay),
                            background: Set(p.background.and_then(json_to_string)),
                            backdrop: Set(p.backdrop.and_then(json_to_string)),
                            archived_at: Set(None),
                            updated_at: Set(now),
                            created_at: Set(now),
                        }
                    })
                    .collect::<Vec<_>>();

                schema::Entity::insert_many(models).exec(db).await?;
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
            // 与 magnetic_tile 一致：One 表示「一组过滤条件」，应用 .all()。
            // 切勿用 .one()——空条件会 limit(1)，导致前端永远只读到 1 条并反复补种。
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

    async fn update_one<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        payload: schema::Update,
    ) -> Result<String, Exception> {
        let model = schema::Entity::find_by_id(payload.key.clone())
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("mirror not found: {}", payload.key)))?;

        let mut active: schema::ActiveModel = model.into();
        let now = Utc::now().timestamp_millis();

        if let Some(v) = payload.change.index {
            active.index = Set(v);
        }
        if let Some(v) = payload.change.title {
            active.title = Set(v);
        }
        if let Some(v) = payload.change.mark {
            active.mark = Set(v);
        }
        if let Some(v) = payload.change.description {
            active.description = Set(v);
        }
        if let Some(v) = payload.change.overlay {
            active.overlay = Set(v);
        }
        if let Some(v) = payload.change.background {
            active.background = Set(json_to_string(v));
        }
        if let Some(v) = payload.change.backdrop {
            active.backdrop = Set(json_to_string(v));
        }
        if let Some(v) = payload.change.created_at {
            active.created_at = Set(v);
        }
        active.updated_at = Set(payload.change.updated_at.unwrap_or(now));

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
        if let Some(ref mark) = payload.mark {
            cond = cond.add(schema::Column::Mark.eq(mark.clone()));
        }

        cond
    }
}
