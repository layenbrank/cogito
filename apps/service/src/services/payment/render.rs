//! 对账导出的序列化：**纯函数**——不碰数据库、不做权限判定、不做业务计算。
//!
//! 与 `gateway::render` 同一套导出契约（UTF-8 BOM、CRLF、RFC 4180 引号规则、下载文件名），
//! 但列结构完全不同，因此各自一份实现而不是硬凑一个泛型：审计是「一行一个事件」，
//! 对账是**四种粒度的行拼一份文件**——`TOTAL`（全局合计）、`TENANT`（租户合计）、
//! `MODEL`（型号明细，可逐行用「token × 单价」复算）、`EXCEPTION`（需要人工确认的异常）。
//!
//! 为什么塞进一个文件而不是切成四份：对账是**对给人看**的。四份文件意味着对账的人要自己
//! 对齐窗口、币种和口径；一份文件加 `section` 列，Excel 里一筛就能从合计钻到明细。
//! 代价是列宽固定 23 列、每行只填自己那一部分字段——用空值表达「本行没有这个概念」，
//! 比用同一列承载两种含义（`amount` 一会儿是用量金额、一会儿是订单金额）更难读错。
//!
//! 导出的每一列都是服务端生成值（UUID、类型码、金额、token 数，以及内核拼好的中文说明），
//! 没有用户可控的自由文本，因此**不做** CSV 公式注入（`=cmd|'/c ...'!A1`）转义——
//! 那会把数据改脏。`remark` 目前由服务端在金额不符 / 迟到支付 / 关单时写入，
//! 一旦它变成用户可填字段，必须回来重新评估这条结论。

use chrono::{DateTime, Utc};
use serde::Serialize;

use billing::{ExceptionKind, Reconciliation};

use crate::services::payment::schema::ReconcileExportFormat;

/// 导出行的硬上限。对账窗口最长 31 天，`EXCEPTION` 行在极端情况下可以逼近用量行数，
/// 而这份文件的消费方式是「给人看 / 给表格算」，不是数据归档。
pub const EXPORT_MAX_ROWS: usize = 50_000;

/// 行的粒度。`section` 是导出契约的一部分，改名会打断既有脚本。
const SECTION_TOTAL: &str = "TOTAL";
const SECTION_TENANT: &str = "TENANT";
const SECTION_MODEL: &str = "MODEL";
const SECTION_EXCEPTION: &str = "EXCEPTION";

/// CSV 列序即导出契约：调整会打断既有脚本与报表，需同步 README 与 OAS 说明。
const CSV_HEADER: [&str; 23] = [
    "section",
    "kind",
    "tenantID",
    "modelID",
    "modelName",
    "priceID",
    "currency",
    "inputPricePerMillion",
    "outputPricePerMillion",
    "promptTokens",
    "completionTokens",
    "requests",
    "usageAmount",
    "orderAmount",
    "delta",
    "unpricedRequests",
    "failedRequests",
    "mismatchedAmount",
    "mismatchedOrderAmount",
    "paidOrders",
    "orderNo",
    "amount",
    "detail",
];

/// UTF-8 BOM。Excel 只认开头的这三个字节。
const BOM: char = '\u{feff}';

/// RFC 4180 规定的行分隔符；也是 Excel 在 Windows 上最稳的选择。
const CRLF: &str = "\r\n";

/// 文件名里的时间格式：UTC，无分隔符（`20260910T002640Z`）。
const UTC_STAMP: &str = "%Y%m%dT%H%M%SZ";

/// 一行导出。字段顺序即 CSV 列序，也即 NDJSON 的键序。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRow {
    section: &'static str,
    /// 异常类型码，只有 `EXCEPTION` 行有
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<&'static str>,
    #[serde(rename = "tenantID", skip_serializing_if = "Option::is_none")]
    tenant_id: Option<String>,
    #[serde(rename = "modelID", skip_serializing_if = "Option::is_none")]
    model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model_name: Option<String>,
    #[serde(rename = "priceID", skip_serializing_if = "Option::is_none")]
    price_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    input_price_per_million: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_price_per_million: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prompt_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    completion_tokens: Option<i64>,
    /// `TOTAL` / `TENANT` 行是窗口内请求数，`MODEL` 行是该型号请求数
    #[serde(skip_serializing_if = "Option::is_none")]
    requests: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    usage_amount: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    order_amount: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    delta: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unpriced_requests: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    failed_requests: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mismatched_amount: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mismatched_order_amount: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    paid_orders: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    order_no: Option<String>,
    /// `MODEL` 行是用量金额，`EXCEPTION` 行是该异常涉及的金额
    #[serde(skip_serializing_if = "Option::is_none")]
    amount: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

