//! 图库命令：`gallery:*`。
//!
//! 只做薄壳 —— 业务全在 `cogito_core::gallery::Service`，文件/解码类重活（导入、缩略图、
//! 回收站、目录监听）在 app 侧 `crate::gallery::*`，不混进来。

use cogito_core::CommandResult;
use cogito_core::gallery::{
    AlbumLinkArgs, CatalogPayload, CurateArgs, GalleryDetails, RootRow, Service, SmartAlbumInput,
    SmartAlbumRow,
};
use cogito_database::Storage;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::State;

/// 图库的一次性准备（老库回填 + 孤儿清扫）。
///
/// 放这里而不是 bootstrap：图库没被打开过就不该付出启动成本；
/// 进程内只跑一次，失败也不阻塞读（最坏情况是多一次重复回填尝试）。
static IS_GALLERY_READY: AtomicBool = AtomicBool::new(false);

#[tauri::command(rename = "gallery:catalog")]
pub async fn gallery_catalog(state: State<'_, Storage>) -> CommandResult<CatalogPayload> {
    let db = state.connection();
    if !IS_GALLERY_READY.swap(true, Ordering::SeqCst) {
        let _ = Service::toBackfill(db).await;
        let _ = Service::toCleanupOrphans(db).await;
    }
    Service::toReadCatalog(db).await
}

#[tauri::command(rename = "gallery:details")]
pub async fn gallery_details(
    state: State<'_, Storage>,
    ids: Vec<String>,
) -> CommandResult<Vec<GalleryDetails>> {
    Service::toReadDetails(state.connection(), ids).await
}

#[tauri::command(rename = "gallery:curate")]
pub async fn gallery_curate(
    state: State<'_, Storage>,
    args: CurateArgs,
) -> CommandResult<Vec<String>> {
    Service::toCurate(state.connection(), args).await
}

#[tauri::command(rename = "gallery:search")]
pub async fn gallery_search(
    state: State<'_, Storage>,
    text: String,
) -> CommandResult<Vec<String>> {
    Service::toSearch(state.connection(), &text).await
}

#[tauri::command(rename = "gallery:album-attach")]
pub async fn gallery_album_attach(
    state: State<'_, Storage>,
    args: AlbumLinkArgs,
) -> CommandResult<usize> {
    Service::toAttachAlbum(state.connection(), args).await
}

#[tauri::command(rename = "gallery:album-detach")]
pub async fn gallery_album_detach(
    state: State<'_, Storage>,
    args: AlbumLinkArgs,
) -> CommandResult<usize> {
    Service::toDetachAlbum(state.connection(), args).await
}

#[tauri::command(rename = "gallery:smart-albums-read")]
pub async fn gallery_smart_albums_read(
    state: State<'_, Storage>,
) -> CommandResult<Vec<SmartAlbumRow>> {
    Service::toReadSmartAlbums(state.connection()).await
}

#[tauri::command(rename = "gallery:smart-albums-save")]
pub async fn gallery_smart_albums_save(
    state: State<'_, Storage>,
    input: SmartAlbumInput,
) -> CommandResult<String> {
    Service::toSaveSmartAlbum(state.connection(), input).await
}

#[tauri::command(rename = "gallery:smart-albums-remove")]
pub async fn gallery_smart_albums_remove(
    state: State<'_, Storage>,
    id: String,
) -> CommandResult<bool> {
    Service::toRemoveSmartAlbum(state.connection(), id).await
}

#[tauri::command(rename = "gallery:roots-read")]
pub async fn gallery_roots_read(state: State<'_, Storage>) -> CommandResult<Vec<RootRow>> {
    Service::toReadRoots(state.connection()).await
}

#[tauri::command(rename = "gallery:roots-add")]
pub async fn gallery_roots_add(
    state: State<'_, Storage>,
    path: String,
) -> CommandResult<String> {
    Service::toAddRoot(state.connection(), &path).await
}

#[tauri::command(rename = "gallery:roots-remove")]
pub async fn gallery_roots_remove(state: State<'_, Storage>, id: String) -> CommandResult<bool> {
    Service::toRemoveRoot(state.connection(), id).await
}

#[tauri::command(rename = "gallery:mark-missing")]
pub async fn gallery_mark_missing(
    state: State<'_, Storage>,
    ids: Vec<String>,
    missing: bool,
) -> CommandResult<usize> {
    Service::toMarkMissing(state.connection(), ids, missing).await
}
