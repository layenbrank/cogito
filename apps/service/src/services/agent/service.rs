//! agent 任务的业务侧：起任务、查进度。
//!
//! **顺序铁律**：先把台账行落库并提交，再起编排实例。反过来（先起实例再写台账）一旦在两步
//! 之间崩溃，就会留下一份**看不见的工作**：编排在跑、花了配额、调了工具，但没有任何一行
//! 记录指向它，谁也查不到、谁也收不了尾。现在的顺序最坏留下「有台账、无实例」，而那一行是
//! 可见的，读路径按行龄就能把它收敛成失败。
//!
//! **谁写台账**：只有本进程（api）。orchestrator 侧零改动——它跑编排、调活动，结果由这里
//! 的等待者或读路径落到 `agent_task`。台账因此只有一个写者，`agent::persistence::finish`
//! 的行锁只用来兜「同一进程内的并发收尾」。
//!
//! **外部调用不跨作用域**：`durable` 的 `start`/`status` 都是网络调用，调用前必须把数据库
//! 事务落定（写路径 `commit`、读路径 `rollback`），否则连接与行锁会被一路占住。

use std::sync::Arc;

use chrono::{DateTime, TimeDelta, Utc};
use durable::{Client, InstanceStatus};
use entity::agent_task;
use identity::TenantId;
use uuid::Uuid;

use authz::{Action, Permission, Resource};

use crate::configures::configure::Configure;
use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::tenant::TenantCtx;
use crate::orchestrations::agent::{
    AGENT_RUN, APPROVAL_QUEUE, AgentRunInput, ApprovalDecisionEvent, ApprovalState,
    pending_approval, steps_from_progress,
};
use crate::services::agent::dispatch;
use crate::services::agent::error::AgentError;
use crate::services::agent::schema::{ApprovalP, ApprovalR, TaskP, TaskR};
use crate::utils::telemetry::current_traceparent;

/// 起任务：租户内任何有效成员都可以（含 MEMBER）。
///
/// 与读分开一个权限，是为了将来把「谁能烧配额」收紧成 ADMIN 而不动读路径。
const WRITE_AGENT_TASK: Permission = Permission::new(Resource::AgentTask, Action::Write);
const READ_AGENT_TASK: Permission = Permission::new(Resource::AgentTask, Action::Read);

/// 任务目标长度上限（字符数）。
///
/// 目标进模型上下文、也整段落台账，所以这里挡的是「误把一整篇文档粘进来」这类调用，
/// 不是业务规则——真实的长输入应该走 `asset_read` 之类的工具，而不是塞进目标里。
const MAX_OBJECTIVE_CHARS: usize = 4000;

/// 台账显示 `RUNNING` 但编排里查不到这个实例时，容忍多久才判定它真的丢了。
///
/// 存在的意义是别把「实例还没被运行时领走」误判成失败：`start` 成功后实例马上就有记录，
/// 但库被重建、编排 schema 被清空这类事故也会让状态变成 `NotFound`，此时只有行龄能区分
/// 「刚起」和「早就没了」。
pub const INSTANCE_ABSENT_GRACE: TimeDelta = TimeDelta::seconds(300);

/// 编排运行时的两种起不来：配置层面没接通、以及接通了但这次启动失败。原因落台账与日志。
const RUNTIME_OFFLINE: &str = "编排运行时未接通（durable 未配置或连接失败）";
const RUNTIME_START_FAILED: &str = "编排实例启动失败";

/// 起任务前已定死的一切：台账行 + 编排输入。
///
/// 分两段是因为中间必须有一次事务提交：`prepare` 在请求事务里建行，`launch` 在提交之后
/// 才发网络调用。
pub struct Prepared {
    pub task_id: Uuid,
    pub tenant_id: TenantId,
    pub instance_id: String,
    pub row: agent_task::Model,
    pub input: AgentRunInput,
}

pub struct AgentService;

