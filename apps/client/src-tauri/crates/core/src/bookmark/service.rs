use chrono::Utc;
use cogito_database::entity::bookmark as schema;
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
                    .order_by_asc(schema::Column::Title)
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
                    .order_by_asc(schema::Column::Title)
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
                let mut ids = Vec::with_capacity(ps.len());
                for p in ps {
                    ids.push(Self::update_one(&txn, p).await?);
                }
                txn.commit().await?;
                Ok(ids)
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
                Self::remove_subtree(db, &id).await?;
                Ok(vec![id])
            }
            schema::RemoveP::Many(ids) => {
                if ids.is_empty() {
                    return Ok(vec![]);
                }
                let txn = db.begin().await?;
                for id in &ids {
                    Self::remove_subtree(&txn, id).await?;
                }
                txn.commit().await?;
                Ok(ids)
            }
        }
    }

    /// 将导入树写入 bookmark 表；重复 url 按 skip / overwrite。
    #[allow(non_snake_case)]
    pub async fn toImport<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::ImportP,
    ) -> Result<schema::ImportR, Exception> {
        let strategy = params.strategy.to_ascii_lowercase();
        if strategy != "skip" && strategy != "overwrite" {
            return Err(Exception::Validation(
                "strategy 仅支持 skip 或 overwrite".to_string(),
            ));
        }

        let txn = db.begin().await?;
        let mut inserted = 0_i32;
        let mut skipped = 0_i32;
        let mut updated = 0_i32;

        for (index, root) in params.roots.iter().enumerate() {
            Self::import_node(
                &txn,
                &params.mirror_id,
                None,
                root,
                index as i32,
                &strategy,
                &mut inserted,
                &mut skipped,
                &mut updated,
            )
            .await?;
        }

        txn.commit().await?;
        Ok(schema::ImportR {
            inserted,
            skipped,
            updated,
        })
    }

    #[allow(clippy::too_many_arguments)]
    async fn import_node<C: ConnectionTrait>(
        db: &C,
        mirror_id: &str,
        parent_id: Option<String>,
        node: &schema::ImportNode,
        index: i32,
        strategy: &str,
        inserted: &mut i32,
        skipped: &mut i32,
        updated: &mut i32,
    ) -> Result<(), Exception> {
        let title = node.title.trim();
        let title = if title.is_empty() { "未命名" } else { title };

        if let Some(raw_url) = node
            .url
            .as_ref()
            .map(|u| u.trim())
            .filter(|u| !u.is_empty())
        {
            if raw_url.starts_with("javascript:")
                || raw_url.starts_with("data:")
                || raw_url.starts_with("vbscript:")
            {
                *skipped += 1;
                return Ok(());
            }
            let url = normalize_url(raw_url);

            if let Some(existing) = schema::Entity::find()
                .filter(schema::Column::MirrorId.eq(mirror_id))
                .filter(schema::Column::Url.eq(url.clone()))
                .one(db)
                .await?
            {
                if strategy == "skip" {
                    *skipped += 1;
                    return Ok(());
                }
                let now = Utc::now().timestamp_millis();
                let mut am: schema::ActiveModel = existing.into();
                am.title = Set(title.to_string());
                am.parent_id = Set(parent_id);
                am.index = Set(index);
                am.updated_at = Set(now);
                am.update(db).await?;
                *updated += 1;
                return Ok(());
            }

            Self::write_one(
                db,
                schema::Write {
                    mirror_id: mirror_id.to_string(),
                    parent_id,
                    title: title.to_string(),
                    url: Some(url),
                    index,
                },
            )
            .await?;
            *inserted += 1;
            return Ok(());
        }

        // 文件夹：同 parent 下同名则复用
        let folder = schema::Entity::find()
            .filter(schema::Column::MirrorId.eq(mirror_id))
            .filter(schema::Column::Url.is_null())
            .filter(schema::Column::Title.eq(title))
            .filter(match &parent_id {
                Some(pid) => schema::Column::ParentId.eq(pid.clone()),
                None => schema::Column::ParentId.is_null(),
            })
            .one(db)
            .await?;

        let folder_id = if let Some(existing) = folder {
            existing.id
        } else {
            let id = Self::write_one(
                db,
                schema::Write {
                    mirror_id: mirror_id.to_string(),
                    parent_id: parent_id.clone(),
                    title: title.to_string(),
                    url: None,
                    index,
                },
            )
            .await?;
            *inserted += 1;
            id
        };

        for (child_index, child) in node.children.iter().enumerate() {
            Box::pin(Self::import_node(
                db,
                mirror_id,
                Some(folder_id.clone()),
                child,
                child_index as i32,
                strategy,
                inserted,
                skipped,
                updated,
            ))
            .await?;
        }

        Ok(())
    }

    async fn write_one<C: ConnectionTrait>(db: &C, p: schema::Write) -> Result<String, Exception> {
        let now = Utc::now().timestamp_millis();
        let id = Uuid::new_v4().to_string();
        let model = schema::ActiveModel {
            id: Set(id.clone()),
            mirror_id: Set(p.mirror_id),
            parent_id: Set(p.parent_id),
            title: Set(p.title),
            url: Set(p.url),
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
        let model = schema::Entity::find_by_id(p.key.clone())
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("bookmark:{}", p.key)))?;
        let now = Utc::now().timestamp_millis();
        let mut am: schema::ActiveModel = model.into();
        if let Some(title) = p.change.title {
            am.title = Set(title);
        }
        if let Some(url) = p.change.url {
            am.url = Set(url);
        }
        if let Some(parent_id) = p.change.parent_id {
            am.parent_id = Set(parent_id);
        }
        if let Some(index) = p.change.index {
            am.index = Set(index);
        }
        am.updated_at = Set(now);
        am.update(db).await?;
        Ok(p.key)
    }

    async fn remove_subtree<C: ConnectionTrait>(db: &C, id: &str) -> Result<(), Exception> {
        let children = schema::Entity::find()
            .filter(schema::Column::ParentId.eq(id.to_string()))
            .all(db)
            .await?;
        for child in children {
            Box::pin(Self::remove_subtree(db, &child.id)).await?;
        }
        schema::Entity::delete_by_id(id.to_string())
            .exec(db)
            .await?;
        Ok(())
    }

    fn build_read_filter(p: &schema::Read) -> Condition {
        let mut cond = Condition::all();
        if let Some(id) = &p.id {
            cond = cond.add(schema::Column::Id.eq(id.clone()));
        }
        if let Some(mirror_id) = &p.mirror_id {
            cond = cond.add(schema::Column::MirrorId.eq(mirror_id.clone()));
        }
        if let Some(parent) = &p.parent_id {
            cond = match parent {
                Some(pid) => cond.add(schema::Column::ParentId.eq(pid.clone())),
                None => cond.add(schema::Column::ParentId.is_null()),
            };
        }
        if let Some(url) = &p.url {
            cond = cond.add(schema::Column::Url.eq(url.clone()));
        }
        cond
    }
}

fn normalize_url(url: &str) -> String {
    let trimmed = url.trim();
    let without_hash = trimmed.split('#').next().unwrap_or(trimmed);
    let mut href = without_hash.to_string();
    if href.len() > 8 && href.ends_with('/') {
        href.pop();
    }
    href
}
