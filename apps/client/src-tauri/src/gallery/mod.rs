//! 图库的 app 侧能力：导入（真读盘 + 探测）与回收站。
//!
//! 这里只放**必须碰文件系统 / 需要 AppHandle** 的活；索引与策展全在
//! `cogito_core::gallery`，两边各管一段，互不越界。

pub mod dedupe;
pub mod fingerprint;
pub mod import;
pub mod trash;
