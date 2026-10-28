//! 状态字典 IPC：按 type 拉取、改 label（禁止改 value）。
#![allow(non_snake_case)]

use cogito_core::CommandResult;
use cogito_core::dict::{DictItemView, DictTypeView, Service, UpdateItemInput};
use cogito_database::Storage;
use tauri::State;

#[tauri::command(rename = "dict:list")]
pub async fn dict_list(
    state: State<'_, Storage>,
    typeCode: String,
) -> CommandResult<Vec<DictItemView>> {
    Service::findItems(state.connection(), &typeCode).await
}

#[tauri::command(rename = "dict:listByTypes")]
pub async fn dict_list_by_types(
    state: State<'_, Storage>,
    typeCodes: Vec<String>,
) -> CommandResult<Vec<DictTypeView>> {
    Service::findItemsMany(state.connection(), &typeCodes).await
}

#[tauri::command(rename = "dict:updateItem")]
pub async fn dict_update_item(
    state: State<'_, Storage>,
    input: UpdateItemInput,
) -> CommandResult<DictItemView> {
    Service::toUpdateItem(state.connection(), input).await
}
