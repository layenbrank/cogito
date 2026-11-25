use chrono::Utc;
use cogito_database::entity::magnetic_tile as schema;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, Condition, ConnectionTrait, EntityTrait,
    QueryFilter, QueryOrder, TransactionTrait, sea_query::Expr,
};
use uuid::Uuid;

use crate::exception::Exception;

#[allow(non_snake_case)]
fn toDeserialize<T: serde::Serialize>(v: T) -> Option<String> {
    serde_json::to_string(&v).ok()
}

pub struct Service;

/// 分配 index 必须「读最大值 → 插入」原子。
///
/// SQLite 的 deferred 事务不保证这点（两个事务可能都读到同一个 max），
/// 而本进程是这张表的唯一写者 —— 一把进程内异步锁就是最便宜的串行化。
/// 临界区只有一次 insert，耗时在微秒级。
static WRITE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

impl Service {
    /// 该镜像当前可用的下一个 index（`MAX(index) + 1`）。
    ///
    /// 只取末行而不是整表：前端以前靠 `READ` 全表算号，一次追加就是一次整表 JSON 往返。
    async fn next_index<C: ConnectionTrait>(db: &C, mirror_id: &str) -> Result<i32, Exception> {
        let last = schema::Entity::find()
            .filter(schema::Column::MirrorId.eq(mirror_id))
            .order_by_desc(schema::Column::Index)
            .one(db)
            .await?;
        Ok(last.map_or(0, |row| row.index + 1))
    }

