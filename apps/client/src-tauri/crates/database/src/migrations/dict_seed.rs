//! 状态字典初始 seed（与 cogito_core::dict::codes 对齐）。

const TS: i64 = 1_700_000_000_000;

/// 建表 + seed SQL，按顺序执行。
pub fn statements() -> Vec<String> {
    let mut out = vec![
        "CREATE TABLE IF NOT EXISTS dict_type (\
             code TEXT PRIMARY KEY NOT NULL, \
             name TEXT NOT NULL, \
             description TEXT NULL, \
             \"createdAt\" INTEGER NOT NULL, \
             \"updatedAt\" INTEGER NOT NULL)"
            .to_string(),
        "CREATE TABLE IF NOT EXISTS dict_item (\
             id TEXT PRIMARY KEY NOT NULL, \
             \"typeCode\" TEXT NOT NULL, \
             value TEXT NOT NULL, \
             label TEXT NOT NULL, \
             sort INTEGER NOT NULL DEFAULT 0, \
             enabled INTEGER NOT NULL DEFAULT 1, \
             \"isDefault\" INTEGER NOT NULL DEFAULT 0, \
             meta TEXT NULL, \
             \"createdAt\" INTEGER NOT NULL, \
             \"updatedAt\" INTEGER NOT NULL, \
             UNIQUE (\"typeCode\", value), \
             CONSTRAINT fk_dict_item_type FOREIGN KEY (\"typeCode\") \
                 REFERENCES dict_type (code) ON DELETE CASCADE ON UPDATE CASCADE)"
            .to_string(),
        "CREATE INDEX IF NOT EXISTS idx_dict_item_type ON dict_item (\"typeCode\", enabled, sort)"
            .to_string(),
    ];

    for (code, name, description) in TYPES {
        let desc = match description {
            Some(text) => format!("'{text}'"),
            None => "NULL".to_string(),
        };
        out.push(format!(
            "INSERT OR IGNORE INTO dict_type (code, name, description, \"createdAt\", \"updatedAt\") \
             VALUES ('{code}', '{name}', {desc}, {TS}, {TS})"
        ));
    }

    for (id, type_code, value, label, sort, is_default, meta) in ITEMS {
        let meta_sql = match meta {
            Some(raw) => format!("'{raw}'"),
            None => "NULL".to_string(),
        };
        let is_default_i = if *is_default { 1 } else { 0 };
        out.push(format!(
            "INSERT OR IGNORE INTO dict_item \
             (id, \"typeCode\", value, label, sort, enabled, \"isDefault\", meta, \"createdAt\", \"updatedAt\") \
             VALUES ('{id}', '{type_code}', '{value}', '{label}', {sort}, 1, {is_default_i}, {meta_sql}, {TS}, {TS})"
        ));
    }

    out
}

const TYPES: &[(&str, &str, Option<&str>)] = &[
    ("knowledge_doc_status", "文档状态", Some("知识库文档发布状态")),
    ("knowledge_doc_source", "文档来源", Some("知识库文档写入来源")),
    ("knowledge_cloud_status", "云端索引状态", Some("本地云端索引同步状态")),
    ("knowledge_base_scope", "知识库范围", Some("个人或租户共享")),
    ("automation_run_status", "自动化运行状态", Some("定时任务单次运行状态")),
    ("automation_trigger_kind", "自动化触发方式", Some("准点 / 手动 / 补跑")),
    ("automation_owner", "自动化执行方", Some("本机 / goose / 云端")),
    ("automation_run_as", "自动化运行身份", Some("用户或租户身份")),
    ("directive_draft_status", "指令草稿状态", Some("待确认 / 已保存 / 已丢弃")),
    ("asset_status", "资源状态", Some("本地资源状态")),
    ("album_status", "相簿状态", Some("捕获库相簿状态")),
];

/// (id, typeCode, value, label, sort, isDefault, meta)
const ITEMS: &[(&str, &str, &str, &str, i32, bool, Option<&str>)] = &[
    ("dict-kds-001", "knowledge_doc_status", "001", "草稿", 10, true, None),
    ("dict-kds-002", "knowledge_doc_status", "002", "已发布", 20, false, None),
    ("dict-kdo-001", "knowledge_doc_source", "001", "手动", 10, true, None),
    ("dict-kdo-002", "knowledge_doc_source", "002", "智能体", 20, false, None),
    ("dict-kdo-003", "knowledge_doc_source", "003", "导入", 30, false, None),
    ("dict-kdo-004", "knowledge_doc_source", "004", "编辑撰写", 40, false, None),
    ("dict-kcs-001", "knowledge_cloud_status", "001", "空闲", 10, true, None),
    ("dict-kcs-002", "knowledge_cloud_status", "002", "待同步", 20, false, None),
    (
        "dict-kcs-003",
        "knowledge_cloud_status",
        "003",
        "索引中",
        30,
        false,
        Some(r#"{"tone":"amber"}"#),
    ),
    (
        "dict-kcs-004",
        "knowledge_cloud_status",
        "004",
        "已上云",
        40,
        false,
        Some(r#"{"tone":"emerald"}"#),
    ),
    (
        "dict-kcs-005",
        "knowledge_cloud_status",
        "005",
        "同步失败",
        50,
        false,
        Some(r#"{"tone":"destructive"}"#),
    ),
    ("dict-kbs-001", "knowledge_base_scope", "001", "个人", 10, true, None),
    ("dict-kbs-002", "knowledge_base_scope", "002", "租户", 20, false, None),
    ("dict-ars-001", "automation_run_status", "001", "等待", 10, true, None),
    ("dict-ars-002", "automation_run_status", "002", "执行中", 20, false, None),
    ("dict-ars-003", "automation_run_status", "003", "成功", 30, false, None),
    ("dict-ars-004", "automation_run_status", "004", "失败", 40, false, None),
    ("dict-atk-001", "automation_trigger_kind", "001", "按时", 10, true, None),
    ("dict-atk-002", "automation_trigger_kind", "002", "手动", 20, false, None),
    ("dict-atk-003", "automation_trigger_kind", "003", "补跑", 30, false, None),
    ("dict-ao-001", "automation_owner", "001", "本机", 10, true, None),
    ("dict-ao-002", "automation_owner", "002", "Goose", 20, false, None),
    ("dict-ao-003", "automation_owner", "003", "云端", 30, false, None),
    ("dict-ara-001", "automation_run_as", "001", "用户", 10, true, None),
    ("dict-ara-002", "automation_run_as", "002", "租户", 20, false, None),
    ("dict-dds-001", "directive_draft_status", "001", "待确认", 10, true, None),
    ("dict-dds-002", "directive_draft_status", "002", "已保存", 20, false, None),
    ("dict-dds-003", "directive_draft_status", "003", "已丢弃", 30, false, None),
    ("dict-as-001", "asset_status", "001", "正常", 10, true, None),
    ("dict-al-001", "album_status", "001", "正常", 10, true, None),
];
