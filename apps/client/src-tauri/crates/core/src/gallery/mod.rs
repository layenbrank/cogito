//! 图库（gallery）：影子索引 + 筛片流水线。
//!
//! 数据全在侧表（`galleryAsset` / `galleryAlbumAsset` / `galleryKeyword` /
//! `gallerySmartAlbum` / `galleryRoot`），`asset` 只读不写 —— 详见 `migrations::gallery_schema`。

pub mod service;
pub mod types;

pub use service::Service;
pub use types::*;
