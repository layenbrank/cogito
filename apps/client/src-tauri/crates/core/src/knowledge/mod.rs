//! 知识库（Knowledge）域：space / 文档 / 检索 / staging 发布。
//!
//! 对外只暴露 `Service`（与其它域一致），检索命中类型与发布策略一并导出给工具面。
//! `wiki` 是规范化的唯一定义（type → 目录 / frontmatter / 标题）。
mod front_matter;
mod search;
mod service;
mod text;
mod wiki;
mod wiki_index;

pub use search::Hit;
pub use service::{
    CloudDoc, CloudPatch, CloudState, DocRef, DocSummary, MigrationReport, PageMove,
    PublishMode, Service, SkippedPage, StagedDoc, StagedFile, WriteDocOutcome,
};
pub use wiki::{
    AGGREGATE_PATHS, DEFAULT_TYPE, PageInput, RESERVED_TYPES, WIKI_TYPES, WikiContract,
    WikiContractType, WikiPage, WikiType, contract, find_wiki_type, is_aggregate_path,
    is_reserved_type, normalize, to_read_meta,
};
