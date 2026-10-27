use chrono::Utc;
use cogito_database::entity::overlay as schema;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter,
    QueryOrder, TransactionTrait,
};
use uuid::Uuid;

use crate::exception::Exception;

pub struct Service;

impl Service {
    /// 读取浮层项：磁贴（tile）始终返回；贴图（texture）仅返回未归档行。按 z 升序。
    pub async fn read<C: ConnectionTrait + TransactionTrait>(
        db: &C,
    ) -> Result<Vec<schema::Model>, Exception> {
        let rows = schema::Entity::find()
            .filter(
                schema::Column::Kind
                    .eq("tile")
                    .or(schema::Column::ArchivedAt.is_null()),
            )
            .order_by_asc(schema::Column::Z)
            .all(db)
            .await?;
        Ok(rows)
    }

    /// 写入浮层项：tile 以 `tenantID` 作 id（存在则更新）；texture 生成 UUID。
    pub async fn write<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        item: schema::Write,
    ) -> Result<String, Exception> {
        if item.kind == "tile" && item.tenant_id.is_some() {
            let id = item.tenant_id.clone().unwrap();
            if let Some(existing) = schema::Entity::find_by_id(id.clone()).one(db).await? {
                // 磁贴仅硬删除，此处为更新已存在的行
                let mut active: schema::ActiveModel = existing.into();
                Self::apply_write(&mut active, &item);
                active.updated_at = Set(Utc::now().timestamp_millis());
                active.update(db).await?;
                return Ok(id);
            }
            Self::insert(db, id, item).await
        } else {
            let id = Uuid::new_v4().to_string();
            Self::insert(db, id, item).await
        }
    }

    /// 按 id 局部更新，仅覆盖 patch 中 `Some` 的字段。
    pub async fn update<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        id: String,
        patch: schema::Update,
    ) -> Result<(), Exception> {
        let model = schema::Entity::find_by_id(id.clone())
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("overlay not found: {id}")))?;

        let mut active: schema::ActiveModel = model.into();
        if let Some(v) = patch.x {
            active.x = Set(v);
        }
        if let Some(v) = patch.y {
            active.y = Set(v);
        }
        if let Some(v) = patch.w {
            active.w = Set(v);
        }
        if let Some(v) = patch.h {
            active.h = Set(v);
        }
        if let Some(v) = patch.z {
            active.z = Set(v);
        }
        if let Some(v) = patch.src {
            active.src = Set(Some(v));
        }
        if let Some(v) = patch.opacity {
            active.opacity = Set(Some(v));
        }
        if let Some(v) = patch.component {
            active.component = Set(Some(v));
        }
        if let Some(v) = patch.size {
            active.size = Set(Some(v));
        }
        if let Some(v) = patch.shape {
            active.shape = Set(Some(v));
        }
        if let Some(v) = patch.direction {
            active.direction = Set(Some(v));
        }
        if let Some(v) = patch.round {
            active.round = Set(Some(v));
        }
        if let Some(v) = patch.background {
            active.background = Set(Some(v));
        }
        if let Some(v) = patch.title {
            active.title = Set(v);
        }
        if let Some(v) = patch.mark {
            active.mark = Set(Some(v));
        }
        if let Some(v) = patch.scale {
            active.scale = Set(v);
        }
        active.updated_at = Set(Utc::now().timestamp_millis());

        active.update(db).await?;
        Ok(())
    }

    /// 删除浮层项：磁贴（tile）硬删除（物理 DELETE）；贴图（texture）软删除（置 archivedAt）。
    pub async fn remove<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        ids: Vec<String>,
    ) -> Result<(), Exception> {
        if ids.is_empty() {
            return Ok(());
        }

        let models = schema::Entity::find()
            .filter(schema::Column::Id.is_in(&ids))
            .all(db)
            .await?;
        if models.is_empty() {
            return Ok(());
        }

        let (tile_models, texture_models): (Vec<_>, Vec<_>) =
            models.into_iter().partition(|m| m.kind == "tile");
        let tile_ids: Vec<String> = tile_models.into_iter().map(|m| m.id).collect();
        let texture_ids: Vec<String> = texture_models.into_iter().map(|m| m.id).collect();

        // 磁贴：物理 DELETE
        if !tile_ids.is_empty() {
            schema::Entity::delete_many()
                .filter(schema::Column::Id.is_in(&tile_ids))
                .exec(db)
                .await?;
        }

        // 贴图：软删除（置 archivedAt）
        if !texture_ids.is_empty() {
            let now = Utc::now().timestamp_millis();
            let txn = db.begin().await?;
            for model in schema::Entity::find()
                .filter(schema::Column::Id.is_in(&texture_ids))
                .all(&txn)
                .await?
            {
                let mut active: schema::ActiveModel = model.into();
                active.archived_at = Set(Some(now));
                active.updated_at = Set(now);
                active.update(&txn).await?;
            }
            txn.commit().await?;
        }

        Ok(())
    }

    async fn insert<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        id: String,
        p: schema::Write,
    ) -> Result<String, Exception> {
        let now = Utc::now().timestamp_millis();
        let model = schema::ActiveModel {
            id: Set(id.clone()),
            kind: Set(p.kind),
            x: Set(p.x),
            y: Set(p.y),
            w: Set(p.w),
            h: Set(p.h),
            z: Set(p.z),
            src: Set(p.src),
            opacity: Set(p.opacity),
            tenant_id: Set(p.tenant_id),
            component: Set(p.component),
            size: Set(p.size),
            shape: Set(p.shape),
            direction: Set(p.direction),
            round: Set(p.round),
            background: Set(p.background),
            title: Set(p.title),
            mark: Set(p.mark),
            scale: Set(p.scale),
            archived_at: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
        };
        schema::Entity::insert(model).exec(db).await?;
        Ok(id)
    }

    /// 将写入体全字段覆盖到已有行（不动 id/archived_at/created_at）。
    fn apply_write(active: &mut schema::ActiveModel, p: &schema::Write) {
        active.kind = Set(p.kind.clone());
        active.x = Set(p.x);
        active.y = Set(p.y);
        active.w = Set(p.w);
        active.h = Set(p.h);
        active.z = Set(p.z);
        active.src = Set(p.src.clone());
        active.opacity = Set(p.opacity);
        active.tenant_id = Set(p.tenant_id.clone());
        active.component = Set(p.component.clone());
        active.size = Set(p.size.clone());
        active.shape = Set(p.shape.clone());
        active.direction = Set(p.direction.clone());
        active.round = Set(p.round.clone());
        active.background = Set(p.background.clone());
        active.title = Set(p.title.clone());
        active.mark = Set(p.mark.clone());
        active.scale = Set(p.scale);
    }
}
