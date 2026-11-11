//! 状态字典初始 seed（与 docs/contracts/dict.yaml 对齐：全局池 + type 认领）。

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
             value TEXT NOT NULL UNIQUE, \
             key TEXT NOT NULL UNIQUE, \
             label TEXT, \
             sort INTEGER NOT NULL DEFAULT 0, \
             enabled INTEGER NOT NULL DEFAULT 1, \
             meta TEXT NULL, \
             revision INTEGER NOT NULL DEFAULT 1, \
             \"createdAt\" INTEGER NOT NULL, \
             \"updatedAt\" INTEGER NOT NULL)"
            .to_string(),
        "CREATE TABLE IF NOT EXISTS dict_type_item (\
             \"typeCode\" TEXT NOT NULL, \
             value TEXT NOT NULL, \
             label TEXT NULL, \
             \"isDefault\" INTEGER NOT NULL DEFAULT 0, \
             sort INTEGER NOT NULL DEFAULT 0, \
             PRIMARY KEY (\"typeCode\", value), \
             CONSTRAINT fk_dict_type_item_type FOREIGN KEY (\"typeCode\") \
                 REFERENCES dict_type (code) ON DELETE CASCADE ON UPDATE CASCADE, \
             CONSTRAINT fk_dict_type_item_value FOREIGN KEY (value) \
                 REFERENCES dict_item (value) ON DELETE CASCADE ON UPDATE CASCADE)"
            .to_string(),
        "CREATE TABLE IF NOT EXISTS dict_tenant_item (\
             \"tenantId\" TEXT NOT NULL, \
             \"typeCode\" TEXT NOT NULL, \
             value TEXT NOT NULL, \
             label TEXT NULL, \
             enabled INTEGER NULL, \
             PRIMARY KEY (\"tenantId\", \"typeCode\", value))"
            .to_string(),
        "CREATE INDEX IF NOT EXISTS idx_dict_type_item_type ON dict_type_item (\"typeCode\", sort)"
            .to_string(),
        "CREATE INDEX IF NOT EXISTS idx_dict_item_key ON dict_item (key)".to_string(),
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

    for (id, value, key, label, sort, meta) in POOL {
        let meta_sql = match meta {
            Some(raw) => format!("'{raw}'"),
            None => "NULL".to_string(),
        };
        out.push(format!(
            "INSERT OR IGNORE INTO dict_item \
             (id, value, key, label, sort, enabled, meta, revision, \"createdAt\", \"updatedAt\") \
             VALUES ('{id}', '{value}', '{key}', '{label}', {sort}, 1, {meta_sql}, 1, {TS}, {TS})"
        ));
    }

    for (type_code, value, sort, is_default, label) in CLAIMS {
        let label_sql = match label {
            Some(text) => format!("'{text}'"),
            None => "NULL".to_string(),
        };
        let is_default_i = if *is_default { 1 } else { 0 };
        out.push(format!(
            "INSERT OR IGNORE INTO dict_type_item \
             (\"typeCode\", value, label, \"isDefault\", sort) \
             VALUES ('{type_code}', '{value}', {label_sql}, {is_default_i}, {sort})"
        ));
    }

    out
}

const TYPES: &[(&str, &str, Option<&str>)] = &[
    (
        "knowledge_doc_status",
        "文档状态",
        Some("知识库文档发布状态"),
    ),
    (
        "knowledge_doc_source",
        "文档来源",
        Some("知识库文档写入来源"),
    ),
    (
        "knowledge_cloud_status",
        "云端索引状态",
        Some("本地云端索引同步状态"),
    ),
    ("knowledge_base_scope", "知识库范围", Some("个人或租户共享")),
    (
        "automation_run_status",
        "自动化运行状态",
        Some("定时任务单次运行状态"),
    ),
    (
        "automation_trigger_kind",
        "自动化触发方式",
        Some("准点 / 手动 / 补跑"),
    ),
    (
        "automation_owner",
        "自动化执行方",
        Some("本机 / goose / 云端"),
    ),
    (
        "automation_run_as",
        "自动化运行身份",
        Some("用户或租户身份"),
    ),
    (
        "directive_draft_status",
        "指令草稿状态",
        Some("待确认 / 已保存 / 已丢弃"),
    ),
    ("asset_status", "资源状态", Some("本地资源状态")),
    ("album_status", "相簿状态", Some("捕获库相簿状态")),
];

