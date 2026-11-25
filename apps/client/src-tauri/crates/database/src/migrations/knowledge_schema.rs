//! `knowledge_space` 改名的一次性跟进（表 / 列 / 索引）。
//!
//! 基线 `0001` 已把 `knowledge_base` → `knowledge_space`、`baseID` → `spaceID`，
//! 但老库已有 `migrations` 标记，基线不会重跑；这里按 `sqlite_master` / `pragma_table_info`
//! 判定后做**一次数据保留式** `ALTER`（幂等，跑过即跳过）。
//!
//! 约束：只做改名，不做结构变更；新增表 / 新增列仍只改 `0001` 基线 + 启动兜底补建。

/// 表改名：`(旧名, 新名)`
const TABLE_RENAMES: [(&str, &str); 1] = [("knowledge_base", "knowledge_space")];

/// 列改名：`(表, 旧列, 新列)`
const COLUMN_RENAMES: [(&str, &str, &str); 3] = [
    ("knowledge_doc", "baseID", "spaceID"),
    ("knowledge_index_state", "baseID", "spaceID"),
    ("automation", "knowledgeBaseID", "knowledgeSpaceID"),
];

/// 索引改名：`(旧索引, 表, 新索引, 列定义)`；SQLite 没有 `ALTER INDEX`，老库靠删旧建新
const INDEX_RENAMES: [(&str, &str, &str, &str); 3] = [
    (
        "idx_knowledge_doc_base_path",
        "knowledge_doc",
        "idx_knowledge_doc_space_path",
        r#""spaceID", "relPath""#,
    ),
    (
        "idx_knowledge_doc_base_updated",
        "knowledge_doc",
        "idx_knowledge_doc_space_updated",
        r#""spaceID", "updatedAt""#,
    ),
    (
        "idx_knowledge_base_slug",
        "knowledge_space",
        "idx_knowledge_space_slug",
        "slug",
    ),
];

pub fn table_renames() -> &'static [(&'static str, &'static str)] {
    &TABLE_RENAMES
}

pub fn column_renames() -> &'static [(&'static str, &'static str, &'static str)] {
    &COLUMN_RENAMES
}

pub fn index_renames() -> &'static [(&'static str, &'static str, &'static str, &'static str)] {
    &INDEX_RENAMES
}
