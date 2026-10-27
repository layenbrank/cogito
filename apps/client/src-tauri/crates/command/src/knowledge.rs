//! 知识库 IPC：列表/新建、文档摘要、检索、staging 草稿的发布与丢弃。
//!
//! 语义都在 `cogito_core::knowledge::Service`；这里只做参数整形与错误透传。
use cogito_core::CommandResult;
use cogito_core::knowledge::{
    DocRef, DocSummary, Hit, PublishMode, Service, StagedDoc, StagedFile, WriteDocOutcome,
};
use cogito_database::Storage;
use cogito_database::entity::knowledge_base::Model as BaseModel;
use cogito_database::entity::knowledge_doc::Model as DocModel;
use tauri::State;

#[tauri::command(rename = "knowledge:listBases")]
pub async fn knowledge_list_bases(state: State<'_, Storage>) -> CommandResult<Vec<BaseModel>> {
    Service::toListBases(state.connection()).await
}

#[tauri::command(rename = "knowledge:createBase")]
pub async fn knowledge_create_base(
    state: State<'_, Storage>,
    name: String,
) -> CommandResult<BaseModel> {
    let root = Service::toResolveRoot(state.connection()).await?;
    Service::toCreateBase(state.connection(), &name, &root).await
}

/// 改库级选项；未给的参数保持原值。
#[tauri::command(rename = "knowledge:updateBase")]
pub async fn knowledge_update_base(
    state: State<'_, Storage>,
    baseId: String,
    autoUpdate: Option<bool>,
    autoExport: Option<bool>,
    citation: Option<bool>,
) -> CommandResult<BaseModel> {
    Service::toUpdateBase(
        state.connection(),
        &baseId,
        autoUpdate,
        autoExport,
        citation,
    )
    .await
}

#[tauri::command(rename = "knowledge:listDocs")]
pub async fn knowledge_list_docs(
    state: State<'_, Storage>,
    baseId: Option<String>,
) -> CommandResult<Vec<DocSummary>> {
    Service::toListDocSummaries(state.connection(), baseId.as_deref()).await
}

#[tauri::command(rename = "knowledge:search")]
pub async fn knowledge_search(
    state: State<'_, Storage>,
    query: String,
    baseId: Option<String>,
    topK: Option<u64>,
) -> CommandResult<Vec<Hit>> {
    Service::toSearch(
        state.connection(),
        &query,
        baseId.as_deref(),
        topK.unwrap_or(5) as usize,
    )
    .await
}

#[tauri::command(rename = "knowledge:listStaging")]
pub async fn knowledge_list_staging(
    state: State<'_, Storage>,
    baseId: Option<String>,
) -> CommandResult<Vec<StagedFile>> {
    Service::toListStaging(state.connection(), baseId.as_deref()).await
}

/// 发布：`mode` 取 `replace`（覆盖同名）或 `keepboth`（自动加后缀）。
#[tauri::command(rename = "knowledge:publish")]
pub async fn knowledge_publish(
    state: State<'_, Storage>,
    baseId: String,
    path: String,
    mode: String,
) -> CommandResult<DocModel> {
    let mode = if mode.eq_ignore_ascii_case("replace") {
        PublishMode::Replace
    } else {
        PublishMode::KeepBoth
    };
    Service::toPublish(state.connection(), &baseId, &path, mode, "agent").await
}

/// 合并分章：确定性拼接，结果仍留在 staging（发布仍要用户确认）。
#[tauri::command(rename = "knowledge:mergeStaging")]
pub async fn knowledge_merge_staging(
    state: State<'_, Storage>,
    baseId: String,
    paths: Vec<String>,
    title: String,
) -> CommandResult<StagedDoc> {
    Service::toMergeStaging(state.connection(), &baseId, &paths, &title).await
}

#[tauri::command(rename = "knowledge:discardStaging")]
pub async fn knowledge_discard_staging(
    state: State<'_, Storage>,
    path: String,
) -> CommandResult<bool> {
    Service::toDiscardStaging(state.connection(), &path).await
}

#[tauri::command(rename = "knowledge:rescan")]
pub async fn knowledge_rescan(state: State<'_, Storage>, baseId: String) -> CommandResult<usize> {
    Service::toRescanBase(state.connection(), &baseId).await
}

#[tauri::command(rename = "knowledge:removeDoc")]
pub async fn knowledge_remove_doc(state: State<'_, Storage>, id: String) -> CommandResult<u64> {
    Service::toRemoveDoc(state.connection(), &id).await
}

/// 打开文档时取引用（带库内 hash），保存时用于判断期间是否被别处改过。
#[tauri::command(rename = "knowledge:resolveDoc")]
pub async fn knowledge_resolve_doc(
    state: State<'_, Storage>,
    path: String,
) -> CommandResult<DocRef> {
    Service::toResolveDoc(state.connection(), &path).await
}

/// 编辑器保存：写正式文件 + 落库；`expectedHash` 不一致且未 `force` 时只返回冲突、不写盘。
#[tauri::command(rename = "knowledge:writeDoc")]
pub async fn knowledge_write_doc(
    state: State<'_, Storage>,
    path: String,
    content: String,
    expectedHash: Option<String>,
    force: Option<bool>,
) -> CommandResult<WriteDocOutcome> {
    Service::toWriteDoc(
        state.connection(),
        &path,
        &content,
        expectedHash.as_deref(),
        force.unwrap_or(false),
    )
    .await
}
