//! 定时任务 ticker：claim → 发事件 → 前端执行 → 前端回写。
//!
//! 与 `reminder::worker` 同款节奏（12 秒一轮），差别只在产出：
//! reminder 自己弹通知，这里只发 `automation:due` —— 真正的执行需要模型会话。

use std::time::Duration;

use chrono::Utc;
use cogito_core::automation::service::{DueRun, Service};
use cogito_database::Storage;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

const POLL_INTERVAL_SECS: u64 = 12;

/// 超过这么久还没回写结果，就当那次执行丢了（应用退出/会话中断），标失败免得永远「执行中」
const STALE_RUN_MS: i64 = 30 * 60 * 1000;

/// 前端收到后要跑的任务内容（不带整行实体，避免把内部字段铺给 UI）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DuePayload {
    runId: String,
    automationId: String,
    name: String,
    prompt: String,
    knowledgeBaseId: Option<String>,
    triggerKind: String,
}

impl DuePayload {
    fn of(due: &DueRun) -> Self {
        Self {
            runId: due.run.id.clone(),
            automationId: due.automation.id.clone(),
            name: due.automation.name.clone(),
            prompt: due.automation.prompt.clone(),
            knowledgeBaseId: due.automation.knowledgeBaseId.clone(),
            triggerKind: due.run.triggerKind.clone(),
        }
    }
}

/// 启动轮询。setup 里调用一次即可。
pub fn spawn_worker<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        // 启动先跑一轮：应用关机期间错过的任务在这里按「只补一次」补上
        tick_once(&app).await;
        loop {
            tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECS)).await;
            tick_once(&app).await;
        }
    });
}

async fn tick_once<R: Runtime>(app: &AppHandle<R>) {
    let Some(storage) = app.try_state::<Storage>() else {
        tracing::warn!("automation ticker: storage 未就绪");
        return;
    };
    let now = Utc::now().timestamp_millis();
    if let Err(error) = Service::toReapStale(storage.connection(), now, STALE_RUN_MS).await {
        tracing::warn!("automation ticker: 回收陈旧执行失败: {error}");
    }

    let claimed = match Service::toClaimDue(storage.connection(), now).await {
        Ok(claimed) => claimed,
        Err(error) => {
            tracing::warn!("automation ticker: 认领到期任务失败: {error}");
            return;
        }
    };
    for due in claimed {
        let payload = DuePayload::of(&due);
        let run_id = payload.runId.clone();
        if let Err(error) = app.emit("automation:due", payload) {
            tracing::warn!("automation ticker: 发事件失败（{run_id}）: {error}");
        }
    }
}
