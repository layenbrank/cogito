//! 审计导出的序列化：**纯函数**——不碰数据库、不做权限判定、不做截断。
//!
//! 单独成文件而不是塞进 `service.rs`，有两个理由：
//! 1. 导出格式是**对外契约**（列序、编码、行分隔），与查询实现正交、改动节奏不同；
//! 2. 纯函数可以在单测里逐字节断言 BOM / CRLF / 引号转义，不必起数据库。
//!
//! 下载文件名也在这里拼：窗口与扩展名是同一份导出契约的一部分，分开放只会各自漂移。
//!
//! 两种格式面向不同消费者，因此同一字段的形态**有意不一致**：
//! * `csv`：给 Excel 与人工排查。带 UTF-8 BOM（Excel 不看 `Content-Type`，没 BOM 会把中文
//!   按本地代码页解码成乱码）、CRLF 行分隔，时间列用 RFC 3339——表格里一列 `1789000000000`
//!   是读不出东西的。
//! * `ndjson`：给 SIEM / 流式消费。每行是一个完整的 API 对象（`createdAt` 仍是毫秒时间戳），
//!   与 `GET /audit` 响应体逐字段一致，消费方不需要第二套解析规则。
//!
//! 导出字段全是服务端生成的结构化值（UUID、动作码、资源码、IP、JSON），没有用户可控的
//! 自由文本，因此**不做** CSV 公式注入（`=cmd|'/c ...'!A1`）转义——那会把数据改脏。
//! 一旦将来加入用户名、标题一类自由文本列，必须回来重新评估这条结论。

use chrono::{DateTime, SecondsFormat, Utc};

use crate::services::gateway::schema::{AuditExportFormat, AuditR};

/// CSV 列序即导出契约：调整会打断既有脚本与报表，需同步 README 与 OAS 说明。
const CSV_HEADER: [&str; 8] = [
    "id",
    "tenantID",
    "actor",
    "action",
    "resource",
    "ip",
    "createdAt",
    "detail",
];

/// UTF-8 BOM。Excel 只认开头的这三个字节。
const BOM: char = '\u{feff}';

/// RFC 4180 规定的行分隔符；也是 Excel 在 Windows 上最稳的选择。
const CRLF: &str = "\r\n";

/// 文件名里的时间格式：UTC，无分隔符（`20260910T002640Z`）。
const UTC_STAMP: &str = "%Y%m%dT%H%M%SZ";

/// 把已按时间倒序取好的行渲染成响应体字节。
pub fn render(format: AuditExportFormat, rows: &[AuditR]) -> Vec<u8> {
    match format {
        AuditExportFormat::Csv => csv(rows),
        AuditExportFormat::Ndjson => ndjson(rows),
    }
}

/// 响应的 `Content-Type`（带 charset：两个格式都可能有中文，编码必须显式声明）。
pub const fn content_type(format: AuditExportFormat) -> &'static str {
    match format {
        AuditExportFormat::Csv => "text/csv; charset=utf-8",
        AuditExportFormat::Ndjson => "application/x-ndjson; charset=utf-8",
    }
}

/// 文件扩展名（供 `Content-Disposition` 拼文件名）。
pub const fn extension(format: AuditExportFormat) -> &'static str {
    match format {
        AuditExportFormat::Csv => "csv",
        AuditExportFormat::Ndjson => "ndjson",
    }
}

/// 下载文件名：`audit-<窗口起点>-<窗口终点>.<扩展名>`，时间用 UTC 紧凑格式。
///
/// 窗口写进文件名是因为导出可能被截断：拿到文件的人不用回看响应头就知道自己下的是哪一段。
/// 字符集保持纯 ASCII —— `Content-Disposition` 里裸 `filename` 不做 RFC 5987 编码，
/// 中文在部分客户端会变成乱码。
pub fn filename(from_millis: i64, to_millis: i64, format: AuditExportFormat) -> String {
    format!(
        "audit-{}-{}.{}",
        stamp(from_millis),
        stamp(to_millis),
        extension(format)
    )
}

