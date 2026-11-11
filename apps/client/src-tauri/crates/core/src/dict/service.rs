#![allow(non_snake_case)]

use chrono::Utc;
use cogito_database::entity::{
    dict_item as pool_schema, dict_tenant_item as tenant_schema, dict_type as type_schema,
    dict_type_item as claim_schema,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, JoinType, QueryFilter, QueryOrder,
    QuerySelect, RelationTrait, Set, TransactionTrait,
};
use serde::{Deserialize, Serialize};

use crate::exception::Exception;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictItemView {
    pub id: String,
    pub type_code: String,
    pub value: String,
    pub key: String,
    pub label: String,
    pub sort: i32,
    pub enabled: bool,
    pub is_default: bool,
    pub meta: Option<String>,
    pub revision: i32,
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
    pub type_code: Option<String>,
    pub label: Option<String>,
    pub sort: Option<i32>,
    pub enabled: Option<bool>,
    pub meta: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePoolItem {
    pub value: String,
    pub key: String,
    pub label: Option<String>,
    pub sort: i32,
    pub enabled: bool,
    pub meta: Option<String>,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteClaimItem {
    pub type_code: String,
    pub value: String,
    pub label: Option<String>,
    pub is_default: bool,
    pub sort: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTenantItem {
    pub tenant_id: String,
    pub type_code: String,
    pub value: String,
    pub label: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCatalog {
    pub pool: Vec<RemotePoolItem>,
    pub claims: Vec<RemoteClaimItem>,
    #[serde(default)]
    pub tenant_items: Vec<RemoteTenantItem>,
}

pub struct Service;

impl Service {
    pub async fn findItems<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        type_code: &str,
        tenant_id: Option<&str>,
    ) -> Result<Vec<DictItemView>, Exception> {
        let rows = fetch_claim_rows(db, type_code, tenant_id).await?;
        Ok(rows.into_iter().filter(|view| view.enabled).collect())
    }

    pub async fn findItemsMany<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        type_codes: &[String],
        tenant_id: Option<&str>,
    ) -> Result<Vec<DictTypeView>, Exception> {
        if type_codes.is_empty() {
            return Ok(Vec::new());
        }
        let types = type_schema::Entity::find()
            .filter(type_schema::Column::Code.is_in(type_codes.iter().cloned()))
            .all(db)
            .await?;

        let mut views = Vec::with_capacity(types.len());
        for type_row in types {
            let items = fetch_claim_rows(db, &type_row.code, tenant_id).await?;
            views.push(DictTypeView {
                type_code: type_row.code,
                name: type_row.name,
                description: type_row.description,
                items,
            });
        }
        Ok(views)
    }

    pub async fn findLabel<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        type_code: &str,
        value: &str,
        tenant_id: Option<&str>,
    ) -> Result<Option<String>, Exception> {
        let rows = fetch_claim_rows(db, type_code, tenant_id).await?;
        Ok(rows
            .into_iter()
            .find(|item| item.value == value)
            .map(|item| item.label))
    }

    pub async fn assertValue<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        type_code: &str,
        value: &str,
    ) -> Result<(), Exception> {
        let claim = claim_schema::Entity::find()
            .filter(claim_schema::Column::TypeCode.eq(type_code))
            .filter(claim_schema::Column::Value.eq(value))
            .one(db)
            .await?;
        let Some(claim) = claim else {
            return Err(Exception::Validation(format!(
                "未知状态值：{type_code}={value}"
            )));
        };
        let pool = pool_schema::Entity::find()
            .filter(pool_schema::Column::Value.eq(claim.value))
            .filter(pool_schema::Column::Enabled.eq(true))
            .one(db)
            .await?;
        if pool.is_none() {
            return Err(Exception::Validation(format!(
                "未知状态值：{type_code}={value}"
            )));
        }
        Ok(())
    }

    pub async fn findValue<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        type_code: &str,
        key: &str,
    ) -> Result<Option<String>, Exception> {
        let row = claim_schema::Entity::find()
            .filter(claim_schema::Column::TypeCode.eq(type_code))
            .join(JoinType::InnerJoin, claim_schema::Relation::PoolItem.def())
            .filter(pool_schema::Column::Key.eq(key))
            .one(db)
            .await?;
        Ok(row.map(|claim| claim.value))
    }

    pub async fn findByKey<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        type_code: &str,
        key: &str,
        tenant_id: Option<&str>,
    ) -> Result<Option<DictItemView>, Exception> {
        let Some(value) = Self::findValue(db, type_code, key).await? else {
            return Ok(None);
        };
        let rows = fetch_claim_rows(db, type_code, tenant_id).await?;
        Ok(rows.into_iter().find(|item| item.value == value))
    }

    /// 只允许改 label / sort / enabled / meta；禁止改 value / key
    pub async fn toUpdateItem<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        input: UpdateItemInput,
    ) -> Result<DictItemView, Exception> {
        let existing = pool_schema::Entity::find_by_id(input.id.clone())
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("字典项不存在: {}", input.id)))?;

        if let (Some(type_code), Some(label)) = (&input.type_code, &input.label) {
            let trimmed = label.trim();
            if trimmed.is_empty() {
                return Err(Exception::Validation("label 不能为空".to_string()));
            }
            let claim = claim_schema::Entity::find()
                .filter(claim_schema::Column::TypeCode.eq(type_code.clone()))
                .filter(claim_schema::Column::Value.eq(existing.value.clone()))
                .one(db)
                .await?
                .ok_or_else(|| {
                    Exception::Validation(format!("type 未认领该 value: {type_code}"))
                })?;
            let mut claim_active: claim_schema::ActiveModel = claim.into();
            claim_active.label = Set(Some(trimmed.to_owned()));
            claim_active.update(db).await?;
            return Self::findByKey(db, type_code, &existing.key, None)
                .await?
                .ok_or_else(|| Exception::NotFound("认领项不存在".into()));
        }

        let mut active: pool_schema::ActiveModel = existing.clone().into();
        if let Some(label) = input.label {
            let trimmed = label.trim();
            if trimmed.is_empty() {
                return Err(Exception::Validation("label 不能为空".to_string()));
            }
            active.label = Set(Some(trimmed.to_owned()));
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
        active.revision = Set(existing.revision + 1);
        active.updatedAt = Set(Utc::now().timestamp_millis());
        let updated = active.update(db).await?;

        let type_code = input.type_code.unwrap_or_else(|| {
            // 无 type 时取任意认领（离线改池文案场景）
            String::new()
        });
        if type_code.is_empty() {
            if let Ok(Some(first)) = claim_schema::Entity::find()
                .filter(claim_schema::Column::Value.eq(updated.value.clone()))
                .one(db)
                .await
            {
                return Self::findByKey(db, &first.typeCode, &updated.key, None)
                    .await?
                    .ok_or_else(|| Exception::NotFound("认领项不存在".into()));
            }
            return Err(Exception::Validation("缺少 typeCode，无法返回视图".into()));
        }
        Self::findByKey(db, &type_code, &updated.key, None)
            .await?
            .ok_or_else(|| Exception::NotFound("认领项不存在".into()))
    }

    pub async fn mergeRemoteCatalog<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        catalog: RemoteCatalog,
    ) -> Result<(), Exception> {
        let txn = db.begin().await?;
        let now = Utc::now().timestamp_millis();

        for item in catalog.pool {
            let existing = pool_schema::Entity::find()
                .filter(pool_schema::Column::Value.eq(item.value.clone()))
                .one(&txn)
                .await?;
            if let Some(row) = existing {
                if item.revision <= row.revision {
                    continue;
                }
                let mut active: pool_schema::ActiveModel = row.into();
                active.key = Set(item.key);
                active.label = Set(item.label);
                active.sort = Set(item.sort);
                active.enabled = Set(item.enabled);
                active.meta = Set(item.meta);
                active.revision = Set(item.revision);
                active.updatedAt = Set(now);
                active.update(&txn).await?;
            } else {
                let id = format!("dict-pool-{}", item.value);
                pool_schema::ActiveModel {
                    id: Set(id),
                    value: Set(item.value),
                    key: Set(item.key),
                    label: Set(item.label),
                    sort: Set(item.sort),
                    enabled: Set(item.enabled),
                    meta: Set(item.meta),
                    revision: Set(item.revision),
                    createdAt: Set(now),
                    updatedAt: Set(now),
                    ..Default::default()
                }
                .insert(&txn)
                .await?;
            }
        }

        for claim in catalog.claims {
            let existing =
                claim_schema::Entity::find_by_id((claim.type_code.clone(), claim.value.clone()))
                    .one(&txn)
                    .await?;
            if let Some(row) = existing {
                let mut active: claim_schema::ActiveModel = row.into();
                active.label = Set(claim.label);
                active.isDefault = Set(claim.is_default);
                active.sort = Set(claim.sort);
                active.update(&txn).await?;
            } else {
                claim_schema::ActiveModel {
                    typeCode: Set(claim.type_code),
                    value: Set(claim.value),
                    label: Set(claim.label),
                    isDefault: Set(claim.is_default),
                    sort: Set(claim.sort),
                    ..Default::default()
                }
                .insert(&txn)
                .await?;
            }
        }

        for row in catalog.tenant_items {
            tenant_schema::ActiveModel {
                tenantId: Set(row.tenant_id),
                typeCode: Set(row.type_code),
                value: Set(row.value),
                label: Set(row.label),
                enabled: Set(row.enabled),
                ..Default::default()
            }
            .save(&txn)
            .await?;
        }

        txn.commit().await?;
        Ok(())
    }
}