/// 一次导出：已经排好序、截好断的行，外加「是否被截断」的标记。
#[derive(Debug, Clone)]
pub struct Export {
    pub rows: Vec<ExportRow>,
    pub truncated: bool,
}

/// 把对账结果摊平成导出行。
///
/// 顺序即优先级：合计在最前，异常在最后。截断发生时砍掉的是尾部（明细与异常），
/// 这份文件至少还能回答「这段时间账对不对」这个问题。
#[must_use]
pub fn build(report: &Reconciliation) -> Export {
    let mut rows = Vec::with_capacity(report.tenants.len() + report.models.len() + 2);
    rows.push(ExportRow {
        section: SECTION_TOTAL,
        kind: None,
        tenant_id: None,
        model_id: None,
        model_name: None,
        price_id: None,
        currency: Some(report.currency.clone()),
        input_price_per_million: None,
        output_price_per_million: None,
        prompt_tokens: None,
        completion_tokens: None,
        requests: Some(report.totals.usage_requests),
        usage_amount: Some(report.totals.usage_amount),
        order_amount: Some(report.totals.order_amount),
        delta: Some(report.totals.delta),
        unpriced_requests: Some(report.totals.unpriced_requests),
        failed_requests: Some(report.totals.failed_requests),
        mismatched_amount: Some(report.totals.mismatched_amount),
        mismatched_order_amount: Some(report.totals.mismatched_order_amount),
        paid_orders: Some(report.totals.paid_orders),
        order_no: None,
        amount: None,
        // 合计行自带窗口说明：文件离开响应头之后仍能说明自己算的是哪一段
        detail: Some(format!(
            "{} ~ {}",
            stamp(report.from_millis),
            stamp(report.to_millis)
        )),
    });

    for tenant in &report.tenants {
        let totals = &tenant.totals;
        rows.push(ExportRow {
            section: SECTION_TENANT,
            kind: None,
            tenant_id: tenant.tenant_id.map(|id| id.to_string()),
            model_id: None,
            model_name: None,
            price_id: None,
            currency: Some(report.currency.clone()),
            input_price_per_million: None,
            output_price_per_million: None,
            prompt_tokens: None,
            completion_tokens: None,
            requests: Some(totals.usage_requests),
            usage_amount: Some(totals.usage_amount),
            order_amount: Some(totals.order_amount),
            delta: Some(totals.delta),
            unpriced_requests: Some(totals.unpriced_requests),
            failed_requests: Some(totals.failed_requests),
            mismatched_amount: Some(totals.mismatched_amount),
            mismatched_order_amount: Some(totals.mismatched_order_amount),
            paid_orders: Some(totals.paid_orders),
            order_no: None,
            amount: None,
            detail: None,
        });
    }

    for model in &report.models {
        rows.push(ExportRow {
            section: SECTION_MODEL,
            kind: None,
            tenant_id: model.tenant_id.map(|id| id.to_string()),
            model_id: Some(model.model_id.to_string()),
            model_name: model.model_name.clone(),
            price_id: model.price_id.map(|id| id.to_string()),
            currency: model.currency.clone(),
            input_price_per_million: model.input_per_million,
            output_price_per_million: model.output_per_million,
            prompt_tokens: Some(model.prompt_tokens),
            completion_tokens: Some(model.completion_tokens),
            requests: Some(model.requests),
            usage_amount: None,
            order_amount: None,
            delta: None,
            unpriced_requests: None,
            failed_requests: None,
            mismatched_amount: None,
            mismatched_order_amount: None,
            paid_orders: None,
            order_no: None,
            amount: model.amount,
            detail: if model.mismatched_currency {
                Some(ExceptionKind::CurrencyMismatch.description().to_string())
            } else if model.amount.is_none() {
                Some(ExceptionKind::UnpricedUsage.description().to_string())
            } else {
                None
            },
        });
    }

    for exception in &report.exceptions {
        rows.push(ExportRow {
            section: SECTION_EXCEPTION,
            kind: Some(exception.kind.as_str()),
            tenant_id: exception.tenant_id.map(|id| id.to_string()),
            model_id: exception.model_id.map(|id| id.to_string()),
            model_name: None,
            price_id: None,
            currency: Some(report.currency.clone()),
            input_price_per_million: None,
            output_price_per_million: None,
            prompt_tokens: None,
            completion_tokens: None,
            requests: None,
            usage_amount: None,
            order_amount: None,
            delta: None,
            unpriced_requests: None,
            failed_requests: None,
            mismatched_amount: None,
            mismatched_order_amount: None,
            paid_orders: None,
            order_no: exception.order_no.clone(),
            amount: exception.amount,
            detail: Some(exception.detail.clone()),
        });
    }

    let truncated = rows.len() > EXPORT_MAX_ROWS;
    if truncated {
        rows.truncate(EXPORT_MAX_ROWS);
    }
    Export { rows, truncated }
}

