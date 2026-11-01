use std::collections::HashMap;

use chrono::Utc;
use entity::{dict_item, dict_tenant_item, dict_type, dict_type_item};
use identity::TenantId;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Set,
};
use uuid::Uuid;

use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::platform::PlatformScope;
use crate::guards::tenant::TenantScope;
use crate::services::dict::schema::{
    CatalogR, ClaimP, ItemAllocateP, ItemR, ItemUpdateP, TenantItemP, TenantViewR, TypeItemR, TypeP,
    TypeR, TypeUpdateP,
};
use crate::utils::code::{external, request};

#[derive(Debug, thiserror::Error)]
pub enum DictError {
    #[error("Invalid parameter: {0}")]
    BadParam(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("Database error: {0}")]
    Db(String),
}

impl From<DictError> for Exception {
    fn from(err: DictError) -> Self {
        match err {
            DictError::BadParam(msg) => Exception::custom(request::INVALID_PARAMETER_VALUE, msg),
            DictError::NotFound(msg) => Exception::not_found(msg),
            DictError::Conflict(msg) => {
                Exception::custom(crate::utils::code::data::DUPLICATE_DATA, msg)
            }
            DictError::Db(msg) => {
                tracing::error!(error = %msg, "dict database error");
                Exception::custom(external::DATABASE_ERROR, "数据库错误")
            }
        }
    }
}

pub struct DictService;

impl DictService {
    pub async fn findTypes(scope: &PlatformScope) -> Result<Vec<TypeR>, DictError> {
        let types = dict_type::Entity::find()
            .order_by_asc(dict_type::Column::Code)
            .all(scope.tx())
            .await
            .map_err(|e| DictError::Db(e.to_string()))?;
        let pool = load_pool(scope).await?;
        let claims = load_claims(scope).await?;
        let mut out = Vec::with_capacity(types.len());
        for row in types {
            let items = merge_type_items(&claims, &row.code, &pool, None, false);
            out.push(TypeR {
                code: row.code,
                name: row.name,
                description: row.description,
                items,
            });
        }
        Ok(out)
    }

    pub async fn createType(
        scope: &PlatformScope,
        actor: Uuid,
        body: TypeP,
    ) -> Result<TypeR, DictError> {
        if body.code.trim().is_empty() {
            return Err(DictError::BadParam("code 不能为空".into()));
        }
        let now = Utc::now().fixed_offset();
        let code = body.code.clone();
        let name = body.name.clone();
        let description = body.description.clone();
        dict_type::ActiveModel {
            code: Set(code.clone()),
            name: Set(name.clone()),
            description: Set(description.clone()),
            created_at: Set(now),
            creator: Set(Some(actor)),
            updated_at: Set(now),
            updater: Set(Some(actor)),
        }
        .insert(scope.tx())
        .await
        .map_err(map_unique_type)?;

        Ok(TypeR {
            code,
            name,
            description,
            items: vec![],
        })
    }

    pub async fn updateType(
        scope: &PlatformScope,
        actor: Uuid,
        code: &str,
        body: TypeUpdateP,
    ) -> Result<TypeR, DictError> {
        let row = dict_type::Entity::find_by_id(code.to_string())
            .one(scope.tx())
            .await
            .map_err(|e| DictError::Db(e.to_string()))?
            .ok_or_else(|| DictError::NotFound("字典类型不存在".into()))?;

        let now = Utc::now().fixed_offset();
        let mut active: dict_type::ActiveModel = row.clone().into();
        active.name = Set(body.name.clone());
        active.description = Set(body.description.clone());
        active.updated_at = Set(now);
        active.updater = Set(Some(actor));
        let updated = active
            .update(scope.tx())
            .await
            .map_err(|e| DictError::Db(e.to_string()))?;

        let pool = load_pool(scope).await?;
        let claims = load_claims(scope).await?;
        let items = merge_type_items(&claims, &updated.code, &pool, None, false);

        Ok(TypeR {
            code: updated.code,
            name: updated.name,
            description: updated.description,
            items,
        })
    }

    pub async fn findItems(scope: &PlatformScope) -> Result<Vec<ItemR>, DictError> {
        let rows = dict_item::Entity::find()
            .order_by_asc(dict_item::Column::Value)
            .all(scope.tx())
            .await
            .map_err(|e| DictError::Db(e.to_string()))?;
        Ok(rows.into_iter().map(into_item_r).collect())
    }

