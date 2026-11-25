//! 图库（gallery）的 DDL 单源。
//!
//! 为什么单开侧表而不是给 `asset` 加列：`asset:update` 是**全量覆盖**语义
//! （`Change = Insert`），被 capture / clipboard / signboard 共用；给 `asset` 加十几列会让
//! 这些域全部进入「必须逐列原样回传新列」的脆弱状态，`contentHash` 这类列还会被陈旧实体
//! 覆盖成 NULL。图库的策展/探测数据放自己的侧表，爆炸半径就限制在图库内部。
//!
//! 与 `agent_plan_schema` 同一模式：同一份语句走两条路 ——
//! ① 基线 `migrations_0001::up()`（新库 / `migrate:fresh`）；
//! ② `migration::ensure_gallery()`（每次启动，`IF NOT EXISTS` 幂等兜底老库）。
//!
//! 列名规则（`migration::tests::entity_columns_match_ddl` 的 `assert_column_style` 会拦）：
//! camelCase、不含下划线、标识列写 `xxxID`。

/// 建表 + 索引语句（幂等）。顺序：先表后索引（索引依赖表）。
pub fn statements() -> Vec<&'static str> {
    vec![
        // ── 1:1 侧表：每个 asset 一行 ──
        r#"CREATE TABLE IF NOT EXISTS galleryAsset (
             "assetID" TEXT PRIMARY KEY NOT NULL,
             rating INTEGER NOT NULL DEFAULT 0,
             flag TEXT NULL,
             label TEXT NULL,
             "capturedAt" INTEGER NULL,
             "dateSource" TEXT NULL,
             "sizeBytes" INTEGER NULL,
             "mtimeMs" INTEGER NULL,
             width INTEGER NULL,
             height INTEGER NULL,
             "durationMs" INTEGER NULL,
             "stackID" TEXT NULL,
             "dupGroup" TEXT NULL,
             "contentHash" TEXT NULL,
             phash TEXT NULL,
             missing INTEGER NOT NULL DEFAULT 0,
             hidden INTEGER NOT NULL DEFAULT 0,
             "searchText" TEXT NULL,
             "probedAt" INTEGER NULL,
             "embeddedAt" INTEGER NULL,
             "embedModel" TEXT NULL,
             "createdAt" INTEGER NOT NULL,
             "updatedAt" INTEGER NOT NULL,
             CONSTRAINT fk_gallery_asset_asset FOREIGN KEY ("assetID")
                 REFERENCES asset (id) ON DELETE CASCADE ON UPDATE CASCADE)"#,
        r#"CREATE INDEX IF NOT EXISTS idx_galleryAsset_capturedAt ON galleryAsset ("capturedAt" DESC)"#,
        r#"CREATE INDEX IF NOT EXISTS idx_galleryAsset_rating ON galleryAsset (rating)"#,
        r#"CREATE INDEX IF NOT EXISTS idx_galleryAsset_stackID ON galleryAsset ("stackID")"#,
        r#"CREATE INDEX IF NOT EXISTS idx_galleryAsset_missing ON galleryAsset (missing)"#,
        r#"CREATE INDEX IF NOT EXISTS idx_galleryAsset_sizeBytes ON galleryAsset ("sizeBytes")"#,
        r#"CREATE INDEX IF NOT EXISTS idx_galleryAsset_contentHash ON galleryAsset ("contentHash")"#,
        r#"CREATE INDEX IF NOT EXISTS idx_galleryAsset_hidden ON galleryAsset (hidden)"#,
        r#"CREATE INDEX IF NOT EXISTS idx_galleryAsset_probedAt ON galleryAsset ("probedAt")"#,
        // ── 相簿归属（关系表，替代 metadata.albums 数组）──
        r#"CREATE TABLE IF NOT EXISTS galleryAlbumAsset (
             "assetID" TEXT NOT NULL,
             "albumID" TEXT NOT NULL,
             "addedAt" INTEGER NOT NULL,
             PRIMARY KEY ("assetID", "albumID"),
             CONSTRAINT fk_gallery_album_asset_asset FOREIGN KEY ("assetID")
                 REFERENCES asset (id) ON DELETE CASCADE ON UPDATE CASCADE,
             CONSTRAINT fk_gallery_album_asset_album FOREIGN KEY ("albumID")
                 REFERENCES album (id) ON DELETE CASCADE ON UPDATE CASCADE)"#,
        r#"CREATE INDEX IF NOT EXISTS idx_galleryAlbumAsset_albumID ON galleryAlbumAsset ("albumID")"#,
        // ── 关键词（人 / 地 / 题材 三分法）──
        r#"CREATE TABLE IF NOT EXISTS galleryKeyword (
             "assetID" TEXT NOT NULL,
             facet TEXT NOT NULL,
             value TEXT NOT NULL,
             PRIMARY KEY ("assetID", facet, value),
             CONSTRAINT fk_gallery_keyword_asset FOREIGN KEY ("assetID")
                 REFERENCES asset (id) ON DELETE CASCADE ON UPDATE CASCADE)"#,
        r#"CREATE INDEX IF NOT EXISTS idx_galleryKeyword_facet_value ON galleryKeyword (facet, value)"#,
        // ── 智能相簿：规则是纯数据，结果实时算 ──
        r#"CREATE TABLE IF NOT EXISTS gallerySmartAlbum (
             id TEXT PRIMARY KEY NOT NULL,
             name TEXT NOT NULL,
             query TEXT NOT NULL,
             "index" INTEGER NOT NULL DEFAULT 0,
             "createdAt" INTEGER NOT NULL,
             "updatedAt" INTEGER NOT NULL)"#,
        r#"CREATE INDEX IF NOT EXISTS idx_gallerySmartAlbum_index ON gallerySmartAlbum ("index")"#,
        // ── 库根目录（文件夹是真相；watcher 启动时读这张表）──
        r#"CREATE TABLE IF NOT EXISTS galleryRoot (
             id TEXT PRIMARY KEY NOT NULL,
             path TEXT NOT NULL,
             "addedAt" INTEGER NOT NULL,
             "lastScanAt" INTEGER NULL,
             "isWatching" INTEGER NOT NULL DEFAULT 1)"#,
        r#"CREATE UNIQUE INDEX IF NOT EXISTS idx_galleryRoot_path ON galleryRoot (path)"#,
    ]
}

/// 表名清单（`down()` 与启动清理共用；顺序即删除顺序，先依赖方后被依赖方）。
pub fn tables() -> Vec<&'static str> {
    vec![
        "galleryKeyword",
        "galleryAlbumAsset",
        "galleryAsset",
        "gallerySmartAlbum",
        "galleryRoot",
    ]
}

/// 老库补列（`CREATE IF NOT EXISTS` 不会改既有表结构）。
/// 调用方需先按 `pragma_table_info` 判断缺列再执行，避免重复 ADD 报错。
pub fn column_patches() -> Vec<(&'static str, &'static str)> {
    vec![("phash", "ALTER TABLE galleryAsset ADD COLUMN phash TEXT NULL")]
}