impl AgentService {
    /// 校验入参、建台账行（不提交、不起实例）。
    ///
    /// # Errors
    /// 权限不足 403；目标为空或超长 422；轮次上限越界 422；工具不在白名单 422；库错 500。
    pub async fn prepare(
        ctx: &TenantCtx,
        config: &Configure,
        req: TaskP,
    ) -> Result<Prepared, Exception> {
        ctx.require(WRITE_AGENT_TASK)?;

        let objective = req.objective.trim().to_owned();
        if objective.is_empty() {
            return Err(AgentError::ObjectiveInvalid("任务目标不能为空".into()).into());
        }
        if objective.chars().count() > MAX_OBJECTIVE_CHARS {
            return Err(AgentError::ObjectiveInvalid(format!(
                "任务目标不能超过 {MAX_OBJECTIVE_CHARS} 个字符"
            ))
            .into());
        }

        let max_steps = requested_steps(config.agent.max_steps, req.max_steps)?;
        let allowed_tools = requested_tools(&config.agent.allowed_tools, req.tools.as_deref())?;

        let task_id = Uuid::new_v4();
        let tenant_id = ctx.tenant_id();
        let user_id = ctx.principal().user_id().as_uuid();
        let instance_id = format!("agent-{task_id}");

        let row = agent::persistence::create(
            ctx.tx(),
            &agent::NewTask {
                id: task_id,
                tenant_id: tenant_id.as_uuid(),
                user_id: Some(user_id),
                objective: objective.clone(),
                model: config.agent.chat_model.clone(),
                max_steps,
                allowed_tools: allowed_tools.clone(),
                instance_id: instance_id.clone(),
            },
        )
        .await
        .map_err(AgentError::from)?;

        let input = AgentRunInput {
            task_id: task_id.to_string(),
            tenant_id: tenant_id.as_uuid().to_string(),
            user_id: Some(user_id.to_string()),
            objective,
            model: config.agent.chat_model.clone(),
            embed_model: config.compute.embed_model.clone(),
            max_steps,
            allowed_tools,
            approval_ttl_secs: config.agent.approval_ttl_secs,
            traceparent: current_traceparent(),
        };

        Ok(Prepared {
            task_id,
            tenant_id,
            instance_id,
            row,
            input,
        })
    }

    /// 起编排实例并把等待者挂上。**必须在 `prepare` 的事务提交之后调用。**
    ///
    /// 起不来时把那一行落成失败再返回 503：任务确实没跑，台账必须如实说，不能让调用方隔一会儿
    /// 回来查到一条永远 `RUNNING` 的记录。
    ///
    /// # Errors
    /// 编排不可用 503（配置未接通或起实例失败）；此时台账那一行会被落成失败。
    pub async fn launch(
        storage: &Storage,
        client: Option<&Arc<Client>>,
        prepared: Prepared,
    ) -> Result<TaskR, Exception> {
        let Some(client) = client else {
            return Err(ledger_unavailable(
                storage,
                &prepared,
                RUNTIME_OFFLINE,
                "编排运行时未接通（durable 未配置或连接不可用）",
            )
            .await);
        };

        if let Err(err) = client
            .start(&prepared.instance_id, AGENT_RUN, &prepared.input)
            .await
        {
            return Err(ledger_unavailable(
                storage,
                &prepared,
                RUNTIME_START_FAILED,
                &format!("编排实例启动失败：{err}"),
            )
            .await);
        }

        let rendered = render(&prepared.row, None);
        dispatch::spawn_waiter(storage.clone(), Arc::clone(client), prepared.row);
        Ok(rendered)
    }

