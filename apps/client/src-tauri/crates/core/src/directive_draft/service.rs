#![allow(non_snake_case)]

//! 指令草稿的读写（只服务客户端「AI 生成指令」闭环，不碰 corex.db）。

use chrono::Utc;
use cogito_database::entity::directive_draft as schema;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::dict::directive_draft_status;
use crate::exception::Exception;

/// 新建/覆盖草稿
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftInput {
    /// 有值则覆盖该草稿（同一会话反复生成时避免堆一堆）
    pub id: Option<String>,
    pub threadID: Option<String>,
    pub workspaceID: Option<String>,
    pub name: String,
    /// 指令定义 JSON 字符串
    pub definition: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftStatusInput {
    pub id: String,
    /// 字典 directive_draft_status value
    pub status: String,
    pub error: Option<String>,
}

pub struct Service;

impl Service {
    pub async fn toSave<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        input: DraftInput,
    ) -> Result<schema::Model, Exception> {
        let now = Utc::now().timestamp_millis();
        if let Some(id) = input.id.clone() {
            let existing = schema::Entity::find_by_id(id.clone()).one(db).await?;
            if let Some(existing) = existing {
                let mut active: schema::ActiveModel = existing.into();
                active.name = sea_orm::ActiveValue::Set(input.name);
                active.definition = sea_orm::ActiveValue::Set(input.definition);
                active.status =
                    sea_orm::ActiveValue::Set(directive_draft_status::PENDING.to_owned());
                active.error = sea_orm::ActiveValue::Set(None);
                active.updatedAt = sea_orm::ActiveValue::Set(now);
                return Ok(active.update(db).await?);
            }
            return Err(Exception::NotFound(format!("草稿不存在: {id}")));
        }

        let model = schema::Model {
            id: Uuid::new_v4().to_string(),
            threadID: input.threadID,
            workspaceID: input.workspaceID,
            name: input.name,
            definition: input.definition,
            status: directive_draft_status::PENDING.to_owned(),
            error: None,
            createdAt: now,
            updatedAt: now,
        };
        // TEXT 主键 + SQLite 下 `insert()` 会再发一次 SELECT，故用 exec 后直接返回 Model
        schema::Entity::insert(schema::ActiveModel::from(model.clone()))
            .exec(db)
            .await?;
        Ok(model)
    }

    /// 待确认草稿（新的在前）；`status` 为空时只取 pending
    pub async fn toList<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        status: Option<String>,
        limit: Option<u64>,
    ) -> Result<Vec<schema::Model>, Exception> {
        let status = status.filter(|value| !value.trim().is_empty());
        let mut query = schema::Entity::find();
        query = match status {
            Some(status) => query.filter(schema::Column::Status.eq(status)),
            None => query.filter(schema::Column::Status.eq(directive_draft_status::PENDING)),
        };
        Ok(query
            .order_by_desc(schema::Column::UpdatedAt)
            .limit(limit.unwrap_or(20))
            .all(db)
            .await?)
    }

    pub async fn toSetStatus<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        input: DraftStatusInput,
    ) -> Result<schema::Model, Exception> {
        crate::dict::Service::assertValue(db, directive_draft_status::TYPE, &input.status).await?;
        let existing = schema::Entity::find_by_id(input.id.clone())
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("草稿不存在: {}", input.id)))?;
        let mut active: schema::ActiveModel = existing.into();
        active.status = sea_orm::ActiveValue::Set(input.status);
        active.error = sea_orm::ActiveValue::Set(input.error);
        active.updatedAt = sea_orm::ActiveValue::Set(Utc::now().timestamp_millis());
        Ok(active.update(db).await?)
    }

    pub async fn toRemove<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        id: String,
    ) -> Result<u64, Exception> {
        let result = schema::Entity::delete_by_id(id).exec(db).await?;
        Ok(result.rows_affected)
    }
}