    #[allow(non_snake_case)]
    pub async fn toWrite<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::WriteP,
    ) -> Result<Vec<String>, Exception> {
        let _guard = WRITE_LOCK.lock().await;
        match params {
            schema::WriteP::One(p) => {
                let now = Utc::now().timestamp_millis();
                let id = Uuid::new_v4().to_string();
                let index = match p.index {
                    Some(index) => index,
                    None => Self::next_index(db, &p.mirror_id).await?,
                };
                let model = schema::ActiveModel {
                    id: Set(id.clone()),
                    index: Set(index),
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

                let txn = db.begin().await?;
                let now = Utc::now().timestamp_millis();
                let mut ids = Vec::with_capacity(ps.len());
                // (mirrorID, 下一个可用号)：同一批里服务端分配的号必须连续不撞
                let mut cursor: Option<(String, i32)> = None;
                let mut models = Vec::with_capacity(ps.len());
                for p in ps {
                    let id = Uuid::new_v4().to_string();
                    ids.push(id.clone());
                    let index = match p.index {
                        Some(explicit) => {
                            // 显式号越过游标时把游标推到它后面，避免后续自动号撞上
                            if let Some((mirror, next)) = cursor.as_mut() {
                                if *mirror == p.mirror_id && explicit >= *next {
                                    *next = explicit + 1;
                                }
                            }
                            explicit
                        }
                        None => match cursor.as_mut() {
                            Some((mirror, next)) if *mirror == p.mirror_id => {
                                let value = *next;
                                *next += 1;
                                value
                            }
                            _ => {
                                let value = Self::next_index(&txn, &p.mirror_id).await?;
                                cursor = Some((p.mirror_id.clone(), value + 1));
                                value
                            }
                        },
                    };
                    models.push(schema::ActiveModel {
                        id: Set(id),
                        index: Set(index),
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
                    });
                }

                schema::Entity::insert_many(models).exec(&txn).await?;
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

    /// 删磁贴。**删集合时先把名下成员解绑成顶层**（同一事务）：
    ///
    /// 墙上只显示 `collectionID` 为空的磁贴，留下指向已删父级的 `collectionID`
    /// 等于把它们藏起来（既不上墙、也再没有入口）。这件事放服务端做，
    /// 前端就不必为了找成员把整表读一遍再发一轮 update。
    #[allow(non_snake_case)]
    pub async fn toRemove<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::RemoveP,
    ) -> Result<Vec<String>, Exception> {
        let ids = match params {
            schema::RemoveP::One(p) => vec![p],
            schema::RemoveP::Many(ps) => ps,
        };
        if ids.is_empty() {
            return Ok(vec![]);
        }

        let txn = db.begin().await?;
        let now = Utc::now().timestamp_millis();
        schema::Entity::update_many()
            .col_expr(
                schema::Column::CollectionId,
                Expr::value(Option::<String>::None),
            )
            .col_expr(schema::Column::UpdatedAt, Expr::value(now))
            .filter(schema::Column::CollectionId.is_in(ids.clone()))
            .exec(&txn)
            .await?;
        schema::Entity::delete_many()
            .filter(schema::Column::Id.is_in(ids.clone()))
            .exec(&txn)
            .await?;
        txn.commit().await?;

        Ok(ids)
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
        if let Some(collection_id) = payload.change.collection_id {
            // 外层 Some = 用户明确要改；内层 None = 移出集合
            active.collection_id = Set(collection_id);
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

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{DatabaseBackend, DatabaseConnection, Statement};

    async fn db() -> std::sync::Arc<DatabaseConnection> {
        let connection = std::sync::Arc::new(
            sea_orm::Database::connect("sqlite::memory:")
                .await
                .expect("connect in-memory sqlite"),
        );
        cogito_database::migration::run(&connection)
            .await
            .expect("migration should succeed");
        connection
    }

    /// 磁贴有指向 mirror 的外键，测试里先塞一个镜像
    async fn seed_mirror(db: &DatabaseConnection, id: &str) {
        db.execute(Statement::from_string(
            DatabaseBackend::Sqlite,
            format!(
                "INSERT INTO mirror (id, title, \"index\", mark, description, overlay, \
                 background, backdrop, \"archivedAt\", \"updatedAt\", \"createdAt\") \
                 VALUES ('{id}', '测试墙', 0, '', '', 'default', NULL, NULL, NULL, 0, 0)"
            ),
        ))
        .await
        .expect("seed mirror");
    }

    fn tile(index: Option<i32>, collection_id: Option<&str>) -> schema::Write {
        schema::Write {
            index,
            title: "块".to_string(),
            url: Some("https://example.com".to_string()),
            round: None,
            mark: None,
            component: "navigation".to_string(),
            description: None,
            background: None,
            backdrop: None,
            size: 1,
            shape: schema::Shape::Square,
            direction: schema::Direction::Vertical,
            mirror_id: "m1".to_string(),
            text_color: None,
            collection_id: collection_id.map(str::to_string),
        }
    }

    async fn index_of(db: &DatabaseConnection, id: &str) -> Option<i32> {
        schema::Entity::find_by_id(id.to_string())
            .one(db)
            .await
            .expect("read tile")
            .map(|row| row.index)
    }

    /// 不传 index 时服务端接着最大值排：前端因此不用「读全表 → 算号 → 排队」
    #[tokio::test]
    async fn write_without_index_appends_after_max() {
        let db = db().await;
        seed_mirror(&db, "m1").await;

        Service::toWrite(
            &*db,
            schema::WriteP::Many(vec![tile(Some(0), None), tile(Some(7), None)]),
        )
        .await
        .expect("write explicit indices");

        let ids = Service::toWrite(
            &*db,
            schema::WriteP::Many(vec![tile(None, None), tile(None, None)]),
        )
        .await
        .expect("write auto indices");

        assert_eq!(index_of(&*db, &ids[0]).await, Some(8));
        assert_eq!(index_of(&*db, &ids[1]).await, Some(9));

        // 单条写入也走同一条分配路径
        let single = Service::toWrite(&*db, schema::WriteP::One(tile(None, None)))
            .await
            .expect("write single");
        assert_eq!(index_of(&*db, &single[0]).await, Some(10));
    }

    /// 删集合要把成员解绑成顶层：墙上只显示 collectionID 为空的磁贴，
    /// 留下悬空 collectionID 等于把成员藏起来（既不上墙、也再没有入口）
    #[tokio::test]
    async fn remove_collection_unparents_members() {
        let db = db().await;
        seed_mirror(&db, "m1").await;

        let ids = Service::toWrite(
            &*db,
            schema::WriteP::Many(vec![tile(None, None), tile(None, None), tile(None, None)]),
        )
        .await
        .expect("seed tiles");
        let (collection, member, spare) = (ids[0].clone(), ids[1].clone(), ids[2].clone());

        Service::toUpdate(
            &*db,
            schema::UpdateP::Many(vec![schema::Update {
                key: member.clone(),
                change: schema::Change {
                    collection_id: Some(Some(collection.clone())),
                    ..Default::default()
                },
            }]),
        )
        .await
        .expect("move member into collection");

        Service::toRemove(&*db, schema::RemoveP::One(collection.clone()))
            .await
            .expect("remove collection");

        let member_row = schema::Entity::find_by_id(member.clone())
            .one(&*db)
            .await
            .expect("read member")
            .expect("member should survive");
        assert_eq!(member_row.collection_id, None);
        assert!(
            schema::Entity::find_by_id(collection)
                .one(&*db)
                .await
                .expect("read removed collection")
                .is_none()
        );
        // 与集合无关的磁贴不受影响
        assert!(
            schema::Entity::find_by_id(spare)
                .one(&*db)
                .await
                .expect("read spare")
                .is_some()
        );
    }
}