    /// 查任务：先读台账，只有还在跑时才去问编排当前进度。
    ///
    /// 终态的行**不再问编排**：台账是权威记录，编排实例的存活与否不影响「这个任务已经结束了」。
    ///
    /// # Errors
    /// 权限不足 403；id 不是 UUID 或租户内查不到 404；库错 500。
    pub async fn read(
        storage: &Storage,
        ctx: TenantCtx,
        client: Option<&Arc<Client>>,
        id: &str,
    ) -> Result<TaskR, Exception> {
        ctx.require(READ_AGENT_TASK)?;

        // 非法 id 与「不是我的 id」回同一个 404：分开会让调用方能拿它探测别的租户。
        let task_id = Uuid::parse_str(id).map_err(|_| AgentError::NotFound)?;
        let row = agent::persistence::find(ctx.tx(), task_id)
            .await
            .map_err(AgentError::from)?;
        let tenant_id = ctx.tenant_id();

        // 下面要发网络调用，先把只读事务还回去（回滚是空操作，但连接当场归还）。
        ctx.rollback().await?;

        let Some(row) = row else {
            return Err(AgentError::NotFound.into());
        };

        if agent::TaskState::parse(&row.status)
            .map_err(AgentError::from)?
            .is_terminal()
        {
            return Ok(render(&row, None));
        }

        let Some(client) = client else {
            // 编排运行时没接通不影响「查得到自己起过的任务」：台账本来就在，如实返回 RUNNING。
            return Ok(render(&row, None));
        };

        match client.status(&row.instance_id).await {
            Ok(InstanceStatus::Running { custom_status }) => {
                // 编排自报的是「走到第几轮」，台账列还没到终态、不值得为它写一次库。
                Ok(render(&row, custom_status.as_deref()))
            }
            Ok(InstanceStatus::NotFound) => settle_after_missing(storage, row, tenant_id).await,
            Ok(status) => {
                let outcome = dispatch::outcome_of(status, row.steps);
                let settled = dispatch::settle(storage, row.id, tenant_id, &outcome)
                    .await
                    .map_err(Exception::from)?;
                Ok(render(settled.as_ref().unwrap_or(&row), None))
            }
            Err(err) => {
                // 查不到状态不等于任务失败：把「台账原样」返回，等下一次查询或等待者收尾。
                tracing::warn!(error = %err, task = %row.id, "查询 agent 编排状态失败");
                Ok(render(&row, None))
            }
        }
    }

