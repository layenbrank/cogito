use chrono::Utc;
use cogito_database::entity::magnetic_tile as schema;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, Condition, ConnectionTrait, EntityTrait,
    QueryFilter, QueryOrder, TransactionTrait,
};
use uuid::Uuid;

use crate::exception::Exception;

#[allow(non_snake_case)]
fn toDeserialize<T: serde::Serialize>(v: T) -> Option<String> {
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
                    url: Set(p.url),
                    round: Set(p.round),
                    mark: Set(p.mark),
                    component: Set(p.component),
                    description: Set(p.description),
                    background: Set(p.background.and_then(toDeserialize)),
                    backdrop: Set(p.backdrop.and_then(toDeserialize)),
                    size: Set(p.size),
                    shape: Set(p.shape),
                    direction: Set(p.direction),

                    mirror_id: Set(p.mirror_id),
                    text_color: Set(p.text_color),
                    collection_id: Set(p.collection_id),
                    download_count: Set(0),
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
                            url: Set(p.url),
                            round: Set(p.round),
                            mark: Set(p.mark),
                            component: Set(p.component),
                            description: Set(p.description),
                            size: Set(p.size),
                            shape: Set(p.shape),
                            direction: Set(p.direction),
                            background: Set(p.background.and_then(toDeserialize)),
                            backdrop: Set(p.backdrop.and_then(toDeserialize)),
                            mirror_id: Set(p.mirror_id),
                            text_color: Set(p.text_color),
                            collection_id: Set(p.collection_id),
                            download_count: Set(0),
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

    async fn update_one<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        payload: schema::Update,
    ) -> Result<String, Exception> {
        let model = schema::Entity::find_by_id(payload.key.clone())
            .one(db)
            .await?
            .ok_or_else(|| {
                Exception::NotFound(format!("magnetic tile not found: {}", payload.key))
            })?;

        let mut active: schema::ActiveModel = model.into();
        let now = Utc::now().timestamp_millis();

        if let Some(v) = payload.change.index {
            active.index = Set(v);
        }
        if let Some(v) = payload.change.title {
            active.title = Set(v);
        }
        if let Some(v) = payload.change.url {
            active.url = Set(Some(v));
        }
        if let Some(v) = payload.change.round {
            active.round = Set(Some(v));
        }
        if let Some(v) = payload.change.mark {
            active.mark = Set(Some(v));
        }
        if let Some(v) = payload.change.size {
            active.size = Set(v);
        }
        if let Some(v) = payload.change.shape {
            active.shape = Set(v);
        }
        if let Some(v) = payload.change.direction {
            active.direction = Set(v);
        }
        if let Some(v) = payload.change.description {
            active.description = Set(Some(v));
        }
        if let Some(v) = payload.change.background {
            active.background = Set(toDeserialize(v));
        }
        if let Some(v) = payload.change.backdrop {
            active.backdrop = Set(toDeserialize(v));
        }
        if let Some(v) = payload.change.mirror_id {
            active.mirror_id = Set(v);
        }
        if let Some(v) = payload.change.text_color {
            active.text_color = Set(Some(v));
        }
        if let Some(v) = payload.change.collection_id {
            active.collection_id = Set(Some(v));
        }
        if let Some(v) = payload.change.download_count {
            active.download_count = Set(v);
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
        if let Some(ref url) = payload.url {
            cond = cond.add(schema::Column::Url.eq(url.clone()));
        }
        if let Some(ref description) = payload.description {
            cond = cond.add(schema::Column::Description.eq(description.clone()));
        }
        if let Some(ref mirror_id) = payload.mirror_id {
            cond = cond.add(schema::Column::MirrorId.eq(mirror_id.clone()));
        }
        if let Some(download_count) = payload.download_count {
            cond = cond.add(schema::Column::DownloadCount.eq(download_count));
        }
        if let Some(updated_at) = payload.updated_at {
            cond = cond.add(schema::Column::UpdatedAt.eq(updated_at));
        }
        if let Some(ref collection_id) = payload.collection_id {
            cond = cond.add(schema::Column::CollectionId.eq(collection_id.clone()));
        }
        if let Some(size) = payload.size {
            cond = cond.add(schema::Column::Size.eq(size));
        }
        if let Some(ref shape) = payload.shape {
            cond = cond.add(schema::Column::Shape.eq(shape.clone()));
        }
        if let Some(ref direction) = payload.direction {
            cond = cond.add(schema::Column::Direction.eq(direction.clone()));
        }
        cond
    }
}
