//! `bridge:info`：前端拿桥地址、令牌**文件路径**与 `cogito-mcp` 路径，再注入给 ACP 会话。
//!
//! 令牌不在这里返回：渲染进程只传路径，`cogito-mcp` 自己读文件（见 `bridge::token`）。
//! 调用时带上 `sessionID` 即完成会话登记，桥侧据此校验 `x-cogito-session`。
use serde::Serialize;
use tauri::State;

use super::BridgeState;
use crate::system::sidecar_command::find_cogito_mcp_path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeInfoView {
    pub url: String,
    /// `<appLocalData>/bridge/token`：注入成 `COGITO_BRIDGE_TOKEN_FILE`
    pub token_file: String,
    /// 空串 = 没找到侧车（未 stage 或平台不支持），前端据此跳过注入
    pub mcp_path: String,
}

#[tauri::command(rename = "bridge:info")]
#[must_use]
pub fn bridge_info(state: State<'_, BridgeState>, session_id: Option<String>) -> BridgeInfoView {
    let info = state.info();
    if let Some(session_id) = session_id.as_deref() {
        state.register_session(session_id);
    }
    BridgeInfoView {
        url: info.url.clone(),
        token_file: info.token_file.clone(),
        mcp_path: find_cogito_mcp_path()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
    }
}

/// 子任务回填（S10）：渲染进程跑完 / 失败 / 被取消后调用。
///
/// 只认 board 里登记过的 `jobID`（未知 id 直接报错），摘要由 core 截到 2KB；
/// 幂等：同一任务重复回填只返回现状，终态不被覆盖。
#[tauri::command(rename = "agent:subagentResult")]
pub fn agent_subagent_result(
    report: cogito_core::tools::agents::Report,
) -> Result<cogito_core::tools::agents::Job, String> {
    cogito_core::tools::agents::shared().settle(report)
}