    /// 人对一次待审批的工具调用做决定：批准 = 放行执行，驳回 = 工具不执行。
    ///
    /// **顺序铁律**：先问编排「现在到底在等哪一次调用」，确认它报的审批标识就是路径里那一个，
    /// 再写台账、再投邮箱。反过来（先信路径、先写台账）的话，一个人手抖写错的 id 也会在册上
    /// 留下一条「有人批准过」，而编排从来没提过这次调用——台账从此不可信。
    ///
    /// 决定**不携带工具名与参数**：那些字段一律照抄编排报上来的那一份。让请求把工具与参数
    /// 再传一遍，就等于允许「批了 A、记成 B」。
    ///
    /// # Errors
    /// 权限不足 403；任务 id 非法或不在本租户 404；决定字面量非法 422；这次没有在等审批
    /// （id 对不上、已超时、任务已结束）409；已有相反决定 409；编排不可用 503。
    pub async fn decide(
        storage: &Storage,
        mut ctx: TenantCtx,
        client: Option<&Arc<Client>>,
        id: &str,
        approval_id: &str,
        req: ApprovalP,
    ) -> Result<ApprovalR, Exception> {
        ctx.require(WRITE_AGENT_TASK)?;

        let decision = human_decision(&req.decision)?;

        // 非法 id 与「不是我的 id」回同一个 404（理由同 `read`）。
        let task_id = Uuid::parse_str(id).map_err(|_| AgentError::NotFound)?;
        let row = agent::persistence::find(ctx.tx(), task_id)
            .await
            .map_err(AgentError::from)?;
        let decider = ctx.principal().user_id().as_uuid();

        let Some(row) = row else {
            return Err(AgentError::NotFound.into());
        };

        // 这一刻起要发网络调用（问编排在等什么、投决定），作用域不能跨着它持有：
        // `renew` 落定前一段、原地换一段新的，身份与权限仍是在 `enter` 时定下的那一份。
        ctx.renew(storage).await?;

        let Some(client) = client else {
            return Err(AgentError::OrchestrationUnavailable(
                "编排运行时未接通，问不到在等什么".to_owned(),
            )
            .into());
        };

        // 待审批项只在编排手里：台账上那条「有人批准过」是这次决定的**结果**，不是它的前提。
        let pending = match client.status(&row.instance_id).await {
            Ok(InstanceStatus::Running { custom_status }) => {
                custom_status.as_deref().and_then(pending_approval)
            }
            // 实例不在，或已经跑完：没有待办可批。
            Ok(_) => None,
            Err(err) => {
                return Err(AgentError::OrchestrationUnavailable(format!(
                    "查询 agent 编排状态失败：{err}"
                ))
                .into());
            }
        };

        let Some(pending) = pending.filter(|pending| pending.approval_id == approval_id) else {
            return Err(AgentError::ApprovalNotPending(format!(
                "任务 {task_id} 当前没有在等审批 {approval_id}"
            ))
            .into());
        };

        // 逾期时间照抄编排给的：判定在编排侧，台账记下来只为让「批了但送晚了」事后对得上账。
        let expires_at = DateTime::from_timestamp_millis(pending.expires_at).ok_or_else(|| {
            AgentError::Ledger(format!("编排报的逾期时间无法解析：{}", pending.expires_at))
        })?;

        let tenant_id = ctx.tenant_id();

        let recorded = match agent::persistence::record_approval(
            ctx.tx(),
            &agent::NewApproval {
                id: pending.approval_id.clone(),
                tenant_id: tenant_id.as_uuid(),
                task_id,
                step: pending.step,
                tool: pending.tool.clone(),
                arguments: pending.arguments.clone(),
                state: decision,
                decided_by: decider,
                reason: req.reason.clone(),
                expires_at: expires_at.fixed_offset(),
            },
        )
        .await
        {
            Ok(recorded) => recorded,
            // 改判是**业务冲突**（409），必须在「台账错误 → 内部错误」的通用映射之前认出来。
            Err(agent::Error::DecisionConflict {
                existing, incoming, ..
            }) => {
                return Err(AgentError::ApprovalAlreadyDecided(format!(
                    "审批 {approval_id} 已记为 {existing}，不能改判为 {incoming}"
                ))
                .into());
            }
            Err(err) => return Err(AgentError::from(err).into()),
        };

        // `applied_at` 为空 = 上一次提交死在了「提交」与「投递」之间，这一次要把决定补投出去。
        let needs_delivery = recorded.applied_at.is_none();
        let decided_at = recorded.decided_at.timestamp_millis();
        let state = ApprovalState::parse(&recorded.state).map_err(AgentError::from)?;
        // 投的是**台账里那一份**理由，不是这一次请求里的：重复提交给的新理由不该让编排看到
        // 与台账不一致的版本。
        let reason = recorded.reason.clone();

        if needs_delivery {
            // 先提交再投递：投递失败时那一行仍在册（`appliedAt` 为空），调用方重发就是补投。
            ctx.renew(storage).await?;

            let event = ApprovalDecisionEvent {
                approval_id: pending.approval_id.clone(),
                decision,
                reason,
            };
            client
                .enqueue_event(&row.instance_id, APPROVAL_QUEUE, &event)
                .await
                .map_err(|err| {
                    // 决定已经在册（`applied_at` 仍为空），调用方重发同方向的决定就是补投——
                    // 所以这里如实报 503，而不是假装成功。
                    AgentError::OrchestrationUnavailable(format!("投递审批决定失败：{err}"))
                })?;

            if let Err(err) = agent::persistence::mark_applied(ctx.tx(), &pending.approval_id).await
            {
                tracing::error!(error = %err, approval = %pending.approval_id, "审批投递标记未能落库");
            }
        }

        // 决定这时已经在编排邮箱里了，收尾这笔账没写上，最坏让下一次重复提交多投一次
        // （编排按 id 忽略重复）；反过来把「没记上」报成失败，会让调用方以为决定没送到而反复重投。
        if let Err(err) = ctx.commit().await {
            tracing::error!(error = %err, approval = %pending.approval_id, "审批决定的收尾提交失败");
        }

        Ok(ApprovalR {
            task_id: task_id.to_string(),
            approval_id: pending.approval_id,
            decision: state.as_str().to_owned(),
            applied: needs_delivery,
            decided_at,
        })
    }
}

/// 决定字面量 → 人的两种决定之一。
///
/// 只放行批准与驳回：`EXPIRED` 与任何未知词都拒掉。人**等不出**超时——那是编排在逾期时自己
/// 判的；接口允许送 `EXPIRED` 进来，就等于开了一条「把别人正等着的调用直接判死」的旁路。
///
/// 大小写与前后空白不计较（契约里的正写是 `APPROVED`/`REJECTED`，落库一律用正写）；
/// 这是格式上的宽容，与上面那条「词汇上不宽容」是两件事。
fn human_decision(literal: &str) -> Result<ApprovalState, AgentError> {
    let literal = literal.trim();
    match ApprovalState::parse(&literal.to_ascii_uppercase()) {
        Ok(state) if state != ApprovalState::Expired => Ok(state),
        _ => Err(AgentError::ApprovalDecisionInvalid(format!(
            "决定只能是 APPROVED 或 REJECTED，收到 {literal:?}"
        ))),
    }
}

