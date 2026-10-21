//! 异常上报契约：POST 可匿名；管理面仅平台 ADMIN。

use super::common::{
    EmptyEnvelope, Exception, ExceptionEnvelope, ExceptionGroupPageEnvelope,
    ExceptionPageEnvelope, ExceptionSourcesEnvelope, ExceptionSummaryEnvelope,
};
use crate::services::exception::schema::WriteP as ExceptionWriteP;

#[utoipa::path(
    post,
    path = "/api/v1/exception",
    tag = "Exception",
    operation_id = "exception.toWrite",
    summary = "上报异常事件",
    description = "可匿名。必填 eventID（客户端 UUID）、message、timestamp、url。\
        有 Bearer 且未传 userID 时回填 Session 用户。成功 body.code=200000。\
        重复 eventID 返回 DUPLICATE_DATA。",
    request_body(
        content = ExceptionWriteP,
        description = "异常事件",
        example = json!({
            "eventID": "550e8400-e29b-41d4-a716-446655440000",
            "message": "TypeError: x is not a function",
            "timestamp": 1746748800000_i64,
            "url": "http://localhost:5173/app",
            "source": "studio",
            "level": "error"
        })
    ),
    responses(
        (status = 200, description = "成功（code=200000）", body = ExceptionEnvelope),
        (status = "default", description = "业务异常（参数非法或 eventID 冲突）", body = Exception),
    )
)]
pub fn toWrite_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/exception",
    tag = "Exception",
    operation_id = "exception.toList",
    summary = "异常事件列表",
    description = "仅平台 ADMIN。支持 source/level/fingerprint/environment/q/receivedFrom/receivedTo 筛选与 take/skip 分页。",
    security(("bearer_auth" = [])),
    params(
        ("take" = Option<u64>, Query, description = "分页大小 1–100，默认 50"),
        ("skip" = Option<u64>, Query, description = "偏移，默认 0"),
        ("source" = Option<String>, Query, description = "精确匹配来源"),
        ("level" = Option<String>, Query, description = "fatal|error|warning|info"),
        ("fingerprint" = Option<String>, Query, description = "精确匹配指纹"),
        ("environment" = Option<String>, Query, description = "运行环境"),
        ("q" = Option<String>, Query, description = "message/url 模糊搜索"),
        ("receivedFrom" = Option<String>, Query, description = "入库时间下界 ISO8601"),
        ("receivedTo" = Option<String>, Query, description = "入库时间上界 ISO8601"),
    ),
    responses(
        (status = 200, description = "成功（code=200000）", body = ExceptionPageEnvelope),
        (status = "default", description = "业务异常（未登录或权限不足）", body = Exception),
    )
)]
pub fn toList_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/exception/groups",
    tag = "Exception",
    operation_id = "exception.groups",
    summary = "异常 Issue 分组",
    description = "仅平台 ADMIN。按 fingerprint 聚合；故意忽略 query.fingerprint。",
    security(("bearer_auth" = [])),
    params(
        ("take" = Option<u64>, Query, description = "分页大小 1–100，默认 50"),
        ("skip" = Option<u64>, Query, description = "偏移，默认 0"),
        ("source" = Option<String>, Query, description = "精确匹配来源"),
        ("level" = Option<String>, Query, description = "fatal|error|warning|info"),
        ("environment" = Option<String>, Query, description = "运行环境"),
        ("q" = Option<String>, Query, description = "message/url 模糊搜索"),
        ("receivedFrom" = Option<String>, Query, description = "入库时间下界 ISO8601"),
        ("receivedTo" = Option<String>, Query, description = "入库时间上界 ISO8601"),
    ),
    responses(
        (status = 200, description = "成功（code=200000）", body = ExceptionGroupPageEnvelope),
        (status = "default", description = "业务异常", body = Exception),
    )
)]
pub fn groups_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/exception/sources",
    tag = "Exception",
    operation_id = "exception.sources",
    summary = "异常来源列表",
    description = "仅平台 ADMIN。返回去重升序的 source 字符串数组。",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "成功（code=200000）", body = ExceptionSourcesEnvelope),
        (status = "default", description = "业务异常", body = Exception),
    )
)]
pub fn sources_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/exception/summary",
    tag = "Exception",
    operation_id = "exception.summary",
    summary = "异常汇总",
    description = "仅平台 ADMIN。返回 total / byLevel / bySource；忽略 query.fingerprint。",
    security(("bearer_auth" = [])),
    params(
        ("source" = Option<String>, Query, description = "精确匹配来源"),
        ("level" = Option<String>, Query, description = "fatal|error|warning|info"),
        ("environment" = Option<String>, Query, description = "运行环境"),
        ("q" = Option<String>, Query, description = "message/url 模糊搜索"),
        ("receivedFrom" = Option<String>, Query, description = "入库时间下界 ISO8601"),
        ("receivedTo" = Option<String>, Query, description = "入库时间上界 ISO8601"),
    ),
    responses(
        (status = 200, description = "成功（code=200000）", body = ExceptionSummaryEnvelope),
        (status = "default", description = "业务异常", body = Exception),
    )
)]
pub fn summary_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/exception/{id}",
    tag = "Exception",
    operation_id = "exception.toRead",
    summary = "异常事件详情",
    description = "仅平台 ADMIN。路径 id 为库内主键，不是 eventID。",
    security(("bearer_auth" = [])),
    params(
        ("id" = String, Path, description = "库内主键 UUID")
    ),
    responses(
        (status = 200, description = "成功（code=200000）", body = ExceptionEnvelope),
        (status = "default", description = "业务异常（不存在或权限不足）", body = Exception),
    )
)]
pub fn toRead_doc() {}

#[utoipa::path(
    delete,
    path = "/api/v1/exception/{id}",
    tag = "Exception",
    operation_id = "exception.toRemove",
    summary = "删除异常事件",
    description = "仅平台 ADMIN。硬删除；路径 id 为库内主键。",
    security(("bearer_auth" = [])),
    params(
        ("id" = String, Path, description = "库内主键 UUID")
    ),
    responses(
        (status = 200, description = "成功（code=200000，无 data）", body = EmptyEnvelope),
        (status = "default", description = "业务异常", body = Exception),
    )
)]
pub fn toRemove_doc() {}