    pub async fn allocateItem(
        scope: &PlatformScope,
        actor: Uuid,
        body: ItemAllocateP,
    ) -> Result<ItemR, DictError> {
        if body.key.trim().is_empty() {
            return Err(DictError::BadParam("key 不能为空".into()));
        }
        let next = next_value(scope).await?;
        let now = Utc::now().fixed_offset();
        let sort = body.sort.unwrap_or(10);
        let model = dict_item::ActiveModel {
            value: Set(next.clone()),
            key: Set(body.key),
            label: Set(body.label),
            sort: Set(sort),
            enabled: Set(true),
            meta: Set(body.meta),
            revision: Set(1),
            created_at: Set(now),
            creator: Set(Some(actor)),
            updated_at: Set(now),
            updater: Set(Some(actor)),
        }
        .insert(scope.tx())
        .await
        .map_err(map_unique_key)?;

        Ok(into_item_r(model))
    }

    pub async fn updateItem(
        scope: &PlatformScope,
        actor: Uuid,
        value: &str,
        body: ItemUpdateP,
    ) -> Result<ItemR, DictError> {
        let row = dict_item::Entity::find_by_id(value.to_string())
            .one(scope.tx())
            .await
            .map_err(|e| DictError::Db(e.to_string()))?
            .ok_or_else(|| DictError::NotFound("字典项不存在".into()))?;

        let now = Utc::now().fixed_offset();
        let next_revision = row.revision + 1;
        let mut active: dict_item::ActiveModel = row.into();
        if let Some(label) = body.label {
            active.label = Set(label);
        }
        if let Some(sort) = body.sort {
            active.sort = Set(sort);
        }
        if let Some(enabled) = body.enabled {
            active.enabled = Set(enabled);
        }
        if body.meta.is_some() {
            active.meta = Set(body.meta);
        }
        active.revision = Set(next_revision);
        active.updated_at = Set(now);
        active.updater = Set(Some(actor));
        let updated = active
            .update(scope.tx())
            .await
            .map_err(|e| DictError::Db(e.to_string()))?;

        Ok(into_item_r(updated))
    }

    pub async fn claimItems(
        scope: &PlatformScope,
        code: &str,
        claims: Vec<ClaimP>,
    ) -> Result<Vec<TypeItemR>, DictError> {
        ensure_type(scope, code).await?;
        for claim in &claims {
            ensure_pool_value(scope, &claim.value).await?;
        }

        for claim in claims {
            dict_type_item::ActiveModel {
                type_code: Set(code.to_string()),
                value: Set(claim.value.clone()),
                label: Set(claim.label),
                is_default: Set(claim.is_default),
                sort: Set(claim.sort),
            }
            .insert(scope.tx())
            .await
            .map_err(map_unique_claim)?;
        }

        let pool = load_pool(scope).await?;
        let all_claims = load_claims(scope).await?;
        Ok(merge_type_items(&all_claims, code, &pool, None, false))
    }

    pub async fn removeClaim(
        scope: &PlatformScope,
        code: &str,
        value: &str,
    ) -> Result<(), DictError> {
        let result = dict_type_item::Entity::delete_many()
            .filter(dict_type_item::Column::TypeCode.eq(code))
            .filter(dict_type_item::Column::Value.eq(value))
            .exec(scope.tx())
            .await
            .map_err(|e| DictError::Db(e.to_string()))?;
        if result.rows_affected == 0 {
            return Err(DictError::NotFound("认领关系不存在".into()));
        }
        Ok(())
    }

    pub async fn upsertTenantItems(
        scope: &PlatformScope,
        tenant_id: TenantId,
        items: Vec<TenantItemP>,
    ) -> Result<(), DictError> {
        for item in items {
            ensure_type(scope, &item.type_code).await?;
            ensure_pool_value(scope, &item.value).await?;
            ensure_claimed(scope, &item.type_code, &item.value).await?;

            let pk = (
                tenant_id.as_uuid(),
                item.type_code.clone(),
                item.value.clone(),
            );
            let existing = dict_tenant_item::Entity::find_by_id(pk)
                .one(scope.tx())
                .await
                .map_err(|e| DictError::Db(e.to_string()))?;

            if let Some(row) = existing {
                let mut active: dict_tenant_item::ActiveModel = row.into();
                if item.label.is_some() {
                    active.label = Set(item.label);
                }
                if item.enabled.is_some() {
                    active.enabled = Set(item.enabled);
                }
                active
                    .update(scope.tx())
                    .await
                    .map_err(|e| DictError::Db(e.to_string()))?;
            } else {
                dict_tenant_item::ActiveModel {
                    tenant_id: Set(tenant_id.as_uuid()),
                    type_code: Set(item.type_code),
                    value: Set(item.value),
                    label: Set(item.label),
                    enabled: Set(item.enabled),
                }
                .insert(scope.tx())
                .await
                .map_err(|e| DictError::Db(e.to_string()))?;
            }
        }
        Ok(())
    }