/// 编排里没有这个实例：只有行龄够老才判失败，否则保持 `RUNNING` 等它被领走。
async fn settle_after_missing(
    storage: &Storage,
    row: agent_task::Model,
    tenant_id: TenantId,
) -> Result<TaskR, Exception> {
    if Utc::now().signed_duration_since(row.created_at) <= INSTANCE_ABSENT_GRACE {
        return Ok(render(&row, None));
    }

    let outcome = agent::TaskOutcome::failed(
        row.steps,
        "编排实例已不存在（任务记录仍在，未跑完）".to_owned(),
    );
    let settled = dispatch::settle(storage, row.id, tenant_id, &outcome)
        .await
        .map_err(Exception::from)?;

    Ok(render(settled.as_ref().unwrap_or(&row), None))
}

/// 把「编排起不来」落成失败台账，返回这个 503。
///
/// 落库失败只记日志：响应还是要说「这次没跑起来」，但那一行最坏也只是停在 `RUNNING` 上，
/// 读路径会在宽限期后把它收敛成失败——收尾有两条独立通道，不该因为一条断了就改口说成功。
async fn ledger_unavailable(
    storage: &Storage,
    prepared: &Prepared,
    reason: &str,
    detail: &str,
) -> Exception {
    tracing::error!(task = %prepared.task_id, reason, "agent 编排不可用");

    let outcome = agent::TaskOutcome::failed(prepared.row.steps, reason.to_owned());
    if let Err(err) =
        dispatch::settle(storage, prepared.task_id, prepared.tenant_id, &outcome).await
    {
        tracing::error!(error = %err, task = %prepared.task_id, "agent 失败台账未能落库");
    }

    AgentError::OrchestrationUnavailable(detail.to_owned()).into()
}

/// 台账行 → 出参。`progress` 是编排自报的当前进度串（只有还在跑、且问得到时才有）。
fn render(row: &agent_task::Model, progress: Option<&str>) -> TaskR {
    TaskR {
        id: row.id.to_string(),
        tenant_id: row.tenant_id.to_string(),
        user_id: row.user_id.map(|id| id.to_string()),
        status: row.status.clone(),
        objective: row.objective.clone(),
        model: row.model.clone(),
        max_steps: row.max_steps,
        allowed_tools: tools_of(row),
        steps: progress.and_then(steps_from_progress).unwrap_or(row.steps),
        progress: progress.map(str::to_owned),
        pending_approval: progress.and_then(pending_approval),
        finished: row
            .result
            .as_ref()
            .and_then(|result| result.get("finished"))
            .and_then(serde_json::Value::as_bool),
        result: row.result.clone(),
        error: row.error.clone(),
        created_at: row.created_at.timestamp_millis(),
        updated_at: row.updated_at.timestamp_millis(),
    }
}

/// 台账里的工具白名单；坏形状（非字符串数组）当下线处理，不让它把整个响应带崩。
fn tools_of(row: &agent_task::Model) -> Vec<String> {
    let Some(items) = row.allowed_tools.as_array() else {
        tracing::error!(task = %row.id, "agent 台账的工具列不是数组");
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| item.as_str().map(str::to_owned))
        .collect()
}

/// 轮次上限只能往小收：缺省用部署上限，给了就必须落在 `1..=上限`。
fn requested_steps(ceiling: usize, requested: Option<usize>) -> Result<i32, AgentError> {
    let steps = requested.unwrap_or(ceiling);
    if steps == 0 || steps > ceiling {
        return Err(AgentError::MaxStepsInvalid(format!(
            "轮次上限须在 1..={ceiling} 之间"
        )));
    }

    i32::try_from(steps).map_err(|_| AgentError::MaxStepsInvalid("轮次上限超出可表示范围".into()))
}

