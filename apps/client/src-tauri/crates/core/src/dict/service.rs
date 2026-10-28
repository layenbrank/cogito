#![allow(non_snake_case)]

use chrono::Utc;
use cogito_database::entity::{dict_item as item_schema, dict_type as type_schema};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, Set,
    TransactionTrait,
};
use serde::{Deserialize, Serialize};

use crate::exception::Exception;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictItemView {
    pub id: String,
    pub type_code: String,
    pub value: String,
    pub label: String,
    pub sort: i32,
    pub enabled: bool,
    pub is_default: bool,
    pub meta: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictTypeView {
    pub type_code: String,
    pub name: String,
    pub description: Option<String>,
    pub items: Vec<DictItemView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateItemInput {
    pub id: String,
    pub label: Option<String>,
    pub sort: Option<i32>,
    pub enabled: Option<bool>,
    pub meta: Option<String>,
}

pub struct Service;

impl Service {
    pub async fn findItems<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        type_code: &str,
    ) -> Result<Vec<DictItemView>, Exception> {
        let rows = item_schema::Entity::find()
            .filter(item_schema::Column::TypeCode.eq(type_code))
            .filter(item_schema::Column::Enabled.eq(true))
            .order_by_asc(item_schema::Column::Sort)
            .all(db)
            .await?;
        Ok(rows.into_iter().map(to_item_view).collect())
    }

    pub async fn findItemsMany<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        type_codes: &[String],
    ) -> Result<Vec<DictTypeView>, Exception> {
        if type_codes.is_empty() {
            return Ok(Vec::new());
        }
        let types = type_schema::Entity::find()
            .filter(type_schema::Column::Code.is_in(type_codes.iter().cloned()))
            .all(db)
            .await?;
        let items = item_schema::Entity::find()
            .filter(item_schema::Column::TypeCode.is_in(type_codes.iter().cloned()))
            .order_by_asc(item_schema::Column::Sort)
            .all(db)
            .await?;

        let mut views = Vec::with_capacity(types.len());
        for type_row in types {
            let type_items = items
                .iter()
                .filter(|item| item.typeCode == type_row.code)
                .cloned()
                .map(to_item_view)
                .collect();
            views.push(DictTypeView {
                type_code: type_row.code,
                name: type_row.name,
                description: type_row.description,
                items: type_items,
            });
        }
        Ok(views)
    }

    pub async fn findLabel<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        type_code: &str,
        value: &str,
    ) -> Result<Option<String>, Exception> {
        let row = item_schema::Entity::find()
            .filter(item_schema::Column::TypeCode.eq(type_code))
            .filter(item_schema::Column::Value.eq(value))
            .one(db)
            .await?;
        Ok(row.map(|item| item.label))
    }

    pub async fn assertValue<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        type_code: &str,
        value: &str,
    ) -> Result<(), Exception> {
        let exists = item_schema::Entity::find()
            .filter(item_schema::Column::TypeCode.eq(type_code))
            .filter(item_schema::Column::Value.eq(value))
            .filter(item_schema::Column::Enabled.eq(true))
            .one(db)
            .await?;
        if exists.is_none() {
            return Err(Exception::Validation(format!(
                "未知状态值：{type_code}={value}"
            )));
        }
        Ok(())
    }

    /// 只允许改 label / sort / enabled / meta，禁止改 value
    pub async fn toUpdateItem<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        input: UpdateItemInput,
    ) -> Result<DictItemView, Exception> {
        let existing = item_schema::Entity::find_by_id(input.id.clone())
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("字典项不存在: {}", input.id)))?;
        let mut active: item_schema::ActiveModel = existing.into();
        if let Some(label) = input.label {
            let trimmed = label.trim();
            if trimmed.is_empty() {
                return Err(Exception::Validation("label 不能为空".to_string()));
            }
            active.label = Set(trimmed.to_owned());
        }
        if let Some(sort) = input.sort {
            active.sort = Set(sort);
        }
        if let Some(enabled) = input.enabled {
            active.enabled = Set(enabled);
        }
        if let Some(meta) = input.meta {
            active.meta = Set(Some(meta));
        }
        active.updatedAt = Set(Utc::now().timestamp_millis());
        let updated = active.update(db).await?;
        Ok(to_item_view(updated))
    }
}

fn to_item_view(item: item_schema::Model) -> DictItemView {
    DictItemView {
        id: item.id,
        type_code: item.typeCode,
        value: item.value,
        label: item.label,
        sort: item.sort,
        enabled: item.enabled,
        is_default: item.isDefault,
        meta: item.meta,
    }
}
