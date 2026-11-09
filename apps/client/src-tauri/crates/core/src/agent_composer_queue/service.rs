#![allow(non_snake_case)]

use chrono::Utc;
use cogito_database::entity::agent_composer_queue as schema;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, Condition, ConnectionTrait, EntityTrait,
    QueryFilter, QueryOrder, TransactionTrait,
};
use uuid::Uuid;

use crate::exception::Exception;

pub struct Service;

impl Service {
    pub async fn toWrite<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::WriteP,
    ) -> Result<Vec<String>, Exception> {
        match params {
            schema::WriteP::One(p) => Ok(vec![Self::write_one(db, p, 0).await?]),
            schema::WriteP::Many(ps) => {
                if ps.is_empty() {
                    return Ok(vec![]);
                }
                let txn = db.begin().await?;
                let mut ids = Vec::with_capacity(ps.len());
                for (index, p) in ps.into_iter().enumerate() {
                    ids.push(Self::write_one(&txn, p, index as i64).await?);
                }
                txn.commit().await?;
                Ok(ids)
            }
        }
    }

    /// 读队列：按 `lane`、`sort`、`createdAt` 升序，顺序即 UI 顺序。
    pub async fn toRead<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::ReadP,
    ) -> Result<Vec<schema::Model>, Exception> {
        let filter = match params {
            schema::ReadP::One(p) => Self::build_read_filter(&p),
            schema::ReadP::Many(ps) => {
                if ps.is_empty() {
                    return Ok(vec![]);
                }
                ps.iter()
                    .fold(Condition::any(), |any, p| any.add(Self::build_read_filter(p)))
            }
        };
        let rows = schema::Entity::find()
            .filter(filter)
            .order_by_asc(schema::Column::Lane)
            .order_by_asc(schema::Column::Sort)
            .order_by_asc(schema::Column::CreatedAt)
            .all(db)
            .await?;
        Ok(rows)
    }

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
        let models = schema::Entity::find()
            .filter(schema::Column::Id.is_in(ids.clone()))
            .all(db)
            .await?;
        if models.is_empty() {
            return Ok(vec![]);
        }
        let removed: Vec<String> = models.into_iter().map(|m| m.id).collect();
        schema::Entity::delete_many()
            .filter(schema::Column::Id.is_in(removed.clone()))
            .exec(db)
            .await?;
        Ok(removed)
    }

    /// 整队替换：一个事务里「删旧 + 插新」，`sort` 一律按入参下标重排。
    ///
    /// 为什么不让调用方自己管 `sort`：前端只会把 `composer.queue` 的数组顺序原样
    /// 送上来，让服务端做「下标即顺序」可以省掉一整类「顺序错乱」的 bug。
    pub async fn toReplace<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        params: schema::ReplaceP,
    ) -> Result<Vec<String>, Exception> {
        let replacements = match params {
            schema::ReplaceP::One(p) => vec![p],
            schema::ReplaceP::Many(ps) => ps,
        };
        if replacements.is_empty() {
            return Ok(vec![]);
        }
        let txn = db.begin().await?;
        let mut inserted = Vec::new();
        for payload in replacements {
            let mut clear = schema::Entity::delete_many()
                .filter(schema::Column::SessionId.eq(payload.sessionID.clone()));
            if let Some(lane) = payload.lane.clone() {
                clear = clear.filter(schema::Column::Lane.eq(lane));
            }
            clear.exec(&txn).await?;

            for (index, mut item) in payload.items.into_iter().enumerate() {
                item.sessionID = payload.sessionID.clone();
                if item.lane.is_empty() {
                    item.lane = "main".to_string();
                }
                if let Some(lane) = payload.lane.clone() {
                    item.lane = lane;
                }
                // 顺序的唯一真相是数组下标：调用方给的 sort 一律覆盖，
                // 否则「上移/下移」后前端传上来的乱序会被原样落库。
                item.sort = Some(index as i64);
                inserted.push(Self::write_one(&txn, item, index as i64).await?);
            }
        }
        txn.commit().await?;
        Ok(inserted)
    }

    async fn write_one<C: ConnectionTrait>(
        db: &C,
        p: schema::Write,
        fallback_sort: i64,
    ) -> Result<String, Exception> {
        let now = Utc::now().timestamp_millis();
        let id = p.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let lane = if p.lane.is_empty() {
            "main".to_string()
        } else {
            p.lane
        };
        let model = schema::ActiveModel {
            id: Set(id.clone()),
            sessionID: Set(p.sessionID),
            lane: Set(lane),
            sort: Set(p.sort.unwrap_or(fallback_sort)),
            text: Set(p.text),
            attachments: Set(p.attachments),
            createdAt: Set(p.createdAt.unwrap_or(now)),
            updatedAt: Set(p.updatedAt.unwrap_or(now)),
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
            .ok_or_else(|| {
                Exception::NotFound(format!("agent_composer_queue not found: {}", payload.key))
            })?;

        let mut active: schema::ActiveModel = model.into();
        if let Some(v) = payload.change.lane {
            active.lane = Set(v);
        }
        if let Some(v) = payload.change.sort {
            active.sort = Set(v);
        }
        if let Some(v) = payload.change.text {
            active.text = Set(v);
        }
        if let Some(v) = payload.change.attachments {
            active.attachments = Set(v);
        }
        active.updatedAt = Set(payload
            .change
            .updatedAt
            .unwrap_or_else(|| Utc::now().timestamp_millis()));
        let updated = active.update(db).await?;
        Ok(updated.id)
    }

    fn build_read_filter(payload: &schema::Read) -> Condition {
        let mut cond = Condition::all();
        if let Some(ref id) = payload.id {
            cond = cond.add(schema::Column::Id.eq(id.clone()));
        }
        if let Some(ref session_id) = payload.sessionID {
            cond = cond.add(schema::Column::SessionId.eq(session_id.clone()));
        }
        if let Some(ref lane) = payload.lane {
            cond = cond.add(schema::Column::Lane.eq(lane.clone()));
        }
        cond
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cogito_database::entity::agent_session as session_schema;
    use sea_orm::DatabaseConnection;

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

    async fn seed_session(db: &std::sync::Arc<DatabaseConnection>, id: &str) {
        session_schema::Entity::insert(session_schema::ActiveModel {
            id: Set(id.to_string()),
            title: Set("t".to_string()),
            pinned: Set(false),
            providerID: Set(None),
            workspaceID: Set(None),
            unread: Set(false),
            createdAt: Set(1),
            updatedAt: Set(1),
        })
        .exec(db.as_ref())
        .await
        .expect("session seed");
    }

    fn item(sort: Option<i64>, text: &str) -> schema::Write {
        schema::Write {
            id: None,
            sessionID: String::new(),
            lane: "main".to_string(),
            sort,
            text: text.to_string(),
            attachments: "[]".to_string(),
            createdAt: None,
            updatedAt: None,
        }
    }

    fn replace(items: Vec<schema::Write>) -> schema::ReplaceP {
        schema::ReplaceP::One(schema::Replace {
            sessionID: "s1".to_string(),
            lane: None,
            items,
        })
    }

    fn read_s1() -> schema::ReadP {
        schema::ReadP::One(schema::Read {
            id: None,
            sessionID: Some("s1".to_string()),
            lane: None,
        })
    }

    #[tokio::test]
    async fn replace_is_atomic_and_ordered() {
        let db = db().await;
        seed_session(&db, "s1").await;

        Service::toReplace(&*db, replace(vec![item(Some(99), "第一条"), item(None, "第二条")]))
            .await
            .expect("first replace");

        let rows = Service::toRead(&*db, read_s1()).await.expect("read");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].text, "第一条");
        assert_eq!(rows[0].sort, 0, "sort 必须按入参下标重排，不能沿用调用方的值");
        assert_eq!(rows[1].text, "第二条");
        assert_eq!(rows[1].sort, 1);

        Service::toReplace(&*db, replace(vec![item(None, "只剩一条")]))
            .await
            .expect("second replace");

        let rows = Service::toRead(&*db, read_s1()).await.expect("read again");
        assert_eq!(rows.len(), 1, "整队替换必须先删旧行，不是追加");
        assert_eq!(rows[0].text, "只剩一条");
        assert_eq!(rows[0].sessionID, "s1");
        assert_eq!(rows[0].lane, "main");
    }

    #[tokio::test]
    async fn removing_session_cascades_queue() {
        let db = db().await;
        seed_session(&db, "s1").await;
        Service::toReplace(&*db, replace(vec![item(None, "a")]))
            .await
            .expect("replace");

        session_schema::Entity::delete_many()
            .filter(session_schema::Column::Id.eq("s1"))
            .exec(&*db)
            .await
            .expect("delete session");

        let rows = Service::toRead(&*db, read_s1()).await.expect("read");
        assert!(rows.is_empty(), "会话删除后队列必须级联清空");
    }
}
