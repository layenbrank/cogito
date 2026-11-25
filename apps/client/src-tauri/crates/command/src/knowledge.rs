//! 知识库 IPC：列表/新建、文档摘要、检索、staging 草稿的发布与丢弃。
//!
//! 语义都在 `cogito_core::knowledge::Service`；这里只做参数整形与错误透传。
#![allow(non_snake_case)]
use cogito_core::knowledge::{
    CloudDoc, CloudPatch, CloudState, DocRef, DocSummary, Hit, MigrationReport, PublishMode,
    Service, StagedDoc, StagedFile, WikiContract, WriteDocOutcome,
};
use cogito_core::{CommandResult, Exception};
use cogito_database::Storage;
use cogito_database::entity::knowledge_space::Model as SpaceModel;
use tauri::{AppHandle, Manager, State};

#[tauri::command(rename = "knowledge:listSpaces")]
pub async fn knowledge_list_spaces(state: State<'_, Storage>) -> CommandResult<Vec<SpaceModel>> {
    Service::toListSpaces(state.connection()).await
}

#[tauri::command(rename = "knowledge:createSpace")]
pub async fn knowledge_create_space(
    app: AppHandle,
    state: State<'_, Storage>,
    name: String,
) -> CommandResult<SpaceModel> {
    let app_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| Exception::Validation(format!("获取应用数据目录失败: {error}")))?;
    let root = Service::toResolveRoot(&app_dir.join("knowledge"))?;
    Service::toCreateSpace(state.connection(), &name, &root).await
}

/// 改库级选项；未给的参数保持原值。
#[tauri::command(rename = "knowledge:updateSpace")]
pub async fn knowledge_update_space(
    state: State<'_, Storage>,
    spaceId: String,
    autoUpdate: Option<bool>,
    autoExport: Option<bool>,
    citation: Option<bool>,
) -> CommandResult<SpaceModel> {
    Service::toUpdateSpace(
        state.connection(),
        &spaceId,
        autoUpdate,
        autoExport,
        citation,
    )
    .await
}

#[tauri::command(rename = "knowledge:listDocs")]
pub async fn knowledge_list_docs(
    state: State<'_, Storage>,
    spaceId: Option<String>,
) -> CommandResult<Vec<DocSummary>> {
    Service::toListDocSummaries(state.connection(), spaceId.as_deref()).await
}

/// 已建好云端索引的文档（docID ↔ 云端 assetID）：云端召回要用它对回去重。
#[tauri::command(rename = "knowledge:cloudDocs")]
pub async fn knowledge_cloud_docs(
    state: State<'_, Storage>,
    spaceId: Option<String>,
) -> CommandResult<Vec<CloudDoc>> {
    Service::toListCloudDocs(state.connection(), spaceId.as_deref()).await
}

/// 云端索引状态列表（界面画角标、决定该不该重传）。
#[tauri::command(rename = "knowledge:cloudStates")]
pub async fn knowledge_cloud_states(
    state: State<'_, Storage>,
    spaceId: Option<String>,
) -> CommandResult<Vec<CloudState>> {
    Service::toListCloudStates(state.connection(), spaceId.as_deref()).await
}

/// 回写一篇文档的云端索引状态。`indexedAt` / `error` 不传即清空（上一次尝试的痕迹）。
#[tauri::command(rename = "knowledge:cloudState")]
pub async fn knowledge_set_cloud_state(
    state: State<'_, Storage>,
    docId: String,
    status: String,
    assetId: Option<String>,
    indexedAt: Option<i64>,
    error: Option<String>,
) -> CommandResult<CloudState> {
    Service::toSetCloudState(
        state.connection(),
        &docId,
        CloudPatch {
            status,
            asset_id: assetId,
            indexed_at: indexedAt,
            error,
        },
    )
    .await
}

#[tauri::command(rename = "knowledge:search")]
pub async fn knowledge_search(
    state: State<'_, Storage>,
    query: String,
    spaceId: Option<String>,
    topK: Option<u64>,
) -> CommandResult<Vec<Hit>> {
    Service::toSearch(
        state.connection(),
        &query,
        spaceId.as_deref(),
        topK.unwrap_or(5) as usize,
    )
    .await
}

#[tauri::command(rename = "knowledge:listStaging")]
pub async fn knowledge_list_staging(
    state: State<'_, Storage>,
    spaceId: Option<String>,
) -> CommandResult<Vec<StagedFile>> {
    Service::toListStaging(state.connection(), spaceId.as_deref()).await
}

