//! 图库（gallery）领域模型：catalog 行、详情、策展 patch、facet 计数。
//!
//! 命名约定见仓库 AGENTS.md：缩略语全大写（`assetID` / `albumID` / `stackID`）。

use serde::{Deserialize, Serialize};

/// catalog 的版本号：前端解码时校验，避免 Rust/前端字段漂移后悄悄读错。
pub const CATALOG_SCHEMA_VER: i64 = 1;

/// catalog 行：只放「网格 + 侧栏 + 状态栏」需要的字段。
///
/// 刻意不带 `searchText` 与 EXIF —— 前者由 `gallery:search` 在 SQL 侧用，
/// 后者走 `gallery:details` 按需取。10 万行量级下这个字段集是唯一能让单次 IPC 站得住的选择。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRow {
    pub id: String,
    /// `image` | `video` | `other`
    pub kind: String,
    pub name: String,
    pub path: String,
    pub mime: String,
    /// 排序与分组用；缺拍摄时间时回落 asset.createdAt
    pub captured_at: i64,
    /// `exif` | `filename` | `mtime` | `import` | `capture`
    pub date_source: Option<String>,
    pub rating: i64,
    pub flag: Option<String>,
    pub label: Option<String>,
    pub size: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    #[serde(rename = "stackID")]
    pub stack_id: Option<String>,
    #[serde(rename = "dupGroup")]
    pub dup_group: Option<String>,
    pub missing: bool,
    pub hidden: bool,
    #[serde(rename = "albumIDs")]
    pub album_ids: Vec<String>,
    /// 关键词：筛选条 chip 与 facet 计数都要用（不再单独走详情/IPC）
    #[serde(default)]
    pub keywords: Vec<KeywordEntry>,
    /// `import` | `capture`
    pub source: Option<String>,
    /// `screenshot` | `recording`（仅 source=capture）
    pub capture_kind: Option<String>,
    /// 截图/录屏由 capture 托管，批量重命名必须拒绝
    pub is_managed: bool,
    /// capture 的保留标记
    pub keep: bool,
    pub mtime_ms: Option<i64>,
    /// false = 还没 probe 过（老库回填后、或 capture 新写入的行）
    pub probed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPayload {
    pub schema_ver: i64,
    pub total: usize,
    /// 已 probe 的行数：前端据此提示「首次探测中」
    pub probed_count: usize,
    pub rows: Vec<CatalogRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeywordEntry {
    /// `people` | `places` | `themes`
    pub facet: String,
    pub value: String,
}

/// 详情：检查器与灯箱用，按需加载（不进 catalog）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryDetails {
    pub id: String,
    pub keywords: Vec<KeywordEntry>,
    #[serde(rename = "albumIDs")]
    pub album_ids: Vec<String>,
    pub content_hash: Option<String>,
    pub mtime_ms: Option<i64>,
    pub size_bytes: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub captured_at: Option<i64>,
    pub date_source: Option<String>,
    /// 原样透传 `asset.metadata` 里的 `exif` / `gps` 子对象
    pub exif: Option<serde_json::Value>,
    pub gps: Option<serde_json::Value>,
}

/// 一次策展写入的 patch。
///
/// 三层 Option 的语义：外层 `None` = 不改；`Some(None)` = 清空；`Some(Some(v))` = 设值。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CuratePatch {
    pub rating: Option<i64>,
    pub flag: Option<Option<String>>,
    pub label: Option<Option<String>>,
    pub hidden: Option<bool>,
    /// capture 的「保留」标记（仍在 metadata JSON 里，这里给图库一个统一入口）
    pub keep: Option<bool>,
    /// 关键词全量替换（按 asset 维度）；空数组 = 清空
    pub keywords: Option<Vec<KeywordEntry>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurateArgs {
    pub ids: Vec<String>,
    #[serde(default)]
    pub patch: CuratePatch,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumLinkArgs {
    pub ids: Vec<String>,
    #[serde(rename = "albumID")]
    pub album_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartAlbumInput {
    pub id: Option<String>,
    pub name: String,
    pub query: String,
    #[serde(default)]
    pub index: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartAlbumRow {
    pub id: String,
    pub name: String,
    pub query: String,
    pub index: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootRow {
    pub id: String,
    pub path: String,
    pub added_at: i64,
    pub last_scan_at: Option<i64>,
    pub is_watching: bool,
}

/// 导入/探测后写回一行的入参（Rust 导入管线与前端补探测共用）。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub captured_at: Option<i64>,
    pub date_source: Option<String>,
    pub size_bytes: Option<i64>,
    pub mtime_ms: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub stack_id: Option<String>,
    #[serde(default)]
    pub keywords: Vec<KeywordEntry>,
    /// 预先算好的检索文本（导入侧本来就知道文件名，没必要再查一次库现算）
    #[serde(default)]
    pub search_text: Option<String>,
}

/// 派生指纹：内容哈希（字节级去重）、分组键、感知哈希、位置失效标记。
///
/// 全部是**可重算的派生物** —— 删了重建即可，不进备份口径。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivedPatch {
    #[serde(default)]
    pub content_hash: Option<String>,
    #[serde(default)]
    pub dup_group: Option<String>,
    #[serde(default)]
    pub phash: Option<String>,
    #[serde(default)]
    pub missing: Option<bool>,
}