    pub async fn findTenantView(
        scope: &PlatformScope,
        tenant_id: TenantId,
    ) -> Result<TenantViewR, DictError> {
        let overrides = load_tenant_overrides(scope, tenant_id).await?;
        let types = dict_type::Entity::find()
            .order_by_asc(dict_type::Column::Code)
            .all(scope.tx())
            .await
            .map_err(|e| DictError::Db(e.to_string()))?;
        let pool = load_pool(scope).await?;
        let claims = load_claims(scope).await?;
        let mut merged_types = Vec::with_capacity(types.len());
        let mut revision = 0i32;
        for row in types {
            let items = merge_type_items(&claims, &row.code, &pool, Some(&overrides), false);
            for item in &items {
                revision = revision.max(item.revision);
            }
            merged_types.push(TypeR {
                code: row.code,
                name: row.name,
                description: row.description,
                items,
            });
        }
        Ok(TenantViewR {
            tenant_id: tenant_id.to_string(),
            revision,
            types: merged_types,
        })
    }

    pub async fn findCatalog(
        storage: &Storage,
        tenant_id: TenantId,
    ) -> Result<CatalogR, DictError> {
        let platform = PlatformScope::open(storage)
            .await
            .map_err(|e| DictError::Db(e.to_string()))?;
        let tenant_scope = TenantScope::open(storage, tenant_id)
            .await
            .map_err(|e| DictError::Db(e.to_string()))?;

        let types = dict_type::Entity::find()
            .order_by_asc(dict_type::Column::Code)
            .all(platform.tx())
            .await
            .map_err(|e| DictError::Db(e.to_string()))?;
        let pool = load_pool(&platform).await?;
        let claims = load_claims(&platform).await?;
        let overrides = load_tenant_overrides_tx(tenant_scope.tx(), tenant_id).await?;

        platform.rollback().await.map_err(|e| DictError::Db(e.to_string()))?;
        tenant_scope
            .rollback()
            .await
            .map_err(|e| DictError::Db(e.to_string()))?;

        let mut merged_types = Vec::with_capacity(types.len());
        let mut revision = 0i32;
        for row in types {
            let items = merge_type_items(&claims, &row.code, &pool, Some(&overrides), true);
            for item in &items {
                revision = revision.max(item.revision);
            }
            if !items.is_empty() {
                merged_types.push(TypeR {
                    code: row.code,
                    name: row.name,
                    description: row.description,
                    items,
                });
            }
        }
        Ok(CatalogR {
            revision,
            types: merged_types,
        })
    }
}

type PoolMap = HashMap<String, dict_item::Model>;
type ClaimMap = HashMap<String, Vec<dict_type_item::Model>>;
type TenantOverrideMap = HashMap<(String, String), dict_tenant_item::Model>;

async fn load_pool(scope: &PlatformScope) -> Result<PoolMap, DictError> {
    let rows = dict_item::Entity::find()
        .all(scope.tx())
        .await
        .map_err(|e| DictError::Db(e.to_string()))?;
    Ok(rows.into_iter().map(|row| (row.value.clone(), row)).collect())
}

async fn load_claims(scope: &PlatformScope) -> Result<ClaimMap, DictError> {
    let rows = dict_type_item::Entity::find()
        .order_by_asc(dict_type_item::Column::Sort)
        .all(scope.tx())
        .await
        .map_err(|e| DictError::Db(e.to_string()))?;
    let mut map: ClaimMap = HashMap::new();
    for row in rows {
        map.entry(row.type_code.clone())
            .or_default()
            .push(row);
    }
    Ok(map)
}

async fn load_tenant_overrides(
    scope: &PlatformScope,
    tenant_id: TenantId,
) -> Result<TenantOverrideMap, DictError> {
    let rows = dict_tenant_item::Entity::find()
        .filter(dict_tenant_item::Column::TenantId.eq(tenant_id.as_uuid()))
        .all(scope.tx())
        .await
        .map_err(|e| DictError::Db(e.to_string()))?;
    Ok(rows
        .into_iter()
        .map(|row| ((row.type_code.clone(), row.value.clone()), row))
        .collect())
}

