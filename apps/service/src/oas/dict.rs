//! 产品状态字典契约。

use super::common::{
    DictCatalogEnvelope, DictItemEnvelope, DictItemListEnvelope, DictTypeEnvelope, DictTypeListEnvelope,
    DictTypeItemListEnvelope, EmptyEnvelope, Exception, TenantDictEnvelope,
};
use crate::services::dict::schema::{
    ClaimP, ItemAllocateP, ItemUpdateP, TenantItemP, TypeP, TypeUpdateP,
};

#[utoipa::path(
    get,
    path = "/api/v1/dict",
    tag = "Dict",
    operation_id = "dict.findCatalog",
    summary = "当前租户字典目录",
    description = "需 JWT 与 X-Tenant-ID。返回已认领且 enabled 的合并条目，以及参与项的最大 revision。",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "成功（code=200000）", body = DictCatalogEnvelope),
        (status = "default", description = "业务异常", body = Exception),
    )
)]
pub fn find_catalog_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/dict/types",
    tag = "Dict",
    operation_id = "dict.findTypes",
    summary = "字典类型列表",
    description = "仅平台 ADMIN。含各类型已认领条目（合并 label）。",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "成功（code=200000）", body = DictTypeListEnvelope),
        (status = "default", description = "业务异常", body = Exception),
    )
)]
pub fn find_types_doc() {}

#[utoipa::path(
    post,
    path = "/api/v1/dict/types",
    tag = "Dict",
    operation_id = "dict.createType",
    summary = "新建字典类型",
    security(("bearer_auth" = [])),
    request_body(content = TypeP),
    responses(
        (status = 200, description = "成功（code=200000）", body = DictTypeEnvelope),
        (status = "default", description = "业务异常", body = Exception),
    )
)]
pub fn create_type_doc() {}

#[utoipa::path(
    put,
    path = "/api/v1/dict/types/{code}",
    tag = "Dict",
    operation_id = "dict.updateType",
    summary = "更新字典类型",
    security(("bearer_auth" = [])),
    request_body(content = TypeUpdateP),
    responses(
        (status = 200, description = "成功（code=200000）", body = DictTypeEnvelope),
        (status = "default", description = "业务异常", body = Exception),
    )
)]
pub fn update_type_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/dict/items",
    tag = "Dict",
    operation_id = "dict.findItems",
    summary = "全局字典池",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "成功（code=200000）", body = DictItemListEnvelope),
        (status = "default", description = "业务异常", body = Exception),
    )
)]
pub fn find_items_doc() {}

#[utoipa::path(
    post,
    path = "/api/v1/dict/items/allocate",
    tag = "Dict",
    operation_id = "dict.allocateItem",
    summary = "分配下一字典 value",
    security(("bearer_auth" = [])),
    request_body(content = ItemAllocateP),
    responses(
        (status = 200, description = "成功（code=200000）", body = DictItemEnvelope),
        (status = "default", description = "业务异常", body = Exception),
    )
)]
pub fn allocate_item_doc() {}

#[utoipa::path(
    put,
    path = "/api/v1/dict/items/{value}",
    tag = "Dict",
    operation_id = "dict.updateItem",
    summary = "更新字典池条目",
    security(("bearer_auth" = [])),
    request_body(content = ItemUpdateP),
    responses(
        (status = 200, description = "成功（code=200000）", body = DictItemEnvelope),
        (status = "default", description = "业务异常", body = Exception),
    )
)]
pub fn update_item_doc() {}

#[utoipa::path(
    post,
    path = "/api/v1/dict/types/{code}/claims",
    tag = "Dict",
    operation_id = "dict.claimItems",
    summary = "为类型认领字典 value",
    security(("bearer_auth" = [])),
    request_body(content = Vec<ClaimP>),
    responses(
        (status = 200, description = "成功（code=200000）", body = DictTypeItemListEnvelope),
        (status = "default", description = "业务异常", body = Exception),
    )
)]
pub fn claim_items_doc() {}

#[utoipa::path(
    delete,
    path = "/api/v1/dict/types/{code}/claims/{value}",
    tag = "Dict",
    operation_id = "dict.removeClaim",
    summary = "取消认领",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "成功（code=200000）", body = EmptyEnvelope),
        (status = "default", description = "业务异常", body = Exception),
    )
)]
pub fn remove_claim_doc() {}

#[utoipa::path(
    put,
    path = "/api/v1/dict/tenants/{tenantId}/items",
    tag = "Dict",
    operation_id = "dict.upsertTenantItems",
    summary = "租户字典覆盖",
    security(("bearer_auth" = [])),
    request_body(content = Vec<TenantItemP>),
    responses(
        (status = 200, description = "成功（code=200000）", body = EmptyEnvelope),
        (status = "default", description = "业务异常", body = Exception),
    )
)]
pub fn upsert_tenant_items_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/dict/tenants/{tenantId}",
    tag = "Dict",
    operation_id = "dict.findTenantView",
    summary = "租户合并字典视图",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "成功（code=200000）", body = TenantDictEnvelope),
        (status = "default", description = "业务异常", body = Exception),
    )
)]
pub fn find_tenant_view_doc() {}