async fn fetch_claim_rows<C: ConnectionTrait>(
    db: &C,
    type_code: &str,
    tenant_id: Option<&str>,
) -> Result<Vec<DictItemView>, Exception> {
    let claims = claim_schema::Entity::find()
        .filter(claim_schema::Column::TypeCode.eq(type_code))
        .order_by_asc(claim_schema::Column::Sort)
        .all(db)
        .await?;

    let mut views = Vec::with_capacity(claims.len());
    for claim in claims {
        let pool = pool_schema::Entity::find()
            .filter(pool_schema::Column::Value.eq(claim.value.clone()))
            .one(db)
            .await?;
        let Some(pool) = pool else {
            continue;
        };

        let tenant = match tenant_id {
            Some(id) => {
                tenant_schema::Entity::find_by_id((
                    id.to_string(),
                    type_code.to_string(),
                    claim.value.clone(),
                ))
                .one(db)
                .await?
            }
            None => None,
        };

        let enabled = tenant
            .as_ref()
            .and_then(|row| row.enabled)
            .unwrap_or(pool.enabled);
        let label = merged_label(tenant.as_ref(), &claim, &pool);

        views.push(DictItemView {
            id: pool.id.clone(),
            type_code: type_code.to_string(),
            value: pool.value,
            key: pool.key,
            label,
            sort: claim.sort,
            enabled,
            is_default: claim.isDefault,
            meta: pool.meta,
            revision: pool.revision,
        });
    }
    Ok(views)
}

fn merged_label(
    tenant: Option<&tenant_schema::Model>,
    claim: &claim_schema::Model,
    pool: &pool_schema::Model,
) -> String {
    if let Some(row) = tenant {
        if let Some(label) = &row.label {
            if !label.is_empty() {
                return label.clone();
            }
        }
    }
    if let Some(label) = &claim.label {
        if !label.is_empty() {
            return label.clone();
        }
    }
    pool.label.clone().unwrap_or_else(|| pool.key.clone())
}
