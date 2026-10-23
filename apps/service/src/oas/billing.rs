//! 计费运维面契约：价目管理与计量对账。
//!
//! 这一组路由没有租户面——价目是全平台的结算参数，对账看的是全平台的钱，
//! 可见范围由角色（平台 ADMIN）决定，而不是由路径或查询串里的哪个租户决定。

use super::common::{
    EmptyEnvelope, Exception, PriceEnvelope, PriceListEnvelope, ReconcileEnvelope,
};
use crate::services::payment::schema::{PriceUpdateP, PriceWriteP};

#[utoipa::path(
    get,
    path = "/api/v1/billing/prices",
    tag = "Billing",
    operation_id = "billing.prices",
    summary = "价目列表",
    description = "仅平台 ADMIN。**不分页**：价目量级是「型号数 × 改价次数」，一次取全更利于核对，\n\n\
        故只提供收窄条件（`tenantID` / `modelID` / `activeOnly` / `includeArchived`）。\n\n\
        `tenantID` 缺省 = 不过滤（平台默认价与各租户专属价都返回）；已归档价目缺省不返回。",
    security(("bearer_auth" = [])),
    params(
        ("tenantID" = Option<String>, Query, description = "租户 ID；缺省 = 不过滤"),
        ("modelID" = Option<String>, Query, description = "模型 ID"),
        ("activeOnly" = Option<bool>, Query, description = "只看此刻生效的窗口（未归档且窗口覆盖当前时刻）"),
        ("includeArchived" = Option<bool>, Query, description = "是否包含已归档价目，缺省 false"),
    ),
    responses(
        (status = 200, description = "成功", body = PriceListEnvelope),
        (status = "default", description = "业务异常（权限不足）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn prices_doc() {}

#[utoipa::path(
    post,
    path = "/api/v1/billing/prices",
    tag = "Billing",
    operation_id = "billing.priceWrite",
    summary = "新建价目",
    description = "仅平台 ADMIN。**价格不可原地修改**，改价一律「关旧窗口 + 开新窗口」：\n\n\
        历史用量必须能被它发生当时的那条价目唯一复算，否则过去的账会随之后的一次编辑而漂移。\n\n\
        写入前校验窗口不与同租户同型号（含平台默认价）的既有窗口重叠，相邻不算重叠（`[a,b)` 与 `[b,c)` 可以相接）；\n\n\
        `currency` 缺省取结算币种，给了就必须等于它（对账只在同一币种里比金额）；\n\n\
        `tenantID` 缺省 = 平台默认价，取价时租户专属价优先于平台默认价。\n\n\
        冲突返回 `500410`（HTTP 409），窗口非法 `500411`、金额超范围 `500412`、币种不符 `500413`（均 HTTP 422）。",
    security(("bearer_auth" = [])),
    request_body(content = PriceWriteP, description = "价目内容（金额单位：分 / 百万 token）"),
    responses(
        (status = 200, description = "成功", body = PriceEnvelope),
        (status = "default", description = "业务异常（型号不存在 / 窗口重叠 / 参数非法）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn price_write_doc() {}

#[utoipa::path(
    put,
    path = "/api/v1/billing/prices/{id}",
    tag = "Billing",
    operation_id = "billing.priceUpdate",
    summary = "改价目（收窄窗口）",
    description = "仅平台 ADMIN。**只开放 `modelName`（快照名）与 `effectiveTo`（收窄窗口）**：\n\n\
        金额与生效起点写入后不可改。窗口一旦收窄就不能再退回长期生效，因此改价 = 本接口补上 `effectiveTo`\n\n\
        + `POST /billing/prices` 建新窗口。两个字段都不给返回 `200003`（HTTP 400）。",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "价目 ID")),
    request_body(content = PriceUpdateP, description = "只允许改型号名快照与结束时间"),
    responses(
        (status = 200, description = "成功", body = PriceEnvelope),
        (status = "default", description = "业务异常（价目不存在 / 窗口未收窄 / 参数非法）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn price_update_doc() {}

#[utoipa::path(
    delete,
    path = "/api/v1/billing/prices/{id}",
    tag = "Billing",
    operation_id = "billing.priceArchive",
    summary = "归档价目",
    description = "仅平台 ADMIN。**软删除**：`archivedAt` 置位后不再参与取价，\n\n\
        但历史对账快照仍指向这一行，所以它永远不物理消失。重复归档返回成功（幂等）。",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "价目 ID")),
    responses(
        (status = 200, description = "成功", body = EmptyEnvelope),
        (status = "default", description = "业务异常（价目不存在）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn price_archive_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/billing/reconciliation",
    tag = "Billing",
    operation_id = "billing.reconciliation",
    summary = "计量对账",
    description = "仅平台 ADMIN。把「用量折算出的金额」与「订单实收」放进同一个窗口比，返回全平台合计、\n\n\
        按租户合计、按型号明细（每行都能用 token 数 × 单价独立复算）与需要人工确认的异常列表。\n\n\
        窗口**左闭右开** `[from, to)`、单位毫秒：缺省「最近 24 小时」，跨度上限 31 天（超出 `500414`，HTTP 422）。\n\n\
        取价按**用量发生的时刻**命中当时生效的价目（租户专属价优先于平台默认价），匹配不到就是未定价用量——\n\n\
        它会显式出现在异常列表里，绝不静默按 0 计价。`tenantID` 缺省 = 全平台；参数非法一律报错，不静默忽略。",
    security(("bearer_auth" = [])),
    params(
        ("from" = Option<i64>, Query, description = "窗口起点（毫秒，含）；缺省 = 终点往前 24 小时"),
        ("to" = Option<i64>, Query, description = "窗口终点（毫秒，不含）；缺省 = 此刻"),
        ("tenantID" = Option<String>, Query, description = "只对这一个租户对账；缺省 = 全平台"),
        ("currency" = Option<String>, Query, description = "结算币种；缺省取服务配置里的结算币种"),
    ),
    responses(
        (status = 200, description = "成功", body = ReconcileEnvelope),
        (status = "default", description = "业务异常（权限不足 / 窗口或参数非法 / 合计溢出）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn reconciliation_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/billing/reconciliation/export",
    tag = "Billing",
    operation_id = "billing.reconciliationExport",
    summary = "导出对账结果",
    description = "仅平台 ADMIN，与 `billing.reconciliation` 同一组窗口条件、同一份口径，但返回**文件流**。\n\n\
        行序固定为 合计 → 租户 → 型号 → 异常，`section` 列即所在分段；`format=csv`（缺省）返回\n\n\
        `text/csv; charset=utf-8`，带 UTF-8 BOM 且字段按 RFC 4180 转义；`format=ndjson` 返回\n\n\
        `application/x-ndjson; charset=utf-8`，每行一个对象。\n\n\
        命中 0 行是合法结果（窗口内没有流水），此时文件只有表头，不报 404；命中硬上限时\n\n\
        `X-Export-Truncated` 为 `true` 且只返回靠前的行——**先按窗口或租户收窄再导出**。\n\n\
        `Content-Disposition` 给出的文件名形如 `billing-<from>-<to>.<ext>`，时间戳即**实际生效**的窗口。",
    security(("bearer_auth" = [])),
    params(
        ("from" = Option<i64>, Query, description = "窗口起点（毫秒，含）；缺省 = 终点往前 24 小时"),
        ("to" = Option<i64>, Query, description = "窗口终点（毫秒，不含）；缺省 = 此刻"),
        ("tenantID" = Option<String>, Query, description = "只对这一个租户对账；缺省 = 全平台"),
        ("currency" = Option<String>, Query, description = "结算币种；缺省取服务配置里的结算币种"),
        ("format" = Option<String>, Query, description = "导出格式：`csv`（缺省，Excel 友好）或 `ndjson`（流式消费友好）"),
    ),
    responses(
        (status = 200, description = "对账文件流（`text/csv` 或 `application/x-ndjson`）；`X-Export-Rows` 为实际行数，`X-Export-Truncated` 为是否命中硬上限，`Content-Disposition` 给出文件名"),
        (status = "default", description = "业务异常（权限不足 / 窗口或参数非法）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn reconciliation_export_doc() {}
