use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// 图库侧表：策展（评级 / 拒绝 / 颜色 / 关键词）+ 探测（时间 / 尺寸 / 时长 / 哈希 / 成组）结果。
///
/// 为什么是侧表而不是给 `asset` 加列：见 `migrations::gallery_schema` 的文件头注释。
/// 一行只对「进了图库的 asset」存在；出库（删 asset 行）时由 FK 级联 + 启动孤儿清扫兜底。
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "galleryAsset")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_name = "assetID")]
    #[serde(rename = "assetID")]
    pub asset_id: String,

    /// 0 = 未评；1–5 星
    pub rating: i64,
    /// `rejected` | `picked`；NULL = 未标记
    pub flag: Option<String>,
    /// `red` | `yellow` | `green` | `blue` | `purple`；NULL = 无颜色
    pub label: Option<String>,

    #[sea_orm(column_name = "capturedAt")]
    pub captured_at: Option<i64>,
    /// `exif` | `filename` | `mtime` | `import` | `capture`
    #[sea_orm(column_name = "dateSource")]
    pub date_source: Option<String>,

    #[sea_orm(column_name = "sizeBytes")]
    pub size_bytes: Option<i64>,
    /// 源文件 mtime（三元组去重的第二、三环；也用作缩略图缓存键）
    #[sea_orm(column_name = "mtimeMs")]
    pub mtime_ms: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    #[sea_orm(column_name = "durationMs")]
    pub duration_ms: Option<i64>,

    /// 成组键：RAW+JPEG / Live Photo / Motion Photo 同组共用一个值
    #[sea_orm(column_name = "stackID")]
    pub stack_id: Option<String>,
    /// 字节级重复分组键
    #[sea_orm(column_name = "dupGroup")]
    pub dup_group: Option<String>,
    /// BLAKE3（十六进制）。不放 `asset.hash`：那张表会被 `asset:update` 全量覆盖
    #[sea_orm(column_name = "contentHash")]
    pub content_hash: Option<String>,
    /// 感知哈希（aHash 64bit 十六进制）：相似图检索用，纯派生物
    pub phash: Option<String>,

    /// 源文件位置失效（移动盘拔掉 / 文件被挪走）；1 = 失效，不删行
    pub missing: i64,
    /// PIN 隐藏库
    pub hidden: i64,

    /// 小写文件名 + 全拼 + 首字母 + 关键词，供 SQL `LIKE` 检索
    #[sea_orm(column_name = "searchText")]
    pub search_text: Option<String>,
    /// 探测完成时间；NULL = 待探测（老库回填后全部置空）
    #[sea_orm(column_name = "probedAt")]
    pub probed_at: Option<i64>,
    /// 语义向量写入时间；NULL = 未索引
    #[sea_orm(column_name = "embeddedAt")]
    pub embedded_at: Option<i64>,
    /// 产出向量的模型 id（换模型要重建索引）
    #[sea_orm(column_name = "embedModel")]
    pub embed_model: Option<String>,

    #[sea_orm(column_name = "createdAt")]
    pub created_at: i64,
    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::asset::Entity",
        from = "Column::AssetId",
        to = "super::asset::Column::Id",
        on_delete = "Cascade",
        on_update = "Cascade"
    )]
    Asset,
}

impl Related<super::asset::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Asset.def()
    }
}
