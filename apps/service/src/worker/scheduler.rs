//! 定时任务 tick：认领到期任务 → 以 `runAs` 身份起一次 agent 任务 → 回写结果。
//!
//! 这是「关掉客户端也能跑」的那条路。三件事必须在同一处说清：
//! 1. **身份**：`runAsKind=user` 用创建人（或指定的本人）身份跑，进租户前会校验成员关系，
//!    不是成员就落 `failed` 而不是静默跳过——跳过会让人以为任务在跑；
//!    `runAsKind=tenant` 用服务主体（`SERVICE_ACTOR_ID`）。
//! 2. **失败可见**：起不来（编排未接通 / 权限没了）一律把原因写进 `lastError`。
//! 3. **不阻塞 tick**：起任务本身是毫秒级（`prepare` 落行 + `launch` 起实例），
//!    真正的执行在编排里，这里不等结果。

use std::sync::Arc;

use durable::Client;
use identity::TenantId;

use crate::configures::configure::Configure;
use crate::databases::database::Storage;
use crate::guards::service::SERVICE_ACTOR_ID;
use crate::guards::session::Session;
use crate::guards::tenant::TenantCtx;
use crate::services::agent::schema::TaskP;
use crate::services::agent::service::AgentService;
use crate::services::schedule::service::Service;
use crate::utils::jwt::Claims;

/// 跑一轮。返回本轮认领到多少个任务（0 表示没事可做）。
pub async fn tick(
    storage: &Storage,
    config: &Configure,
    durable: Option<&Arc<Client>>,
    now_ms: i64,
) -> usize {
    let claimed = match Service::claim_due(storage, now_ms).await {
        Ok(claimed) => claimed,
        Err(error) => {
            tracing::warn!(error = %error, "定时任务认领失败");
            return 0;
        }
    };

    for job in &claimed {
        let outcome = run_job(storage, config, durable, job).await;
        let (error, task_id) = match &outcome {
            Ok(task_id) => (None, Some(*task_id)),
            Err(message) => (Some(message.as_str()), None),
        };
        if let Err(write_error) = Service::finish(storage, job.id, error, task_id).await {
            tracing::warn!(job = %job.id, error = %write_error, "回写定时任务状态失败");
        }
        match outcome {
            Ok(task_id) => tracing::info!(job = %job.id, task = %task_id, "定时任务已起"),
            Err(message) => tracing::warn!(job = %job.id, error = %message, "定时任务失败"),
        }
    }
    claimed.len()
}

/// 以任务声明的身份起一次 agent 任务，返回任务 id。
async fn run_job(
    storage: &Storage,
    config: &Configure,
    durable: Option<&Arc<Client>>,
    job: &entity::scheduled_job::Model,
) -> Result<uuid::Uuid, String> {
    let actor = match job.run_as_kind.as_str() {
        "tenant" => SERVICE_ACTOR_ID,
        _ => job.run_as_user_id.unwrap_or(job.creator),
    };

    // 用「为这个用户合成一份已验签 claims」的既有入口建立会话：
    // 不走 HTTP，但没有第二个身份通道 —— `Session::resolve` 只认 sub。
    let claims = Claims {
        sub: actor.to_string(),
        username: String::new(),
        role: "USER".to_owned(),
        exp: chrono::Utc::now().timestamp() + 60,
        iat: chrono::Utc::now().timestamp(),
    };
    let session = Session::resolve(storage, &claims, "scheduler")
        .await
        .map_err(|error| format!("执行身份不可用：{error:?}"))?;

    let ctx = TenantCtx::enter(storage, &session, TenantId::from_uuid(job.tenant_id))
        .await
        .map_err(|error| format!("进入租户失败：{error}"))?;

    let task = TaskP {
        objective: job.prompt.clone(),
        max_steps: None,
        tools: None,
    };
    let prepared = match AgentService::prepare(&ctx, config, task).await {
        Ok(prepared) => prepared,
        Err(error) => return Err(format!("准备任务失败：{error}")),
    };
    // 台账先落定；起实例是网络调用，不许在事务里发
    ctx.commit()
        .await
        .map_err(|error| format!("提交台账失败：{error}"))?;

    let task_id = prepared.task_id;
    AgentService::launch(storage, durable, prepared)
        .await
        .map_err(|error| format!("起编排失败：{error}"))?;
    Ok(task_id)
}
