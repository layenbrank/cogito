//! 状态字典 IPC：按 type 拉取、改 label（禁止改 value）。
#![allow(non_snake_case)]

use cogito_core::CommandResult;
use cogito_core::dict::{
    DictItemView, DictTypeView, RemoteCatalog, Service, UpdateItemInput,
};
use cogito_database::Storage;
use tauri::State;

#[tauri::command(rename = "dict:list")]
pub async fn dict_list(
    state: State<'_, Storage>,
    typeCode: String,
    tenantId: Option<String>,
) -> CommandResult<Vec<DictItemView>> {
    Service::findItems(
        state.connection(),
        &typeCode,
        tenantId.as_deref(),
    )
    .await
}

#[tauri::command(rename = "dict:listByTypes")]
pub async fn dict_list_by_types(
    state: State<'_, Storage>,
    typeCodes: Vec<String>,
    tenantId: Option<String>,
) -> CommandResult<Vec<DictTypeView>> {
    Service::findItemsMany(
        state.connection(),
        &typeCodes,
        tenantId.as_deref(),
    )
    .await
}

#[tauri::command(rename = "dict:updateItem")]
pub async fn dict_update_item(
    state: State<'_, Storage>,
    input: UpdateItemInput,
) -> CommandResult<DictItemView> {
    Service::toUpdateItem(state.connection(), input).await
}

#[tauri::command(rename = "dict:findValue")]
pub async fn dict_find_value(
    state: State<'_, Storage>,
    typeCode: String,
    key: String,
) -> CommandResult<Option<String>> {
    Service::findValue(state.connection(), &typeCode, &key).await
}

#[tauri::command(rename = "dict:mergeRemote")]
pub async fn dict_merge_remote(
    state: State<'_, Storage>,
    catalog: RemoteCatalog,
) -> CommandResult<()> {
    Service::mergeRemoteCatalog(state.connection(), catalog).await
}