/// 把导出行渲染成响应体字节。
#[must_use]
pub fn render(format: ReconcileExportFormat, rows: &[ExportRow]) -> Vec<u8> {
    match format {
        ReconcileExportFormat::Csv => csv(rows),
        ReconcileExportFormat::Ndjson => ndjson(rows),
    }
}

/// 响应的 `Content-Type`（带 charset：两个格式都可能有中文，编码必须显式声明）。
pub const fn content_type(format: ReconcileExportFormat) -> &'static str {
    match format {
        ReconcileExportFormat::Csv => "text/csv; charset=utf-8",
        ReconcileExportFormat::Ndjson => "application/x-ndjson; charset=utf-8",
    }
}

/// 文件扩展名（供 `Content-Disposition` 拼文件名）。
pub const fn extension(format: ReconcileExportFormat) -> &'static str {
    match format {
        ReconcileExportFormat::Csv => "csv",
        ReconcileExportFormat::Ndjson => "ndjson",
    }
}

/// 下载文件名：`billing-<窗口起点>-<窗口终点>.<扩展名>`，时间用 UTC 紧凑格式。
///
/// 纯 ASCII：`Content-Disposition` 里裸 `filename` 不做 RFC 5987 编码，中文在部分客户端
/// 会变成乱码。
#[must_use]
pub fn filename(from_millis: i64, to_millis: i64, format: ReconcileExportFormat) -> String {
    format!(
        "billing-{}-{}.{}",
        stamp(from_millis),
        stamp(to_millis),
        extension(format)
    )
}

fn csv(rows: &[ExportRow]) -> Vec<u8> {
    let mut out = String::with_capacity(128 + rows.len() * 192);
    out.push(BOM);
    out.push_str(&CSV_HEADER.join(","));
    out.push_str(CRLF);
    for row in rows {
        for (index, field) in row.cells().iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            push_field(&mut out, field);
        }
        out.push_str(CRLF);
    }
    out.into_bytes()
}

fn ndjson(rows: &[ExportRow]) -> Vec<u8> {
    let mut out = String::with_capacity(rows.len() * 256);
    for row in rows {
        // `ExportRow` 只有 `&'static str` / `String` / `i64` / `Option`，序列化在数学上不可能
        // 失败。宁可 panic 也不 `unwrap_or_default()`：静默产出一行空白，消费方只会当成一条
        // 空记录，比直接报错难查得多。
        out.push_str(&serde_json::to_string(row).expect("ExportRow 序列化不可能失败"));
        out.push('\n');
    }
    out.into_bytes()
}