/// (id, value, key, label, sort, meta)
const POOL: &[(&str, &str, &str, &str, i32, Option<&str>)] = &[
    ("dict-pool-001", "001", "DRAFT", "草稿", 10, None),
    ("dict-pool-002", "002", "PUBLISHED", "已发布", 20, None),
    ("dict-pool-003", "003", "MANUAL", "手动", 10, None),
    ("dict-pool-004", "004", "AGENT", "智能体", 20, None),
    ("dict-pool-005", "005", "IMPORT", "导入", 30, None),
    ("dict-pool-006", "006", "AUTHORED", "编辑撰写", 40, None),
    ("dict-pool-007", "007", "CLOUD_IDLE", "空闲", 10, None),
    ("dict-pool-008", "008", "CLOUD_PENDING", "待同步", 20, None),
    (
        "dict-pool-009",
        "009",
        "CLOUD_RUNNING",
        "索引中",
        30,
        Some(r#"{"tone":"amber"}"#),
    ),
    (
        "dict-pool-010",
        "010",
        "CLOUD_SUCCEEDED",
        "已上云",
        40,
        Some(r#"{"tone":"emerald"}"#),
    ),
    (
        "dict-pool-011",
        "011",
        "CLOUD_FAILED",
        "同步失败",
        50,
        Some(r#"{"tone":"destructive"}"#),
    ),
    ("dict-pool-012", "012", "SCOPE_USER", "个人", 10, None),
    ("dict-pool-013", "013", "SCOPE_TENANT", "租户", 20, None),
    ("dict-pool-014", "014", "RUN_PENDING", "等待", 10, None),
    ("dict-pool-015", "015", "RUN_RUNNING", "执行中", 20, None),
    ("dict-pool-016", "016", "RUN_SUCCEEDED", "成功", 30, None),
    ("dict-pool-017", "017", "RUN_FAILED", "失败", 40, None),
    ("dict-pool-018", "018", "TRIGGER_SCHEDULE", "按时", 10, None),
    ("dict-pool-019", "019", "TRIGGER_MANUAL", "手动", 20, None),
    ("dict-pool-020", "020", "TRIGGER_CATCHUP", "补跑", 30, None),
    ("dict-pool-021", "021", "OWNER_CLIENT", "本机", 10, None),
    ("dict-pool-022", "022", "OWNER_GOOSE", "Goose", 20, None),
    ("dict-pool-023", "023", "OWNER_CLOUD", "云端", 30, None),
    ("dict-pool-024", "024", "RUN_AS_USER", "用户", 10, None),
    ("dict-pool-025", "025", "RUN_AS_TENANT", "租户", 20, None),
    ("dict-pool-026", "026", "DRAFT_PENDING", "待确认", 10, None),
    ("dict-pool-027", "027", "DRAFT_SAVED", "已保存", 20, None),
    (
        "dict-pool-028",
        "028",
        "DRAFT_DISCARDED",
        "已丢弃",
        30,
        None,
    ),
    ("dict-pool-029", "029", "ACTIVE", "正常", 10, None),
    ("dict-pool-030", "030", "ARCHIVED", "已归档", 90, None),
];

/// (typeCode, value, sort, isDefault, label override)
const CLAIMS: &[(&str, &str, i32, bool, Option<&str>)] = &[
    ("knowledge_doc_status", "001", 10, true, None),
    ("knowledge_doc_status", "002", 20, false, None),
    ("knowledge_doc_status", "030", 90, false, None),
    ("knowledge_doc_source", "003", 10, true, None),
    ("knowledge_doc_source", "004", 20, false, None),
    ("knowledge_doc_source", "005", 30, false, None),
    ("knowledge_doc_source", "006", 40, false, None),
    ("knowledge_cloud_status", "007", 10, true, None),
    ("knowledge_cloud_status", "008", 20, false, None),
    ("knowledge_cloud_status", "009", 30, false, None),
    ("knowledge_cloud_status", "010", 40, false, None),
    ("knowledge_cloud_status", "011", 50, false, None),
    ("knowledge_base_scope", "012", 10, true, None),
    ("knowledge_base_scope", "013", 20, false, None),
    ("automation_run_status", "014", 10, true, None),
    ("automation_run_status", "015", 20, false, None),
    ("automation_run_status", "016", 30, false, None),
    ("automation_run_status", "017", 40, false, None),
    ("automation_trigger_kind", "018", 10, true, None),
    ("automation_trigger_kind", "019", 20, false, None),
    ("automation_trigger_kind", "020", 30, false, None),
    ("automation_owner", "021", 10, true, None),
    ("automation_owner", "022", 20, false, None),
    ("automation_owner", "023", 30, false, None),
    ("automation_run_as", "024", 10, true, None),
    ("automation_run_as", "025", 20, false, None),
    ("directive_draft_status", "026", 10, true, None),
    ("directive_draft_status", "027", 20, false, None),
    ("directive_draft_status", "028", 30, false, None),
    ("asset_status", "029", 10, true, None),
    ("asset_status", "030", 90, false, None),
    ("album_status", "029", 10, true, None),
    ("album_status", "030", 90, false, None),
];
