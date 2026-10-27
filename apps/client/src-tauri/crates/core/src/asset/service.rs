use chrono::Utc;
use cogito_database::entity::asset::{
    self as schema, ActiveModel, Change, Insert, InsertP, InsertR, Model, Read, ReadP, Remove,
    RemoveP, Update, UpdateP,
};
use sea_orm::ActiveValue::Set;
use sea_orm::Condition;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect, TransactionTrait,
};
use uuid::Uuid;

use crate::exception::Exception;

pub struct Service;

impl Service {
    #[allow(non_snake_case)]
    pub async fn toRead<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: ReadP,
    ) -> Result<Vec<Model>, Exception> {
        match params {
            ReadP::One(p) => Self::read_query(db, &p).await,
            ReadP::Many(ps) => {
                let mut rows = Vec::new();
                for p in ps {
                    rows.extend(Self::read_query(db, &p).await?);
                }
                Ok(rows)
            }
        }
    }

    #[allow(non_snake_case)]
    pub async fn toInsert<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: InsertP,
    ) -> Result<Vec<InsertR>, Exception> {
        match params {
            InsertP::One(p) => {
                let now = Utc::now().timestamp_millis();
                let (model, response) = Self::build_insert_active(p, now);
                schema::Entity::insert(model).exec(db).await?;
                Ok(vec![response])
            }
            InsertP::Many(ps) => {
                if ps.is_empty() {
                    return Ok(vec![]);
                }
                let now = Utc::now().timestamp_millis();
                let mut responses = Vec::with_capacity(ps.len());
                let models: Vec<ActiveModel> = ps
                    .into_iter()
                    .map(|p| {
                        let (model, resp) = Self::build_insert_active(p, now);
                        responses.push(resp);
                        model
                    })
                    .collect();
                schema::Entity::insert_many(models).exec(db).await?;
                Ok(responses)
            }
        }
    }

    #[allow(non_snake_case)]
    pub async fn toUpdate<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: UpdateP,
    ) -> Result<Vec<InsertR>, Exception> {
        match params {
            UpdateP::One(body) => Ok(vec![Self::update_one(db, body).await?]),
            UpdateP::Many(bodies) => {
                if bodies.is_empty() {
                    return Ok(vec![]);
                }
                let txn = db.begin().await?;
                let mut results = Vec::with_capacity(bodies.len());
                for body in bodies {
                    results.push(Self::update_one(&txn, body).await?);
                }
                txn.commit().await?;
                Ok(results)
            }
        }
    }

    #[allow(non_snake_case)]
    pub async fn toRemove<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: RemoveP,
    ) -> Result<Vec<String>, Exception> {
        match params {
            RemoveP::One(p) => Self::remove_matching(db, &p).await,
            RemoveP::Many(ps) => {
                let mut ids = Vec::new();
                for p in ps {
                    ids.extend(Self::remove_matching(db, &p).await?);
                }
                Ok(ids)
            }
        }
    }

    #[allow(non_snake_case)]
    pub async fn toRemoveByTenant<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        tenant_id: &str,
    ) -> Result<Vec<String>, Exception> {
        let models: Vec<Model> = schema::Entity::find()
            .filter(schema::Column::TenantId.eq(tenant_id))
            .all(db)
            .await?;
        if models.is_empty() {
            return Ok(vec![]);
        }
        let ids: Vec<String> = models.iter().map(|m| m.id.clone()).collect();
        schema::Entity::delete_many()
            .filter(schema::Column::Id.is_in(ids.clone()))
            .exec(db)
            .await?;
        Ok(ids)
    }

    async fn read_query<C: ConnectionTrait>(
        db: &C,
        payload: &Read,
    ) -> Result<Vec<Model>, Exception> {
        let mut query = schema::Entity::find()
            .filter(Self::read_filter(payload))
            .order_by_asc(schema::Column::Index)
            .order_by_desc(schema::Column::CreatedAt);
        if let Some(offset) = payload.offset {
            query = query.offset(offset);
        }
        if let Some(limit) = payload.limit {
            query = query.limit(limit);
        }
        Ok(query.all(db).await?)
    }

    async fn update_one<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        body: Update,
    ) -> Result<InsertR, Exception> {
        let model = schema::Entity::find()
            .filter(schema::Column::Id.eq(body.id.clone()))
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("asset not found: {}", body.id)))?;
        let now = Utc::now().timestamp_millis();
        let active = Self::build_update_active(model, body.updates, now);
        let updated = active.update(db).await?;
        Ok(InsertR { id: updated.id })
    }

    async fn remove_matching<C: ConnectionTrait>(
        db: &C,
        payload: &Remove,
    ) -> Result<Vec<String>, Exception> {
        let cond = Self::remove_filter(payload)?;
        let models: Vec<Model> = schema::Entity::find()
            .filter(cond)
            .order_by_asc(schema::Column::Id)
            .all(db)
            .await?;
        if models.is_empty() {
            return Ok(vec![]);
        }
        let ids: Vec<String> = models.iter().map(|m| m.id.clone()).collect();
        schema::Entity::delete_many()
            .filter(schema::Column::Id.is_in(ids.clone()))
            .exec(db)
            .await?;
        Ok(ids)
    }

    fn read_filter(payload: &Read) -> Condition {
        let mut cond = Condition::all();
        if let Some(ref tenant_id) = payload.tenant_id {
            cond = cond.add(schema::Column::TenantId.eq(tenant_id.clone()));
        }
        if let Some(ref kind) = payload.kind {
            cond = cond.add(schema::Column::Kind.eq(kind.clone()));
        }
        if let Some(ref id) = payload.id {
            cond = cond.add(schema::Column::Id.eq(id.clone()));
        }
        if let Some(ref hash) = payload.hash {
            cond = cond.add(schema::Column::Hash.eq(hash.clone()));
        }
        if let Some(ref mime) = payload.mime {
            cond = cond.add(schema::Column::Mime.eq(mime.clone()));
        }
        if let Some(ref status) = payload.status {
            cond = cond.add(schema::Column::Status.eq(status.clone()));
        }
        if let Some(ref device_id) = payload.device_id {
            cond = cond.add(schema::Column::DeviceId.eq(device_id.clone()));
        }
        if let Some(ref ext) = payload.extension {
            cond = cond.add(schema::Column::Extension.eq(ext.clone()));
        }
        if let Some(ref name) = payload.file_name {
            cond = cond.add(schema::Column::FileName.eq(name.clone()));
        }
        cond
    }

    fn remove_filter(payload: &Remove) -> Result<Condition, Exception> {
        let has = payload.id.is_some()
            || payload.tenant_id.is_some()
            || payload.kind.is_some()
            || payload.hash.is_some()
            || payload.mime.is_some()
            || payload.extension.is_some()
            || payload.file_name.is_some()
            || payload.status.is_some()
            || payload.device_id.is_some();
        if !has {
            return Err(Exception::Validation(
                "remove payload must specify at least one criterion".into(),
            ));
        }
        let mut cond = Condition::all();
        if let Some(ref id) = payload.id {
            cond = cond.add(schema::Column::Id.eq(id.clone()));
        }
        if let Some(ref tenant_id) = payload.tenant_id {
            cond = cond.add(schema::Column::TenantId.eq(tenant_id.clone()));
        }
        if let Some(ref kind) = payload.kind {
            cond = cond.add(schema::Column::Kind.eq(kind.clone()));
        }
        if let Some(ref hash) = payload.hash {
            cond = cond.add(schema::Column::Hash.eq(hash.clone()));
        }
        if let Some(ref mime) = payload.mime {
            cond = cond.add(schema::Column::Mime.eq(mime.clone()));
        }
        if let Some(ref ext) = payload.extension {
            cond = cond.add(schema::Column::Extension.eq(ext.clone()));
        }
        if let Some(ref name) = payload.file_name {
            cond = cond.add(schema::Column::FileName.eq(name.clone()));
        }
        if let Some(ref status) = payload.status {
            cond = cond.add(schema::Column::Status.eq(status.clone()));
        }
        if let Some(ref device_id) = payload.device_id {
            cond = cond.add(schema::Column::DeviceId.eq(device_id.clone()));
        }
        Ok(cond)
    }

    fn build_insert_active(payload: Insert, now: i64) -> (ActiveModel, InsertR) {
        let id = Uuid::new_v4().to_string();
        let ext = if payload.extension.is_empty() {
            None
        } else {
            Some(payload.extension)
        };
        let model = ActiveModel {
            id: Set(id.clone()),
            tenant_id: Set(payload.tenant_id),
            kind: Set(payload.kind),
            hash: Set(payload.hash),
            sha: Set(payload.sha.unwrap_or_else(|| "sha256".to_string())),
            size: Set(payload.size),
            index: Set(payload.index.unwrap_or(1)),
            mime: Set(payload.mime),
            extension: Set(ext),
            file_name: Set(payload.file_name),
            file_path: Set(payload.file_path),
            metadata: Set(payload.metadata),
            status: Set(payload.status.unwrap_or_else(|| "001".to_string())),
            device_id: Set(payload.device_id),
            archived_at: Set(payload.archived_at),
            created_at: Set(now),
            updated_at: Set(now),
        };
        (model, InsertR { id })
    }

    fn build_update_active(model: Model, updates: Change, now: i64) -> ActiveModel {
        let ext = if updates.extension.is_empty() {
            None
        } else {
            Some(updates.extension)
        };
        let mut active: ActiveModel = model.into();
        active.tenant_id = Set(updates.tenant_id);
        active.kind = Set(updates.kind);
        active.hash = Set(updates.hash);
        active.sha = Set(updates.sha.unwrap_or_else(|| "sha256".to_string()));
        active.size = Set(updates.size);
        active.index = Set(updates.index.unwrap_or(1));
        active.mime = Set(updates.mime);
        active.extension = Set(ext);
        active.file_name = Set(updates.file_name);
        active.file_path = Set(updates.file_path);
        active.metadata = Set(updates.metadata);
        active.status = Set(updates.status.unwrap_or_else(|| "001".to_string()));
        active.device_id = Set(updates.device_id);
        active.archived_at = Set(updates.archived_at);
        active.updated_at = Set(now);
        active
    }
}