impl ExportRow {
    /// 按 CSV 列序摊平成一行的字面值；缺省即空串。
    ///
    /// 顺序必须与 [`CSV_HEADER`] 严格一致——两者漂移会让整份报表错列，而且**错得很安静**，
    /// 所以有单测逐项比对长度。
    fn cells(&self) -> Vec<String> {
        let text = |value: Option<&String>| value.cloned().unwrap_or_default();
        let number = |value: Option<i64>| value.map(|n| n.to_string()).unwrap_or_default();
        vec![
            self.section.to_string(),
            self.kind.unwrap_or_default().to_string(),
            text(self.tenant_id.as_ref()),
            text(self.model_id.as_ref()),
            text(self.model_name.as_ref()),
            text(self.price_id.as_ref()),
            text(self.currency.as_ref()),
            number(self.input_price_per_million),
            number(self.output_price_per_million),
            number(self.prompt_tokens),
            number(self.completion_tokens),
            number(self.requests),
            number(self.usage_amount),
            number(self.order_amount),
            number(self.delta),
            number(self.unpriced_requests),
            number(self.failed_requests),
            number(self.mismatched_amount),
            number(self.mismatched_order_amount),
            number(self.paid_orders),
            text(self.order_no.as_ref()),
            number(self.amount),
            text(self.detail.as_ref()),
        ]
    }
}

/// RFC 4180：字段含分隔符、引号或换行时用双引号整体包住，内部引号翻倍。
///
/// 额外把「首尾空白」也纳入加引号条件：RFC 没要求，但 Excel / Sheets 会悄悄吃掉它，
/// 于是同一份 CSV 在表格里和在脚本里读到的东西不一样。
fn push_field(out: &mut String, field: &str) {
    let needs_quotes = field.contains([',', '"', '\r', '\n'])
        || field.starts_with([' ', '\t'])
        || field.ends_with([' ', '\t']);
    if !needs_quotes {
        out.push_str(field);
        return;
    }
    out.push('"');
    for ch in field.chars() {
        if ch == '"' {
            out.push('"');
        }
        out.push(ch);
    }
    out.push('"');
}