/// 毫秒时间戳 → `20260910T002640Z`（`iso8601` 的紧凑版，去掉冒号与短横线）。
fn stamp(millis: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(millis)
        .map(|t| t.format(UTC_STAMP).to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

fn csv(rows: &[AuditR]) -> Vec<u8> {
    let mut out = String::with_capacity(64 + rows.len() * 192);
    out.push(BOM);
    out.push_str(&CSV_HEADER.join(","));
    out.push_str(CRLF);
    for row in rows {
        let created_at = iso8601(row.created_at);
        let detail = row
            .detail
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_default();
        let fields = [
            row.id.as_str(),
            row.tenant_id.as_deref().unwrap_or(""),
            row.actor.as_str(),
            row.action.as_str(),
            row.resource.as_str(),
            row.ip.as_deref().unwrap_or(""),
            created_at.as_str(),
            detail.as_str(),
        ];
        for (index, field) in fields.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            push_field(&mut out, field);
        }
        out.push_str(CRLF);
    }
    out.into_bytes()
}

fn ndjson(rows: &[AuditR]) -> Vec<u8> {
    let mut out = String::with_capacity(rows.len() * 224);
    for row in rows {
        // `AuditR` 只有 String / Option<String> / i64 / Value，序列化在数学上不可能失败
        // （失败条件是 map 键非字符串或浮点非有限）。这里宁可 panic 也不 `unwrap_or_default()`：
        // 静默产出一行空白，消费方只会当成一条空记录，比直接报错难查得多。
        out.push_str(&serde_json::to_string(row).expect("AuditR 序列化不可能失败"));
        out.push('\n');
    }
    out.into_bytes()
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

/// 毫秒时间戳 → RFC 3339 UTC（`2026-09-28T03:44:22.123Z`）；超出可表示范围时留空。
fn iso8601(millis: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(millis)
        .map(|t| t.to_rfc3339_opts(SecondsFormat::Millis, true))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn row(id: &str, action: &str) -> AuditR {
        AuditR {
            id: id.to_string(),
            tenant_id: Some("11111111-1111-1111-1111-111111111111".to_string()),
            actor: "22222222-2222-2222-2222-222222222222".to_string(),
            action: action.to_string(),
            resource: "gateway".to_string(),
            detail: Some(json!({ "model": "auto" })),
            ip: Some("10.0.0.1".to_string()),
            created_at: 1_789_000_000_123,
        }
    }

    fn body(format: AuditExportFormat, rows: &[AuditR]) -> String {
        String::from_utf8(render(format, rows)).expect("渲染结果必须是合法 UTF-8")
    }

    /// 最后一条数据行（去掉结尾的 CRLF；行内可能自带 `\r\n`，所以不能按行切分后取 `last`）。
    fn last_data_line(text: &str) -> &str {
        text.trim_end_matches(CRLF)
            .rsplit(CRLF)
            .next()
            .expect("至少一行")
    }

    #[test]
    fn csv_starts_with_bom_then_header_then_crlf() {
        let text = body(AuditExportFormat::Csv, &[]);
        assert_eq!(text, format!("\u{feff}{}\r\n", CSV_HEADER.join(",")));
    }

    #[test]
    fn csv_uses_crlf_and_one_line_per_row() {
        let text = body(
            AuditExportFormat::Csv,
            &[row("a", "gateway.chat"), row("b", "gateway.embedding")],
        );
        assert_eq!(text.matches(CRLF).count(), 3);
        assert!(!text.replace(CRLF, "").contains('\n'));
    }

    #[test]
    fn csv_formats_time_as_rfc3339_and_keeps_detail_json() {
        let text = body(AuditExportFormat::Csv, &[row("a", "gateway.chat")]);
        let line = last_data_line(&text);
        // detail 是 JSON，含引号 → 必须整体加引号且内部引号翻倍
        assert_eq!(
            line,
            "a,11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222,\
gateway.chat,gateway,10.0.0.1,2026-09-10T00:26:40.123Z,\"{\"\"model\"\":\"\"auto\"\"}\"",
            "\n{line}"
        );
    }

    #[test]
    fn csv_quotes_separator_quote_newline_and_surrounding_space() {
        let cases = [
            ("a,b", "\"a,b\""),
            ("say \"hi\"", "\"say \"\"hi\"\"\""),
            ("line\r\nbreak", "\"line\r\nbreak\""),
            ("  padded  ", "\"  padded  \""),
            ("plain", "plain"),
        ];
        for (raw, expected) in cases {
            let mut out = String::new();
            push_field(&mut out, raw);
            assert_eq!(out, expected, "字段 {raw:?}");
        }
    }

    #[test]
    fn csv_quotes_every_column_through_the_same_escaper() {
        // 整行走一遍：确认 `csv()` 对**每一列**都过 `push_field`，而不是只照顾显眼的几列。
        // 字段形态目前都是服务端生成的结构化值，用逗号 + 引号正是为了将来加入自由文本列时
        // 这条不变量仍然成立。
        let mut row = row("a,b", "gateway.chat");
        row.resource = "say \"hi\"".to_owned();
        let text = body(AuditExportFormat::Csv, &[row]);
        let line = last_data_line(&text);
        assert_eq!(
            line,
            "\"a,b\",11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222,\
             gateway.chat,\"say \"\"hi\"\"\",10.0.0.1,2026-09-10T00:26:40.123Z,\
             \"{\"\"model\"\":\"\"auto\"\"}\""
        );
    }

    #[test]
    fn csv_leaves_absent_optionals_empty() {
        let mut row = row("a", "gateway.chat");
        row.tenant_id = None;
        row.ip = None;
        row.detail = None;
        let text = body(AuditExportFormat::Csv, &[row]);
        let line = last_data_line(&text);
        assert_eq!(
            line,
            "a,,22222222-2222-2222-2222-222222222222,gateway.chat,gateway,,2026-09-10T00:26:40.123Z,"
        );
    }

    #[test]
    fn ndjson_emits_exactly_one_wire_object_per_line() {
        let text = body(
            AuditExportFormat::Ndjson,
            &[row("a", "gateway.chat"), row("b", "gateway.embedding")],
        );
        assert!(text.ends_with('\n'));
        assert!(!text.contains('\r'));
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        let first: serde_json::Value = serde_json::from_str(lines[0]).expect("每行都是完整 JSON");
        assert_eq!(first["id"], "a");
        assert_eq!(first["action"], "gateway.chat");
        // 与 API 响应体一致：毫秒时间戳，而不是 CSV 里的 RFC 3339
        assert_eq!(first["createdAt"], 1_789_000_000_123_i64);
    }

    #[test]
    fn ndjson_of_empty_selection_is_empty_bytes() {
        assert!(render(AuditExportFormat::Ndjson, &[]).is_empty());
    }

    #[test]
    fn csv_and_ndjson_declare_distinct_content_types_and_extensions() {
        assert_eq!(
            content_type(AuditExportFormat::Csv),
            "text/csv; charset=utf-8"
        );
        assert_eq!(
            content_type(AuditExportFormat::Ndjson),
            "application/x-ndjson; charset=utf-8"
        );
        assert_eq!(extension(AuditExportFormat::Csv), "csv");
        assert_eq!(extension(AuditExportFormat::Ndjson), "ndjson");
    }

    #[test]
    fn filename_carries_the_window_and_stays_ascii() {
        // 1_789_000_000_123 ms == 2026-09-10T00:26:40.123Z；起点取同一时刻的 30 天前
        let to = 1_789_000_000_123_i64;
        let from = to - 30 * 24 * 60 * 60 * 1000;
        let name = filename(from, to, AuditExportFormat::Csv);
        assert_eq!(name, "audit-20260811T002640Z-20260910T002640Z.csv");
        assert!(name.is_ascii(), "文件名必须纯 ASCII：{name}");
        assert_eq!(
            filename(from, to, AuditExportFormat::Ndjson),
            "audit-20260811T002640Z-20260910T002640Z.ndjson"
        );
    }

    #[test]
    fn filename_degrades_instead_of_panicking_on_unrepresentable_millis() {
        assert_eq!(
            filename(i64::MAX, i64::MIN, AuditExportFormat::Csv),
            "audit-unknown-unknown.csv"
        );
    }
}