/// 工具只能从部署白名单里挑：缺省全给，给了就必须是子集（去重、保序）。
///
/// **只做子集判定**，不在这里重算「什么算合法工具名」——那套规则是配置层的
/// （`Configure::load()` 已经用它校验过白名单），在这里再写一份就是第二个真相源。
/// 空数组是合法输入，含义是「不给工具，只要一条结论」。
fn requested_tools(
    allowed: &[String],
    requested: Option<&[String]>,
) -> Result<Vec<String>, AgentError> {
    let Some(requested) = requested else {
        return Ok(allowed.to_vec());
    };

    let mut picked: Vec<String> = Vec::with_capacity(requested.len());
    for name in requested {
        let name = name.trim();
        if !allowed.iter().any(|candidate| candidate == name) {
            return Err(AgentError::ToolNotAllowed(format!(
                "工具 {name:?} 不在允许列表内；可用：{}",
                allowed.join(", ")
            )));
        }
        if !picked.iter().any(|kept| kept == name) {
            picked.push(name.to_owned());
        }
    }

    Ok(picked)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tools(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    #[test]
    fn steps_default_to_the_deployment_ceiling() {
        assert_eq!(requested_steps(6, None).unwrap(), 6);
        assert_eq!(requested_steps(6, Some(2)).unwrap(), 2);
    }

    #[test]
    fn steps_can_only_narrow_the_ceiling() {
        assert!(requested_steps(6, Some(7)).is_err(), "往大放要拒绝");
        assert!(requested_steps(6, Some(0)).is_err(), "0 轮没有意义");
        assert!(requested_steps(6, Some(6)).is_ok(), "取等是允许的");
    }

    #[test]
    fn tools_default_to_the_whole_allowlist() {
        let allowed = tools(&["knowledge_search", "asset_read"]);
        assert_eq!(requested_tools(&allowed, None).unwrap(), allowed);
    }

    #[test]
    fn tools_must_be_a_subset_and_keep_their_order() {
        let allowed = tools(&["knowledge_search", "asset_read"]);

        assert_eq!(
            requested_tools(&allowed, Some(&tools(&["asset_read", "knowledge_search"]))).unwrap(),
            tools(&["asset_read", "knowledge_search"]),
            "顺序即调用方意图，中间层不重排"
        );
        assert_eq!(
            requested_tools(&allowed, Some(&tools(&["asset_read", "asset_read"]))).unwrap(),
            tools(&["asset_read"]),
            "重复项去重"
        );
        assert_eq!(
            requested_tools(&allowed, Some(&tools(&[" asset_read "]))).unwrap(),
            tools(&["asset_read"]),
            "前后空白不该让合法名字被拒"
        );
    }

    #[test]
    fn empty_tools_mean_no_tools() {
        let allowed = tools(&["knowledge_search"]);
        assert!(
            requested_tools(&allowed, Some(&[])).unwrap().is_empty(),
            "空数组是「不给工具」，不是「用默认值」"
        );
    }

    #[test]
    fn unknown_tools_are_rejected_with_the_available_list() {
        let allowed = tools(&["knowledge_search", "asset_read"]);
        let err =
            requested_tools(&allowed, Some(&tools(&["knowledge_search", "shell"]))).unwrap_err();

        let message = err.to_string();
        assert!(message.contains("shell"), "要点名拒绝的是哪个");
        assert!(message.contains("asset_read"), "要列出可用的");
    }

    #[test]
    fn humans_can_only_approve_or_reject() {
        assert_eq!(human_decision("APPROVED").unwrap(), ApprovalState::Approved);
        assert_eq!(
            human_decision(" rejected ").unwrap(),
            ApprovalState::Rejected,
            "大小写与前后空白不该让合法决定被拒"
        );
    }

    #[test]
    fn expiry_is_not_something_a_human_can_decide() {
        let err = human_decision("EXPIRED").unwrap_err();
        assert!(
            matches!(err, AgentError::ApprovalDecisionInvalid(_)),
            "放行 EXPIRED 等于开一条把别人正等着的调用直接判死的旁路"
        );

        assert!(matches!(
            human_decision("maybe").unwrap_err(),
            AgentError::ApprovalDecisionInvalid(_)
        ));
        assert!(
            matches!(
                human_decision("expired").unwrap_err(),
                AgentError::ApprovalDecisionInvalid(_)
            ),
            "小写不是放行的理由"
        );
        assert!(matches!(
            human_decision("").unwrap_err(),
            AgentError::ApprovalDecisionInvalid(_)
        ));
    }
}