/// 毫秒时间戳 → `20260910T002640Z`。
fn stamp(millis: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(millis)
        .map(|t| t.format(UTC_STAMP).to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use billing::{ModelReconciliation, ReconcileException, TenantReconciliation, Totals};
    use uuid::Uuid;

    use super::*;

    fn uuid(n: u8) -> Uuid {
        Uuid::from_u128(n as u128)
    }

    fn report() -> Reconciliation {
        let totals = Totals {
            usage_amount: 1_234,
            order_amount: 1_000,
            delta: 234,
            usage_requests: 7,
            unpriced_requests: 2,
            failed_requests: 1,
            paid_orders: 1,
            ..Totals::default()
        };
        Reconciliation {
            from_millis: 1_789_000_000_000,
            to_millis: 1_789_086_400_000,
            currency: "CNY".to_string(),
            totals,
            tenants: vec![TenantReconciliation {
                tenant_id: Some(uuid(1)),
                totals,
            }],
            models: vec![ModelReconciliation {
                tenant_id: Some(uuid(1)),
                model_id: uuid(2),
                model_name: Some("auto, \"fast\"".to_string()),
                price_id: Some(uuid(3)),
                currency: Some("CNY".to_string()),
                input_per_million: Some(100),
                output_per_million: Some(200),
                prompt_tokens: 1_000,
                completion_tokens: 500,
                requests: 7,
                amount: Some(1_234),
                mismatched_currency: false,
            }],
            exceptions: vec![ReconcileException {
                kind: ExceptionKind::PaidNotActivated,
                tenant_id: Some(uuid(1)),
                model_id: None,
                order_no: Some("202609100001".to_string()),
                amount: Some(1_000),
                detail: "已收款但未开通订阅".to_string(),
            }],
        }
    }

    fn body(format: ReconcileExportFormat) -> String {
        let export = build(&report());
        String::from_utf8(render(format, &export.rows)).expect("渲染结果必须是合法 UTF-8")
    }

    fn column(name: &str) -> usize {
        CSV_HEADER
            .iter()
            .position(|header| *header == name)
            .expect("表头必须包含该列")
    }

    #[test]
    fn csv_starts_with_bom_then_header_then_crlf() {
        let text = String::from_utf8(render(ReconcileExportFormat::Csv, &[])).expect("UTF-8");
        assert_eq!(text, format!("\u{feff}{}\r\n", CSV_HEADER.join(",")));
    }

    #[test]
    fn header_and_cells_never_drift() {
        for row in &build(&report()).rows {
            assert_eq!(
                row.cells().len(),
                CSV_HEADER.len(),
                "导出行列数必须与表头一致：{}",
                row.section
            );
        }
    }

    #[test]
    fn rows_are_ordered_total_tenant_model_exception() {
        let export = build(&report());
        let sections: Vec<&str> = export.rows.iter().map(|row| row.section).collect();
        assert_eq!(
            sections,
            vec![
                SECTION_TOTAL,
                SECTION_TENANT,
                SECTION_MODEL,
                SECTION_EXCEPTION
            ]
        );
        assert!(!export.truncated);
    }

    #[test]
    fn csv_quotes_fields_with_delimiters_and_doubles_quotes() {
        let text = body(ReconcileExportFormat::Csv);
        assert!(
            text.contains("\"auto, \"\"fast\"\"\""),
            "含逗号与引号的型号名必须整体加引号且内部引号翻倍：{text}"
        );
    }

    #[test]
    fn csv_uses_crlf_inside_every_line_break() {
        let text = body(ReconcileExportFormat::Csv);
        assert!(text.ends_with(CRLF), "每行都以 CRLF 结尾");
        assert!(
            !text.replace(CRLF, "").contains('\n'),
            "行分隔符只用 CRLF，不能出现裸 LF"
        );
    }

    #[test]
    fn empty_numeric_cell_is_blank_not_zero() {
        // TOTAL 行没有 token 数与单行金额：必须留空，写成 0 会被读成「真的一分钱没花」
        let cells = build(&report()).rows[0].cells();
        assert_eq!(cells[column("promptTokens")], "");
        assert_eq!(cells[column("amount")], "");
    }

    #[test]
    fn model_row_carries_token_and_price_columns() {
        let cells = build(&report()).rows[2].cells();
        assert_eq!(cells[column("section")], SECTION_MODEL);
        assert_eq!(cells[column("promptTokens")], "1000");
        assert_eq!(cells[column("inputPricePerMillion")], "100");
        assert_eq!(cells[column("amount")], "1234");
    }

    #[test]
    fn total_row_describes_its_own_window() {
        let cells = build(&report()).rows[0].cells();
        assert_eq!(
            cells[column("detail")],
            "20260910T002640Z ~ 20260911T002640Z"
        );
        assert_eq!(cells[column("currency")], "CNY");
        assert_eq!(cells[column("delta")], "234");
    }

    #[test]
    fn ndjson_omits_absent_keys_and_keeps_one_object_per_line() {
        let text = body(ReconcileExportFormat::Ndjson);
        let lines: Vec<&str> = text.trim_end_matches('\n').split('\n').collect();
        assert_eq!(lines.len(), 4);
        let total: serde_json::Value = serde_json::from_str(lines[0]).expect("合法 JSON");
        assert_eq!(total["section"], "TOTAL");
        assert_eq!(total["usageAmount"], 1_234);
        assert!(
            total.get("promptTokens").is_none(),
            "缺省字段不出现在 NDJSON 里"
        );
        let exception: serde_json::Value = serde_json::from_str(lines[3]).expect("合法 JSON");
        assert_eq!(exception["kind"], "PAID_NOT_ACTIVATED");
        assert_eq!(exception["orderNo"], "202609100001");
    }

    #[test]
    fn content_type_and_filename_are_stable() {
        assert_eq!(
            content_type(ReconcileExportFormat::Csv),
            "text/csv; charset=utf-8"
        );
        assert_eq!(extension(ReconcileExportFormat::Ndjson), "ndjson");
        assert_eq!(
            filename(
                1_789_000_000_000,
                1_789_086_400_000,
                ReconcileExportFormat::Csv
            ),
            "billing-20260910T002640Z-20260911T002640Z.csv"
        );
    }
}