/// 发布：`mode` 取 `replace`（同名页 = 更新该页）或 `keepboth`（自动加后缀）。
#[tauri::command(rename = "knowledge:publish")]
pub async fn knowledge_publish(
    state: State<'_, Storage>,
    spaceId: String,
    path: String,
    mode: String,
) -> CommandResult<DocSummary> {
    let doc = Service::toPublish(state.connection(), &spaceId, &path, parse_mode(&mode), "agent")
        .await?;
    Service::to_summaries(vec![doc])
        .pop()
        .ok_or_else(|| Exception::Internal("发布结果缺失".to_string()))
}

/// 批量发布：多章各自成页，索引只重建一次。
#[tauri::command(rename = "knowledge:publishMany")]
pub async fn knowledge_publish_many(
    state: State<'_, Storage>,
    spaceId: String,
    paths: Vec<String>,
    mode: String,
) -> CommandResult<Vec<DocSummary>> {
    let docs = Service::toPublishBatch(
        state.connection(),
        &spaceId,
        &paths,
        parse_mode(&mode),
        "agent",
    )
    .await?;
    Ok(Service::to_summaries(docs))
}

/// 存量归位：库根 / 错目录的页面挪进 `wiki/<type>/`。`dryRun` 默认 true（只出报告）。
#[tauri::command(rename = "knowledge:migrateLayout")]
pub async fn knowledge_migrate_layout(
    state: State<'_, Storage>,
    spaceId: String,
    dryRun: Option<bool>,
) -> CommandResult<MigrationReport> {
    Service::toMigrateLayout(state.connection(), &spaceId, dryRun.unwrap_or(true)).await
}

/// 按库内文档整份重建 `wiki/index.md`。
#[tauri::command(rename = "knowledge:rebuildIndex")]
pub async fn knowledge_rebuild_index(
    state: State<'_, Storage>,
    spaceId: String,
) -> CommandResult<usize> {
    Service::toRebuildIndex(state.connection(), &spaceId).await
}

/// wiki 规范契约（类型 → 目录、必填 frontmatter）：前端不要自己再维护一份。
#[tauri::command(rename = "knowledge:wikiContract")]
pub fn knowledge_wiki_contract() -> WikiContract {
    cogito_core::knowledge::contract()
}

fn parse_mode(mode: &str) -> PublishMode {
    if mode.eq_ignore_ascii_case("keepboth") {
        PublishMode::KeepBoth
    } else {
        PublishMode::Replace
    }
}

/// 合并分章：确定性拼接，结果仍留在 staging（发布仍要用户确认）。
#[tauri::command(rename = "knowledge:mergeStaging")]
pub async fn knowledge_merge_staging(
    state: State<'_, Storage>,
    spaceId: String,
    paths: Vec<String>,
    title: String,
) -> CommandResult<StagedDoc> {
    Service::toMergeStaging(state.connection(), &spaceId, &paths, &title).await
}

#[tauri::command(rename = "knowledge:discardStaging")]
pub async fn knowledge_discard_staging(
    state: State<'_, Storage>,
    path: String,
) -> CommandResult<bool> {
    Service::toDiscardStaging(state.connection(), &path).await
}

#[tauri::command(rename = "knowledge:rescan")]
pub async fn knowledge_rescan(state: State<'_, Storage>, spaceId: String) -> CommandResult<usize> {
    Service::toRescanSpace(state.connection(), &spaceId).await
}

#[tauri::command(rename = "knowledge:removeDoc")]
pub async fn knowledge_remove_doc(state: State<'_, Storage>, id: String) -> CommandResult<u64> {
    Service::toRemoveDoc(state.connection(), &id).await
}

/// 删除整个知识库。`purgeFiles` 缺省为 false：只删库记录，磁盘上的 Markdown 原样保留。
#[tauri::command(rename = "knowledge:removeSpace")]
pub async fn knowledge_remove_space(
    state: State<'_, Storage>,
    spaceId: String,
    purgeFiles: Option<bool>,
) -> CommandResult<u64> {
    Service::toRemoveKnowledge(state.connection(), &spaceId, purgeFiles.unwrap_or(false)).await
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

/// 整包导出：把一个库的 Markdown 打成 zip（写在 <库目录>/exports/ 下），返回路径
#[tauri::command(rename = "knowledge:exportBundle")]
pub async fn knowledge_export_bundle(
    state: State<'_, Storage>,
    spaceId: String,
) -> CommandResult<String> {
    let path = Service::toExportBundle(state.connection(), &spaceId).await?;
    Ok(path.to_string_lossy().into_owned())
}
