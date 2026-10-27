//! 知识库（Knowledge）域：base / 文档 / 检索 / staging 发布。
//!
//! 对外只暴露 `Service`（与其它域一致），检索命中类型与发布策略一并导出给工具面。
mod search;
mod service;
mod text;

pub use search::Hit;
pub use service::{
    DocRef, DocSummary, PublishMode, Service, StagedDoc, StagedFile, WriteDocOutcome,
};
