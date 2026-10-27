//! `bridge:info`：前端拿桥地址/token 与 `cogito-mcp` 路径，再注入给 ACP 会话。
//!
//! token 只在本机侧车启动参数里出现，不进日志、不落盘。
use serde::Serialize;
use tauri::State;

use super::BridgeState;
use crate::system::sidecar_command::find_cogito_mcp_path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeInfoView {
    pub url: String,
    pub token: String,
    /// 空串 = 没找到侧车（未 stage 或平台不支持），前端据此跳过注入
    pub mcp_path: String,
}

#[tauri::command(rename = "bridge:info")]
#[must_use]
pub fn bridge_info(state: State<'_, BridgeState>) -> BridgeInfoView {
    let info = state.info();
    BridgeInfoView {
        url: info.url.clone(),
        token: info.token.clone(),
        mcp_path: find_cogito_mcp_path()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
    }
}