async fn load_tenant_overrides_tx(
    tx: &sea_orm::DatabaseTransaction,
    tenant_id: TenantId,
) -> Result<TenantOverrideMap, DictError> {
    let rows = dict_tenant_item::Entity::find()
        .filter(dict_tenant_item::Column::TenantId.eq(tenant_id.as_uuid()))
        .all(tx)
        .await
        .map_err(|e| DictError::Db(e.to_string()))?;
    Ok(rows
        .into_iter()
        .map(|row| ((row.type_code.clone(), row.value.clone()), row))
        .collect())
}

fn merge_type_items(
    claims: &ClaimMap,
    type_code: &str,
    pool: &PoolMap,
    overrides: Option<&TenantOverrideMap>,
    members_only: bool,
) -> Vec<TypeItemR> {
    let Some(type_claims) = claims.get(type_code) else {
        return vec![];
    };
    let mut items = Vec::with_capacity(type_claims.len());
    for claim in type_claims {
        let Some(base) = pool.get(&claim.value) else {
            continue;
        };
        let tenant_row = overrides
            .and_then(|map| map.get(&(type_code.to_string(), claim.value.clone())));
        let label = tenant_row
            .and_then(|row| row.label.as_deref())
            .or(claim.label.as_deref())
            .unwrap_or(base.label.as_str())
            .to_string();
        let enabled = tenant_row
            .and_then(|row| row.enabled)
            .unwrap_or(base.enabled);
        if members_only && !enabled {
            continue;
        }
        items.push(TypeItemR {
            value: base.value.clone(),
            key: base.key.clone(),
            label,
            sort: claim.sort,
            enabled,
            is_default: claim.is_default,
            meta: base.meta.clone(),
            revision: base.revision,
        });
    }
    items.sort_by_key(|item| item.sort);
    items
}

async fn next_value(scope: &PlatformScope) -> Result<String, DictError> {
    let rows = dict_item::Entity::find()
        .order_by_desc(dict_item::Column::Value)
        .limit(1)
        .all(scope.tx())
        .await
        .map_err(|e| DictError::Db(e.to_string()))?;
    let next_num = rows
        .first()
        .and_then(|row| row.value.parse::<u32>().ok())
        .map(|n| n + 1)
        .unwrap_or(1);
    if next_num > 999 {
        return Err(DictError::Conflict("全局池 value 已用尽".into()));
    }
    Ok(format!("{next_num:03}"))
}

async fn ensure_type(scope: &PlatformScope, code: &str) -> Result<(), DictError> {
    let exists = dict_type::Entity::find_by_id(code.to_string())
        .one(scope.tx())
        .await
        .map_err(|e| DictError::Db(e.to_string()))?
        .is_some();
    if !exists {
        return Err(DictError::NotFound("字典类型不存在".into()));
    }
    Ok(())
}

async fn ensure_pool_value(scope: &PlatformScope, value: &str) -> Result<(), DictError> {
    let exists = dict_item::Entity::find_by_id(value.to_string())
        .one(scope.tx())
        .await
        .map_err(|e| DictError::Db(e.to_string()))?
        .is_some();
    if !exists {
        return Err(DictError::NotFound("字典项不存在".into()));
    }
    Ok(())
}

async fn ensure_claimed(
    scope: &PlatformScope,
    type_code: &str,
    value: &str,
) -> Result<(), DictError> {
    let exists = dict_type_item::Entity::find_by_id((type_code.to_string(), value.to_string()))
        .one(scope.tx())
        .await
        .map_err(|e| DictError::Db(e.to_string()))?
        .is_some();
    if !exists {
        return Err(DictError::BadParam("该 value 尚未被此类型认领".into()));
    }
    Ok(())
}

fn into_item_r(model: dict_item::Model) -> ItemR {
    ItemR {
        value: model.value,
        key: model.key,
        label: model.label,
        sort: model.sort,
        enabled: model.enabled,
        meta: model.meta,
        revision: model.revision,
    }
}

fn map_unique_type(err: sea_orm::DbErr) -> DictError {
    if is_unique_violation(&err) {
        DictError::Conflict("字典类型 code 已存在".into())
    } else {
        DictError::Db(err.to_string())
    }
}

fn map_unique_key(err: sea_orm::DbErr) -> DictError {
    if is_unique_violation(&err) {
        DictError::Conflict("字典 key 已存在".into())
    } else {
        DictError::Db(err.to_string())
    }
}

fn map_unique_claim(err: sea_orm::DbErr) -> DictError {
    if is_unique_violation(&err) {
        DictError::Conflict("认领关系已存在".into())
    } else {
        DictError::Db(err.to_string())
    }
}

fn is_unique_violation(err: &sea_orm::DbErr) -> bool {
    err.to_string().contains("duplicate key") || err.to_string().contains("UniqueViolation")
}
