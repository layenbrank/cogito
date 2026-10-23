//! 服务端 agent 的多轮循环（`agent.run`）：一步一个活动，跑到模型给出结论或用尽轮次预算。
//!
//! 循环的宿主是**编排**，不是 compute（D6）：它无状态，只做「一次推理 + 至多一轮工具」。
//! 这样每一步都是历史里的一步——崩了只重跑当前这一步，重试粒度最细，进度也能写进 custom status。
//! 反例（把整个循环塞进一次调用）会让一个活动跑几分钟、丢掉步骤可见性，并把「至少执行一次」
//! 的重试语义变粗。
//!
//! 两条不变式在每一步之后都要成立（见 [`check_invariants`]）。它们不是「防御性编程」，而是
//! 契约里写明的形状：`finished` 当且仅当没有工具调用、`toolResults` 与 `toolCalls` 同序对齐。
//! 一旦下游给出自相矛盾的一步，把它当结论收下就会把脏东西写进任务历史——那类 bug 表现为
//! 「模型莫名其妙地重复调用同一个工具」，极难排查。所以违反即**立刻判失败**（不可重试）。
//!
//! 确定性约束（见 `mod.rs` 的铁律）：编排里不碰系统时间、不碰网络、不遍历 HashMap。
//! 每一步的输入都由上一步的产出决定，所以重放时会重新算出同一串历史。
//! 唯一的时钟来自 `ctx.utc_now()`（框架的 SYSCALL 活动）：它的读数进历史，重放时复用的是
//! 记下来的那个值——等审批的逾期判定因此仍然是确定性的，而不是「看现在几点」。
//!
//! 拿到结论后还有一步 `agent.remember`（长期记忆）。它是**best-effort**：失败只留一条 warn，
//! 绝不改变任务的成败——结论已经算出来了，把「记不住」升级成「任务失败」是拿用户的结果
//! 去赌一个附加动作。它也只在**真正收尾**时才跑（轮次耗尽那种半截结论不写记忆，见
//! [`agent_run`](self) 里两处 return 的差别）。
//!
//! 写工具走**审批闸门**（`memory_write` 这类会改变业务数据的工具）：下游在 `/agents/steps`
//! 里只留一条占位结果（`awaitingApproval=true`），编排把「等谁批什么」写进 custom status、
//! 阻塞在批准或超时上，批准之后才调 `agent.tool-execution` 真的执行（见 [`agent_run`](self)
//! 与 [`resolve_tool_results`]）。闸门必须在编排里，而不是在活动里：活动跑在编排进程，
//! 那里没有业务库句柄（数据所有权见 `crates/durable` 的边界），落台账与投递决定都归 api。

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use durable::{Activities, Either2, OrchestrationContext, Orchestrations};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::clients::compute::{
    AgentMemoryRequest, AgentMemoryResponse, AgentMessage, AgentStepRequest, AgentStepResponse,
    AgentToolCall, AgentToolExecutionRequest, AgentToolExecutionResponse, AgentToolResult,
    ComputeClient, ComputeError, CallMeta, INTERNAL_SCHEMA_VERSION,
};
use crate::orchestrations::retry;

/// 编排名。名字是持久化契约：改名等于换了工作流，正在跑的实例会找不到实现。
pub const AGENT_RUN: &str = "agent.run";
/// 活动：走一步（一次推理 + 至多一轮工具）。
pub const AGENT_STEP: &str = "agent.step";
/// 活动：执行一次**已获人工批准**的工具调用（审批通道的执行半边）。
pub const AGENT_TOOL_EXECUTION: &str = "agent.tool-execution";
/// 活动：把最终结论写进长期记忆（best-effort，见模块文档）。
pub const AGENT_REMEMBER: &str = "agent.remember";

/// 审批决定的**邮箱**名。
///
/// 审批用的是邮箱语义（`Client::enqueue_event` / `ctx.dequeue_event`），不是事件语义
/// （`raise_event` / `ctx.schedule_wait`）：人的决定什么时候来无法预知，早到的必须被缓冲住，
/// 而不是因为「订阅还没绑上」丢掉。两条通道不能互换，名字也不是同义词。
pub const APPROVAL_QUEUE: &str = "agent.approval";

/// custom status 里审批段的标记。
///
/// 位置在进度串之后，`step:{step}/{max} tools:{n} approval:{json}`：前缀格式不变，
/// 既有读 `steps_from_progress` 的代码（台账、等待者）逐字节不需要改。
const APPROVAL_MARKER: &str = " approval:";

/// 审批等待上限的缺省值（秒）。
///
/// 只对**没有这一项的历史输入**生效（旧实例重放）：新实例一律由部署配置显式给值，
/// 免得改一个常量就悄悄改变了所有租户的等待时长。
const DEFAULT_APPROVAL_TTL_SECS: u64 = 1800;

/// 编排输入：起任务时定死的全部参数。
///
/// 模型与嵌入模型由 cogito 指定，不由 compute 猜（cogito 的 gateway 是唯一出网点与计量点）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunInput {
    /// 台账行标识，会让输出带回调用方，不必去别处找。
    #[serde(rename = "taskID")]
    pub task_id: String,
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    /// 发起人；服务身份（无会话）触发时为空。
    #[serde(rename = "userID", default, skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    /// 任务目标（自然语言），只在历史为空时起头。
    pub objective: String,
    /// 对话模型（网关目录里的一行）。
    pub model: String,
    /// 检索用的嵌入模型，必须与 `rag.index` 落库时用的模型一致。
    #[serde(rename = "embedModel")]
    pub embed_model: String,
    /// 轮次上限。
    #[serde(rename = "maxSteps")]
    pub max_steps: i32,
    /// 工具白名单；空数组 = 不给工具。
    #[serde(rename = "allowedTools")]
    pub allowed_tools: Vec<String>,
    /// 单次审批最多等多久（秒）。缺省（旧实例的历史里没有这一项）取
    /// [`DEFAULT_APPROVAL_TTL_SECS`]，起任务时由 api 按配置显式传入。
    #[serde(rename = "approvalTtlSecs", default = "default_approval_ttl_secs")]
    pub approval_ttl_secs: u64,
    /// 上游链路（请求头里的 `traceparent`）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traceparent: Option<String>,
}

/// 缺省等待时长（旧实例重放时用）。
fn default_approval_ttl_secs() -> u64 {
    DEFAULT_APPROVAL_TTL_SECS
}

/// 编排输出：台账要写的那些东西，加上给调用方看的结论。
///
/// 刻意**不记 token 用量**：计量的唯一落点是网关（`gateway_usage`），在这里再记一份
/// 迟早会有人拿两份数对账而对不上。要查某次任务花了多少，按服务主体查网关用量。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunOutput {
    #[serde(rename = "taskID")]
    pub task_id: String,
    /// 实际用掉的轮次。
    pub steps: i32,
    /// 是否由模型给出结论收的尾（`false` = 轮次预算耗尽，结论可能不完整）。
    pub finished: bool,
    /// 模型的最后一条正文；只有工具调用、没有正文时为空。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer: Option<String>,
    /// 一共执行了多少次工具调用（给运维看这个任务有多"重"）。
    #[serde(rename = "toolCalls")]
    pub tool_calls: i32,
    /// 结论写进长期记忆后拿到的 id。`None` = 没写或写失败（**不是**任务失败）：
    /// 长期记忆是附加产物，缺了它任务依然成功。
    #[serde(rename = "memoryID", default, skip_serializing_if = "Option::is_none")]
    pub memory_id: Option<String>,
    /// 这次任务里等过人工审批的调用（按发生顺序）。没等过就缺省——
    /// 「没等过」与「等过零次」是同一件事，不值得在快照里多一个空数组。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub approvals: Vec<ApprovalRecord>,
}

/// 一次审批的结局。
///
/// 字面量是**跨进程词汇**：api 落进 `agent_approval.state`、编排写进结果快照、
/// 人工决定的载荷里也用它，三处必须同一套拼写（`APPROVED` / `REJECTED` / `EXPIRED`）——
/// 所以定义只有这一处（台账内核），编排与接口层都从 [`crate::agent`] 借。
pub use ::agent::ApprovalState;

/// 待审批项：写进 custom status，api 从那里投影出「等谁批什么」（见 [`pending_approval`]）。
///
/// 放的是**模型给的参数原文**：人批的就是这一份，执行时照它执行。审批不能批一个「意思」，
/// 批的是一次具体调用。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PendingApproval {
    /// 审批标识（`<taskID>:<步骤>:<第几次调用>`），决定端点路径里用的就是它。
    #[serde(rename = "approvalID")]
    pub approval_id: String,
    /// 第几轮请求的（人需要这个上下文才知道模型在干什么）。
    pub step: i32,
    /// 工具名。
    pub tool: String,
    /// 模型给的参数 **JSON 字符串**（原文，不做任何改写）。
    pub arguments: String,
    /// 逾期时间（epoch 毫秒，编排的时钟）。过了这个点这次调用就作废。
    #[serde(rename = "expiresAt")]
    pub expires_at: i64,
}

/// 落进结果快照的一条审批记录。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRecord {
    #[serde(rename = "approvalID")]
    pub approval_id: String,
    /// 第几轮请求的。
    pub step: i32,
    /// 工具名。
    pub tool: String,
    /// 结局。
    pub decision: ApprovalState,
    /// 人工驳回时的理由（批准与超时为空）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// 审批决定事件：api 把人做的决定投进 [`APPROVAL_QUEUE`]。
///
/// 载荷里必须有 `approvalID`：邮箱是先到先得的**公共**信道，编排只能靠 id 认出
/// 「这条决定是我这一个闸门的吗」。不带 id 就没法区分决定属于哪一次调用。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalDecisionEvent {
    #[serde(rename = "approvalID")]
    pub approval_id: String,
    /// 决定本身。人只能批或驳——`EXPIRED` 是编排等出来的结局，不是人能给的。
    pub decision: ApprovalState,
    /// 驳回理由（可选，会进结果快照与台账）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// 从 custom status 里读出待审批项；读不出来给 `None`。
///
/// 取**第一个**标记之后的部分：标记一定出现在 JSON 之前，而 JSON 里的 `arguments` 是模型
/// 给的原文，可能碰巧含有同样的字样——按第一个切就永远是标记本身。
#[must_use]
pub fn pending_approval(status: &str) -> Option<PendingApproval> {
    let (_, raw) = status.split_once(APPROVAL_MARKER)?;
    serde_json::from_str(raw).ok()
}

/// 带待审批项的进度串。
fn status_with_approval(
    step: i32,
    max_steps: i32,
    tools: usize,
    pending: &PendingApproval,
) -> Result<String, String> {
    Ok(format!(
        "{}{APPROVAL_MARKER}{}",
        progress(step, max_steps, tools),
        encode(pending)?
    ))
}

/// 一步活动的输入：契约请求体的外面套一层**不进下游请求体**的元信息。
///
/// `step` 是幂等键的来源——同一轮重放要拿到同一个键，不同轮必须是不同的键，
/// 否则第二步会被下游当成第一步的重放而直接返回旧结果。
#[derive(Debug, Serialize, Deserialize)]
struct AgentStepActivity {
    /// 第几轮（1 起）。
    step: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    traceparent: Option<String>,
    #[serde(flatten)]
    request: AgentStepRequest,
}

/// 收尾活动的输入（与一步活动同构：元信息包在契约请求体外面）。
///
/// 这里**不需要** `step` 之类的确定性序号：记忆的幂等不是靠键，而是靠 compute 侧按
/// `(tenantID, taskID)` 派生的确定性 memoryID（见 `POST /internal/v1/agents/memories`）。
/// 幂等键仍然要发，因为契约要求所有写操作带键，但它不再是幂等的唯一防线。
#[derive(Debug, Serialize, Deserialize)]
struct AgentMemoryActivity {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    traceparent: Option<String>,
    #[serde(flatten)]
    request: AgentMemoryRequest,
}

/// 执行活动的输入（与前两个活动同构：元信息包在契约请求体外面）。
#[derive(Debug, Serialize, Deserialize)]
struct AgentToolExecutionActivity {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    traceparent: Option<String>,
    #[serde(flatten)]
    request: AgentToolExecutionRequest,
}

/// 注册活动。`client` 是唯一出站口，活动只负责「调用 + 分类错误」。
pub fn register_activities(activities: Activities, client: Arc<ComputeClient>) -> Activities {
    // 三个活动各自持一份 Arc：注册时各克隆一次，闭包内部再按调用克隆（活动可能并发）。
    let stepping = Arc::clone(&client);
    let activities = activities.register(AGENT_STEP, move |ctx, input: String| {
        let client = Arc::clone(&stepping);
        async move {
            let step: AgentStepActivity = decode(&input)?;
            let meta = CallMeta::new(
                idempotency_key(ctx.instance_id(), &format!("step:{}", step.step)),
                step.traceparent,
            );

            let response = client
                .agent_step(&step.request, &meta)
                .await
                .map_err(classify)?;

            encode(&response)
        }
    });

    let executing = Arc::clone(&client);
    let activities = activities.register(AGENT_TOOL_EXECUTION, move |ctx, input: String| {
        let client = Arc::clone(&executing);
        async move {
            let execution: AgentToolExecutionActivity = decode(&input)?;
            // 幂等键带审批标识：同一次审批无论重放多少次，下游只执行一次。
            let meta = CallMeta::new(
                idempotency_key(
                    ctx.instance_id(),
                    &format!("approval:{}", execution.request.approval_id),
                ),
                execution.traceparent,
            );

            let response = client
                .agent_tool_execution(&execution.request, &meta)
                .await
                .map_err(classify)?;

            encode(&response)
        }
    });

    let remembering = Arc::clone(&client);
    activities.register(AGENT_REMEMBER, move |ctx, input: String| {
        let client = Arc::clone(&remembering);
        async move {
            let remember: AgentMemoryActivity = decode(&input)?;
            let meta = CallMeta::new(
                idempotency_key(ctx.instance_id(), "remember"),
                remember.traceparent,
            );

            let response = client
                .agent_remember(&remember.request, &meta)
                .await
                .map_err(classify)?;

            encode(&response)
        }
    })
}

/// 注册编排。模型、轮次、工具都在输入里，所以这里没有额外参数。
pub fn register_orchestration(orchestrations: Orchestrations) -> Orchestrations {
    orchestrations.register(AGENT_RUN, move |ctx, input: String| async move {
        agent_run(ctx, input).await
    })
}

/// 一条任务的全部逻辑：单层循环，每轮一个活动。
async fn agent_run(ctx: OrchestrationContext, input: String) -> Result<String, String> {
    let step: AgentRunInput = decode(&input)?;
    let max_steps = step.max_steps.max(1);
    let mut history: Vec<AgentMessage> = Vec::new();
    let mut approvals: Vec<ApprovalRecord> = Vec::new();
    let mut steps = 0;
    let mut tool_calls = 0;

    loop {
        steps += 1;
        let remaining = remaining_steps(steps, max_steps);
        let tools = tools_for_step(&step.allowed_tools, remaining);
        let request = AgentStepRequest {
            schema_version: INTERNAL_SCHEMA_VERSION,
            tenant_id: step.tenant_id.clone(),
            objective: step.objective.clone(),
            model: step.model.clone(),
            embed_model: step.embed_model.clone(),
            history: history.clone(),
            allowed_tools: tools.clone(),
            remaining_steps: Some(remaining),
        };
        // 进度进 custom status：运维与接入方都能从这里看出「走到第几轮了」。
        ctx.set_custom_status(progress(steps, max_steps, tools.len()));

        let activity = AgentStepActivity {
            step: steps,
            traceparent: step.traceparent.clone(),
            request,
        };
        let response: AgentStepResponse =
            decode(&retry::run_activity(&ctx, AGENT_STEP, &encode(&activity)?).await?)?;
        check_invariants(&response)?;

        // 需要审批的工具在下游只留了占位结果：这里补上「等人 → 执行」，
        // 结果与原生执行的完全同形，所以历史里最终只留一条结果（1:1 不变式不破）。
        let (results, waited) =
            resolve_tool_results(&ctx, &step, steps, max_steps, &tools, &response).await?;
        approvals.extend(waited);

        // 历史由 cogito 攒：助手消息（含它要的工具）+ 每个工具结果各一条 `tool` 消息。
        history.push(AgentMessage::assistant(&response));
        for result in &results {
            history.push(AgentMessage::tool(result));
        }
        tool_calls += results.len() as i32;

        if response.finished {
            let answer = response.message.content.clone();
            ctx.trace_info(format!("任务收尾：steps={steps} toolCalls={tool_calls}"));

            // 只有正文非空才写记忆：空白结论到了下游会被判 400（它只会污染之后的每次召回），
            // 而且「收尾但没有正文」是合法形状（模型只要了一次工具）。
            let memory_id = match answer.as_deref() {
                Some(text) if !text.trim().is_empty() => {
                    remember_conclusion(&ctx, &step, steps, tool_calls, text).await
                }
                _ => None,
            };

            return encode(&AgentRunOutput {
                task_id: step.task_id.clone(),
                steps,
                finished: true,
                answer,
                tool_calls,
                memory_id,
                approvals,
            });
        }

        if steps >= max_steps {
            // 预算耗尽。最后一步本来就不给工具，理论上不会再出现工具调用；真出现了说明下游
            // 没看懂 `remainingSteps`。此时按「结论不完整」收尾，而不是继续转下去。
            //
            // **半截结论不写长期记忆**：记忆会被之后的任务当成既有事实召回，把「没查完的
            // 推断」写成永久记忆，比不写更坏。
            ctx.trace_warn(format!(
                "轮次预算耗尽（{max_steps} 步）仍未得到结论，按未完成收尾"
            ));
            return encode(&AgentRunOutput {
                task_id: step.task_id.clone(),
                steps,
                finished: false,
                answer: response.message.content.clone(),
                tool_calls,
                memory_id: None,
                approvals,
            });
        }
    }
}

/// 一步里的全部结果：需要审批的调用在这里等人做决定，其余原样通过。
///
/// 返回「结果」与「这一等产生的审批记录」。**结果与调用严格 1:1**：占位结果不进历史，
/// 等人之后拿到的执行结果（或合成结果）替换掉它——同一位置，同一个 `toolCallID`。
async fn resolve_tool_results(
    ctx: &OrchestrationContext,
    run: &AgentRunInput,
    step: i32,
    max_steps: i32,
    tools: &[String],
    response: &AgentStepResponse,
) -> Result<(Vec<AgentToolResult>, Vec<ApprovalRecord>), String> {
    let calls = response.message.tool_calls.as_deref().unwrap_or_default();
    let mut results = Vec::with_capacity(response.tool_results.len());
    let mut approvals = Vec::new();

    for (index, result) in response.tool_results.iter().enumerate() {
        if !result.awaiting_approval.unwrap_or(false) {
            results.push(result.clone());
            continue;
        }

        // `check_invariants` 已经保证结果与调用同长同序，这里按位取调用。
        let call = calls
            .get(index)
            .ok_or_else(|| retry::permanent(format!("第 {step} 步要审批的调用没有对应记录")))?;
        let (result, record) =
            approve_and_execute(ctx, run, step, max_steps, tools, index, call).await?;
        results.push(result);
        approvals.push(record);
    }

    Ok((results, approvals))
}

/// 一次写入的完整旅程：挂出待审批 → 等人 → 按决定执行或合成结果。
///
/// 顺序里有两处是必须的：
/// 一是**先挂待办再等**（反过来的话人会看到一个还不存在的待办，或者批了没人接）；
/// 二是**拿到决定立刻清掉待办**（工具执行可能还要几秒，那期间 api 若还能看到「待审批」，
/// 就可能被再批一次——决定只能有一个）。
async fn approve_and_execute(
    ctx: &OrchestrationContext,
    run: &AgentRunInput,
    step: i32,
    max_steps: i32,
    tools: &[String],
    index: usize,
    call: &AgentToolCall,
) -> Result<(AgentToolResult, ApprovalRecord), String> {
    let approval_id = approval_id(&run.task_id, step, index);
    let arguments = call.arguments.clone().unwrap_or_else(|| "{}".to_owned());

    let now = ctx
        .utc_now()
        .await
        .map_err(|e| retry::permanent(format!("读取编排时钟失败：{e}")))?;
    let deadline = now + Duration::from_secs(run.approval_ttl_secs);
    let pending = PendingApproval {
        approval_id: approval_id.clone(),
        step,
        tool: call.name.clone(),
        arguments: arguments.clone(),
        expires_at: epoch_millis(deadline),
    };

    ctx.set_custom_status(status_with_approval(
        step,
        max_steps,
        tools.len(),
        &pending,
    )?);
    ctx.trace_info(format!(
        "等待人工审批：{approval_id}（工具 {}，逾期 {})",
        call.name, pending.expires_at
    ));

    let verdict = wait_for_decision(ctx, &approval_id, deadline).await?;

    // 决定落定，待办立刻消失：之后的执行结果会写回同一步的普通进度串。
    ctx.set_custom_status(progress(step, max_steps, tools.len()));

    let result = match &verdict {
        Verdict::Approved => {
            execute_approved(ctx, run, &approval_id, tools, call, &arguments).await?
        }
        Verdict::Rejected(reason) => {
            refused_result(call, ApprovalState::Rejected, reason.as_deref())
        }
        Verdict::Expired => refused_result(call, ApprovalState::Expired, None),
    };
    let record = ApprovalRecord {
        approval_id,
        step,
        tool: call.name.clone(),
        decision: verdict.state(),
        reason: verdict.reason(),
    };

    Ok((result, record))
}

/// 闸门的结局。
#[derive(Debug)]
enum Verdict {
    /// 人工批准：接着执行。
    Approved,
    /// 人工驳回（带可选理由）：不执行，合成一条结果。
    Rejected(Option<String>),
    /// 等到逾期都没人处理：不执行，合成一条结果。
    Expired,
}

impl Verdict {
    /// 进台账与快照的字面量。
    fn state(&self) -> ApprovalState {
        match self {
            Self::Approved => ApprovalState::Approved,
            Self::Rejected(_) => ApprovalState::Rejected,
            Self::Expired => ApprovalState::Expired,
        }
    }

    /// 理由（只有人工驳回会有）。
    fn reason(&self) -> Option<String> {
        match self {
            Self::Rejected(reason) => reason.clone(),
            _ => None,
        }
    }
}

/// 阻塞等一条**指向本次审批**的决定，或等到逾期时间。
///
/// `select2` 是框架自带的组合子：它按参数顺序偏置轮询，重放时每次都会得到同一个赢家
/// （`futures::select` 之类的通用组合子不保证这个，会重放出另一条历史）。
/// 输的那个 future 被丢掉是**无副作用**的——定时器到点照样触发，只是多一次无害的唤醒。
async fn wait_for_decision(
    ctx: &OrchestrationContext,
    approval_id: &str,
    deadline: SystemTime,
) -> Result<Verdict, String> {
    loop {
        let now = ctx
            .utc_now()
            .await
            .map_err(|e| retry::permanent(format!("读取编排时钟失败：{e}")))?;
        // 逾期边界是**绝对时间**：被别人的消息叫醒多少次都不续期，否则一直投不相干的决定
        // 就能把闸门永久撑开。
        let remaining = match deadline.duration_since(now) {
            Ok(remaining) => remaining,
            Err(_) => return Ok(Verdict::Expired),
        };

        match ctx
            .select2(
                ctx.dequeue_event(APPROVAL_QUEUE),
                ctx.schedule_timer(remaining),
            )
            .await
        {
            Either2::First(payload) => {
                let event: ApprovalDecisionEvent = serde_json::from_str(&payload)
                    .map_err(|e| retry::permanent(format!("审批决定无法解析：{e}")))?;

                if event.approval_id != approval_id {
                    // 邮箱是公共信道，先到先得：上一个闸门遗留的、或者重复投递的决定都会
                    // 落到这里。它既不是给我的，也不能吃掉，只能忽略后接着等自己那条。
                    ctx.trace_warn(format!(
                        "忽略不属于本次审批的决定：{}（在等 {approval_id}）",
                        event.approval_id
                    ));
                    continue;
                }

                return match event.decision {
                    ApprovalState::Approved => Ok(Verdict::Approved),
                    ApprovalState::Rejected => Ok(Verdict::Rejected(event.reason)),
                    // 「超时」是编排等出来的，不是人能给的：真收到这种载荷就是有人在伪造
                    // 或者下游写错了，不能当成一个正常结局吞掉。
                    ApprovalState::Expired => Err(retry::permanent(
                        "审批决定不能是 EXPIRED：超时由编排自己判定".to_owned(),
                    )),
                };
            }
            Either2::Second(()) => return Ok(Verdict::Expired),
        }
    }
}

/// 批准之后真的去执行：这是**唯一**会执行受审批保护工具的路径。
async fn execute_approved(
    ctx: &OrchestrationContext,
    run: &AgentRunInput,
    approval_id: &str,
    tools: &[String],
    call: &AgentToolCall,
    arguments: &str,
) -> Result<AgentToolResult, String> {
    let activity = AgentToolExecutionActivity {
        traceparent: run.traceparent.clone(),
        request: AgentToolExecutionRequest {
            schema_version: INTERNAL_SCHEMA_VERSION,
            tenant_id: run.tenant_id.clone(),
            task_id: run.task_id.clone(),
            approval_id: approval_id.to_owned(),
            embed_model: run.embed_model.clone(),
            allowed_tools: tools.to_vec(),
            tool_call: AgentToolCall {
                id: call.id.clone(),
                name: call.name.clone(),
                // 执行的就是**人批过的那一份参数**（不是模型后来又给的一份）。
                arguments: Some(arguments.to_owned()),
                tool_call_type: call.tool_call_type.clone(),
            },
        },
    };

    let response: AgentToolExecutionResponse =
        decode(&retry::run_activity(&ctx, AGENT_TOOL_EXECUTION, &encode(&activity)?).await?)?;

    // 下游必须回的正是我们批的那一次调用。指错了就是契约破了，不能收下当结果——
    // 收下就等于把「另一次调用的后果」记在这次审批头上。
    if response.tool_result.tool_call_id != call.id {
        return Err(retry::permanent(format!(
            "审批执行的结果没有对齐调用：期望 {}，实际 {}",
            call.id, response.tool_result.tool_call_id
        )));
    }

    Ok(response.tool_result)
}

/// 被拒或超时时合成一条结果：历史里必须有这次调用的结果，1:1 不变式不能破。
///
/// 文案是**给模型读**的：它得知道「没执行」，并且不要原样重试——同一步里重试只会再撞一次
/// 闸门，而人已经表过态了。重复提交同一个调用是这套闸门唯一防不住的浪费，用文案堵住它。
fn refused_result(
    call: &AgentToolCall,
    state: ApprovalState,
    reason: Option<&str>,
) -> AgentToolResult {
    let (content, error) = match state {
        ApprovalState::Rejected => (
            match reason {
                Some(reason) => format!(
                    "这次调用没有执行：人工审批被驳回（理由：{reason}）。不要再提交同一个调用，\
                     改用不需要写数据的做法，或者直接给出结论。"
                ),
                None => "这次调用没有执行：人工审批被驳回。不要再提交同一个调用，\
                         改用不需要写数据的做法，或者直接给出结论。"
                    .to_owned(),
            },
            "approval_rejected",
        ),
        _ => (
            "这次调用没有执行：等待人工审批超时，没有人处理。不要再提交同一个调用，\
             改用不需要写数据的做法，或者直接给出结论。"
                .to_owned(),
            "approval_expired",
        ),
    };

    AgentToolResult {
        tool_call_id: call.id.clone(),
        name: call.name.clone(),
        ok: false,
        content,
        error: Some(error.to_owned()),
        awaiting_approval: None,
    }
}

/// 审批标识：**确定性派生**。
///
/// 同一个实例重放时必须算出同一个 id（否则投出去的决定会对不上），所以不能用随机数或
/// 时钟：`<taskID>:<步骤>:<第几次调用>` 全部来自历史里已有的值。
fn approval_id(task_id: &str, step: i32, index: usize) -> String {
    format!("{task_id}:{step}:{index}")
}

/// `SystemTime` → epoch 毫秒（给人看的绝对时间；1970 之前不存在于本系统，兜底 0）。
fn epoch_millis(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64)
}

/// 把收尾结论写进长期记忆，best-effort：返回拿到的记忆 id，任何失败都只留 warn。
///
/// 这里**不重试整任务**。记忆写失败最多让之后的任务少一条可召回的经验，而任务结论本身
/// 已经在手里了；把两者绑在一起等于用「用户的结果」去赌「附加动作」。
/// （下游的一次性失败由 `retry::run_activity` 在下游侧退避重试；它写记忆是幂等的。）
async fn remember_conclusion(
    ctx: &OrchestrationContext,
    step: &AgentRunInput,
    steps: i32,
    tool_calls: i32,
    answer: &str,
) -> Option<String> {
    let activity = AgentMemoryActivity {
        traceparent: step.traceparent.clone(),
        request: AgentMemoryRequest {
            schema_version: INTERNAL_SCHEMA_VERSION,
            tenant_id: step.tenant_id.clone(),
            task_id: step.task_id.clone(),
            objective: step.objective.clone(),
            answer: answer.to_owned(),
            steps,
            tool_calls,
            embed_model: step.embed_model.clone(),
        },
    };

    match remember_once(ctx, &activity).await {
        Ok(memory_id) => Some(memory_id),
        Err(reason) => {
            ctx.trace_warn(format!(
                "结论未能写进长期记忆（{reason}）；任务结论不受影响"
            ));
            None
        }
    }
}

/// 单次收尾记忆活动：编码 → 调用 → 解回记忆 id。编码/解码失败也走 `Err`（同样是可忽略的）。
async fn remember_once(
    ctx: &OrchestrationContext,
    activity: &AgentMemoryActivity,
) -> Result<String, String> {
    let input = encode(activity)?;
    let output = retry::run_activity(ctx, AGENT_REMEMBER, &input).await?;
    let response: AgentMemoryResponse = decode(&output)?;

    Ok(response.memory_id)
}

/// 两条不变式都在契约里写着；违反即判失败，且不可重试（重试同一份输入只会得到同一份矛盾）。
fn check_invariants(response: &AgentStepResponse) -> Result<(), String> {
    let calls = response.message.tool_calls.as_deref().unwrap_or_default();

    if response.finished != calls.is_empty() {
        return Err(retry::permanent(format!(
            "单步结果自相矛盾：finished={} 但模型要了 {} 个工具",
            response.finished,
            calls.len()
        )));
    }
    if response.tool_results.len() != calls.len() {
        return Err(retry::permanent(format!(
            "单步结果与工具调用对不上：要了 {} 个，回了 {} 个结果",
            calls.len(),
            response.tool_results.len()
        )));
    }
    for (call, result) in calls.iter().zip(&response.tool_results) {
        if call.id != result.tool_call_id {
            return Err(retry::permanent(format!(
                "工具结果与调用没对齐：期望 {}，实际 {}",
                call.id, result.tool_call_id
            )));
        }
    }

    Ok(())
}

/// 第 `step` 步还剩几步（含本步）。预算是「还剩几次机会」，所以从上限往下数。
fn remaining_steps(step: i32, max_steps: i32) -> i32 {
    (max_steps - (step - 1)).max(0)
}

/// 本步给模型的工具白名单：预算只剩这一步时清空。
///
/// 契约里 `remainingSteps <= 1` 时下游本来也会收回工具，这里是**主动**表达同一个意图：
/// 「必须给结论了」由发起方说清楚，比让下游替我们猜要好。
fn tools_for_step(allowed: &[String], remaining: i32) -> Vec<String> {
    if remaining <= 1 {
        return Vec::new();
    }
    allowed.to_vec()
}

/// 进度标签（也是 `steps_from_progress` 的输入格式）。
pub fn progress(step: i32, max_steps: i32, tools: usize) -> String {
    format!("step:{step}/{max_steps} tools:{tools}")
}

/// 从进度标签里读回轮次。
///
/// 失败时台账要能写出「失败在第几轮」，而编排失败时只有 custom status 这条现成的信息。
/// 认不出来就返回 `None`（写不出轮次，不编造一个数）。
pub fn steps_from_progress(status: &str) -> Option<i32> {
    let rest = status.strip_prefix("step:")?;
    let (step, _) = rest.split_once('/')?;

    step.parse().ok()
}

/// 幂等键：`<实例 id>:<步骤>`。实例 id 由框架生成，同一实例重放拿到同一个键。
fn idempotency_key(instance: &str, step: &str) -> String {
    format!("{instance}:{step}")
}

/// 活动失败 → 编排能读懂的语义。分类只在活动里做，因为只有它知道下游回了什么。
fn classify(error: ComputeError) -> String {
    if error.is_retryable() {
        retry::transient(error.to_string())
    } else {
        retry::permanent(error.to_string())
    }
}

fn encode<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|e| retry::permanent(format!("步骤输出无法编码: {e}")))
}

fn decode<T: DeserializeOwned>(raw: &str) -> Result<T, String> {
    serde_json::from_str(raw).map_err(|e| retry::permanent(format!("步骤输入无法解析: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clients::compute::{AgentToolCall, AgentToolResult};

    fn input() -> AgentRunInput {
        AgentRunInput {
            task_id: "task-1".into(),
            tenant_id: "t-1".into(),
            user_id: None,
            objective: "总结这批文档".into(),
            model: "deepseek-chat".into(),
            embed_model: "text-embedding-3-small".into(),
            max_steps: 6,
            allowed_tools: vec!["knowledge_search".into(), "asset_read".into()],
            approval_ttl_secs: DEFAULT_APPROVAL_TTL_SECS,
            traceparent: None,
        }
    }

    fn step_response(finished: bool, calls: Vec<(&str, &str)>, results: Vec<&str>) -> String {
        let tool_calls: Vec<AgentToolCall> = calls
            .into_iter()
            .map(|(id, name)| AgentToolCall {
                id: id.into(),
                name: name.into(),
                arguments: Some("{}".into()),
                tool_call_type: Some("function".into()),
            })
            .collect();
        let tool_results: Vec<AgentToolResult> = results
            .into_iter()
            .map(|id| AgentToolResult {
                tool_call_id: id.into(),
                name: "knowledge_search".into(),
                ok: true,
                content: "段 1".into(),
                error: None,
                awaiting_approval: None,
            })
            .collect();

        encode(&AgentStepResponse {
            schema_version: INTERNAL_SCHEMA_VERSION,
            finished,
            message: AgentMessage {
                role: "assistant".into(),
                content: Some("结论".into()),
                tool_calls: if tool_calls.is_empty() {
                    None
                } else {
                    Some(tool_calls)
                },
                tool_call_id: None,
            },
            tool_results,
            usage: crate::clients::compute::AgentUsage {
                prompt_tokens: 10,
                completion_tokens: 2,
                total_tokens: 12,
            },
        })
        .expect("encode")
    }

    #[test]
    fn names_are_stable() {
        // 名字进的是数据库（编排历史），改字面量等于换工作流。
        assert_eq!(AGENT_RUN, "agent.run");
        assert_eq!(AGENT_STEP, "agent.step");
        assert_eq!(AGENT_TOOL_EXECUTION, "agent.tool-execution");
        assert_eq!(AGENT_REMEMBER, "agent.remember");
        // 审批的邮箱名与 api 投递时用的名字必须同一个：它不写进历史，但两边写错就永远等不到。
        assert_eq!(APPROVAL_QUEUE, "agent.approval");
    }

    #[test]
    fn approval_literals_are_stable() {
        assert_eq!(ApprovalState::Approved.as_str(), "APPROVED");
        assert_eq!(ApprovalState::Rejected.as_str(), "REJECTED");
        assert_eq!(ApprovalState::Expired.as_str(), "EXPIRED");
        assert_eq!(
            ApprovalState::parse("APPROVED").unwrap(),
            ApprovalState::Approved
        );
        assert_eq!(
            ApprovalState::parse("EXPIRED").unwrap(),
            ApprovalState::Expired
        );

        // 认不出来就报错：坏行必须被看见，不能猜成某个已知结局。
        let error = ApprovalState::parse("approved").expect_err("应当报错");
        assert!(error.to_string().contains("approved"), "{error}");
    }

    #[test]
    fn the_ttl_falls_back_for_inputs_written_before_the_gate_existed() {
        // 旧实例的历史里没有这一项：重放时要拿到缺省值，而不是解析失败。
        let json = r#"{"taskID":"t","tenantID":"t-1","objective":"o","model":"m","embedModel":"e","maxSteps":3,"allowedTools":[]}"#;
        let parsed: AgentRunInput = decode(json).expect("decode");
        assert_eq!(parsed.approval_ttl_secs, DEFAULT_APPROVAL_TTL_SECS);
        // 缺省值必须留在等待者预算（3600s）之内，否则任务会先被等待者判超时。
        assert!(DEFAULT_APPROVAL_TTL_SECS < 3600);
    }

    #[test]
    fn input_round_trips_with_camel_case() {
        let json = encode(&input()).expect("encode");
        assert!(json.contains(r#""taskID":"task-1""#), "{json}");
        assert!(json.contains(r#""tenantID":"t-1""#), "{json}");
        assert!(json.contains(r#""maxSteps":6"#), "{json}");
        assert!(json.contains(r#""embedModel""#), "{json}");
        assert!(json.contains(r#""allowedTools""#), "{json}");
        assert!(json.contains(r#""approvalTtlSecs":1800"#), "{json}");
        assert!(!json.contains("userID"), "空的发起人不该出现在输入里");
        assert!(!json.contains("traceparent"), "缺省链路不该出现在输入里");

        let parsed: AgentRunInput = decode(&json).expect("decode");
        assert_eq!(parsed.max_steps, 6);
        assert_eq!(parsed.allowed_tools.len(), 2);
    }

    #[test]
    fn budget_counts_down_and_the_last_step_gets_no_tools() {
        assert_eq!(remaining_steps(1, 6), 6);
        assert_eq!(remaining_steps(6, 6), 1);
        assert_eq!(remaining_steps(7, 6), 0, "越界要夹到 0，不能变负数");

        let tools = vec!["knowledge_search".to_owned()];
        assert_eq!(tools_for_step(&tools, 2), tools);
        assert!(
            tools_for_step(&tools, 1).is_empty(),
            "最后一步必须收回工具：模型得先给结论，否则下一步就撞硬止损"
        );
        assert!(tools_for_step(&tools, 0).is_empty());
    }

    #[test]
    fn progress_round_trips() {
        let status = progress(3, 6, 2);
        assert_eq!(status, "step:3/6 tools:2");
        assert_eq!(steps_from_progress(&status), Some(3));
        assert_eq!(steps_from_progress("step:1/1 tools:0"), Some(1));

        // 认不出来就给 `None`：宁可写不出轮次，也不编一个数进台账。
        assert_eq!(steps_from_progress("chunked:33"), None);
        assert_eq!(steps_from_progress(""), None);
        assert_eq!(steps_from_progress("step:x/6 tools:1"), None);
    }

    #[test]
    fn invariants_pass_on_a_well_formed_step() {
        let finished = step_response(true, vec![], vec![]);
        let parsed: AgentStepResponse = decode(&finished).expect("decode");
        assert!(check_invariants(&parsed).is_ok());

        let with_tools = step_response(false, vec![("call-1", "knowledge_search")], vec!["call-1"]);
        let parsed: AgentStepResponse = decode(&with_tools).expect("decode");
        assert!(check_invariants(&parsed).is_ok());
    }

    #[test]
    fn invariants_reject_contradictions_permanently() {
        let cases = [
            // finished 说有结论，模型却要了工具。
            step_response(true, vec![("call-1", "knowledge_search")], vec!["call-1"]),
            // 要了两个工具，只回了一个结果。
            step_response(
                false,
                vec![("call-1", "knowledge_search"), ("call-2", "asset_read")],
                vec!["call-1"],
            ),
            // 结果指回了另一次调用。
            step_response(false, vec![("call-1", "knowledge_search")], vec!["call-9"]),
        ];

        for raw in cases {
            let parsed: AgentStepResponse = decode(&raw).expect("decode");
            let error = check_invariants(&parsed).expect_err("应当判失败");
            assert!(retry::is_permanent(&error), "{error}");
        }
    }

    #[test]
    fn activity_envelope_carries_the_step_and_survives_an_empty_history() {
        let activity = AgentStepActivity {
            step: 2,
            traceparent: Some("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01".into()),
            request: AgentStepRequest {
                schema_version: INTERNAL_SCHEMA_VERSION,
                tenant_id: "t-1".into(),
                objective: "总结".into(),
                model: "deepseek-chat".into(),
                embed_model: "text-embedding-3-small".into(),
                history: vec![],
                allowed_tools: vec![],
                remaining_steps: Some(5),
            },
        };
        let json = encode(&activity).expect("encode");
        // 元信息与契约请求体摊平在同一个对象里（活动输入是 cogito 自己的载荷，不是下游契约）。
        assert!(json.contains(r#""step":2"#), "{json}");
        assert!(json.contains(r#""tenantID":"t-1""#), "{json}");

        // 第一步的历史是空的，会被跳过；回读时必须仍然成立（缺省即空历史）。
        let parsed: AgentStepActivity = decode(&json).expect("decode");
        assert!(parsed.request.history.is_empty());
        assert_eq!(parsed.step, 2);
    }

    #[test]
    fn idempotency_keys_are_step_scoped() {
        assert_eq!(idempotency_key("inst-1", "step:1"), "inst-1:step:1");
        assert_ne!(
            idempotency_key("inst-1", "step:1"),
            idempotency_key("inst-1", "step:2"),
            "不同轮必须是不同的键，否则第二轮会被下游当成第一轮的重放"
        );
    }

    #[test]
    fn classifies_retryability() {
        assert!(classify(ComputeError::RateLimited).starts_with(retry::TRANSIENT));
        assert!(classify(ComputeError::Timeout).starts_with(retry::TRANSIENT));
        assert!(
            classify(ComputeError::Rejected {
                status: 400,
                body: "bad".into()
            })
            .starts_with(retry::PERMANENT)
        );
    }

    #[test]
    fn bad_input_is_permanent_so_it_never_retries() {
        let error = decode::<AgentRunInput>("{ not json").expect_err("应当失败");
        assert!(retry::is_permanent(&error), "{error}");
    }

    #[test]
    fn output_round_trips() {
        let output = AgentRunOutput {
            task_id: "task-1".into(),
            steps: 3,
            finished: false,
            answer: None,
            tool_calls: 4,
            memory_id: None,
            approvals: vec![],
        };
        let json = encode(&output).expect("encode");
        assert!(json.contains(r#""taskID":"task-1""#), "{json}");
        assert!(!json.contains("answer"), "没有结论时不该发一个 null");
        assert!(
            !json.contains("memoryID"),
            "没写记忆时不该发一个 null：缺字段就是「没有记忆」的意思 —— {json}"
        );
        assert!(
            !json.contains("usage") && !json.contains("Tokens"),
            "token 用量的唯一落点是网关，台账里不重复记 —— {json}"
        );
        assert!(
            !json.contains("approvals"),
            "没等过审批就缺省：空数组与「没等过」是同一件事 —— {json}"
        );

        let parsed: AgentRunOutput = decode(&json).expect("decode");
        assert!(!parsed.finished);
        assert_eq!(parsed.tool_calls, 4);
        assert_eq!(parsed.memory_id, None);
        assert!(parsed.approvals.is_empty());
    }

    #[test]
    fn output_carries_the_memory_id_when_one_was_written() {
        let output = AgentRunOutput {
            task_id: "task-1".into(),
            steps: 1,
            finished: true,
            answer: Some("结论".into()),
            tool_calls: 0,
            memory_id: Some("0b0e1e1e-1c1c-4c4c-8c8c-1c1c1c1c1c1c".into()),
            approvals: vec![],
        };
        let json = encode(&output).expect("encode");
        assert!(json.contains(r#""memoryID""#), "{json}");

        let parsed: AgentRunOutput = decode(&json).expect("decode");
        assert_eq!(
            parsed.memory_id.as_deref(),
            Some("0b0e1e1e-1c1c-4c4c-8c8c-1c1c1c1c1c1c")
        );
    }

    #[test]
    fn output_carries_the_approval_trail() {
        // 台账快照就是这段 JSON：等过审批的任务必须能从这里看出「批了几次、都是什么结局」。
        let output = AgentRunOutput {
            task_id: "task-1".into(),
            steps: 2,
            finished: true,
            answer: Some("结论".into()),
            tool_calls: 1,
            memory_id: None,
            approvals: vec![ApprovalRecord {
                approval_id: "task-1:2:0".into(),
                step: 2,
                tool: "memory_write".into(),
                decision: ApprovalState::Rejected,
                reason: Some("不该写永久记忆".into()),
            }],
        };
        let json = encode(&output).expect("encode");
        assert!(json.contains(r#""approvalID":"task-1:2:0""#), "{json}");
        assert!(json.contains(r#""decision":"REJECTED""#), "{json}");
        assert!(json.contains(r#""reason":"不该写永久记忆""#), "{json}");

        let parsed: AgentRunOutput = decode(&json).expect("decode");
        assert_eq!(parsed.approvals.len(), 1);
        assert_eq!(parsed.approvals[0].decision, ApprovalState::Rejected);
    }

    #[test]
    fn pending_approval_round_trips_inside_the_progress_string() {
        let pending = PendingApproval {
            approval_id: "task-1:2:0".into(),
            step: 2,
            tool: "memory_write".into(),
            arguments: r#"{"content":"长期事实"}"#.into(),
            expires_at: 1_700_000_000_000,
        };
        let status = status_with_approval(2, 6, 2, &pending).expect("encode");

        // 进度前缀逐字节不变：既有读 `steps_from_progress` 的代码一个字都不用改。
        assert!(status.starts_with("step:2/6 tools:2"), "{status}");
        assert_eq!(steps_from_progress(&status), Some(2));
        assert_eq!(pending_approval(&status), Some(pending));

        // 没有审批段的普通进度串读不出待审批项。
        assert_eq!(pending_approval(&progress(2, 6, 2)), None);
        assert_eq!(pending_approval("chunked:33"), None);
        assert_eq!(pending_approval("step:1/1 tools:0 approval:{"), None);
    }

    #[test]
    fn pending_approval_reads_past_a_marker_inside_the_arguments() {
        // 模型给的参数是原文，可能自带同样的字样；标记永远在最前面，按第一个切才对。
        let pending = PendingApproval {
            approval_id: "task-1:1:0".into(),
            step: 1,
            tool: "memory_write".into(),
            arguments: r#"{"content":"带一个 approval: 字样的正文"}"#.into(),
            expires_at: 1,
        };
        let status = status_with_approval(1, 6, 1, &pending).expect("encode");

        assert_eq!(pending_approval(&status), Some(pending));
    }

    #[test]
    fn approval_ids_are_derived_from_the_history() {
        // 确定性：重放必须算出同一个 id，否则 api 投出去的决定对不上。
        assert_eq!(approval_id("task-1", 2, 0), "task-1:2:0");
        assert_ne!(
            approval_id("task-1", 2, 0),
            approval_id("task-1", 2, 1),
            "同一步里的第二次调用是另一次审批"
        );
        assert_eq!(epoch_millis(UNIX_EPOCH), 0);
        assert_eq!(epoch_millis(UNIX_EPOCH + Duration::from_millis(1500)), 1500);
    }

    #[test]
    fn a_refused_call_still_gets_exactly_one_result() {
        let call = AgentToolCall {
            id: "call-1".into(),
            name: "memory_write".into(),
            arguments: Some(r#"{"content":"事实"}"#.into()),
            tool_call_type: Some("function".into()),
        };

        let rejected = refused_result(&call, ApprovalState::Rejected, Some("不需要"));
        assert_eq!(rejected.tool_call_id, "call-1");
        assert_eq!(rejected.name, "memory_write");
        assert!(!rejected.ok, "被拒就是没执行，不能报成功");
        assert_eq!(rejected.error.as_deref(), Some("approval_rejected"));
        assert!(rejected.content.contains("不需要"), "{}", rejected.content);
        assert_eq!(
            rejected.awaiting_approval, None,
            "合成结果绝不能再带等待标记，否则下一步会再进一次闸门"
        );

        let expired = refused_result(&call, ApprovalState::Expired, None);
        assert_eq!(expired.error.as_deref(), Some("approval_expired"));
        assert_eq!(expired.tool_call_id, "call-1");
        assert!(expired.content.contains("超时"), "{}", expired.content);
    }

    #[test]
    fn decision_events_round_trip_with_the_approval_id() {
        let raw = r#"{"approvalID":"task-1:2:0","decision":"REJECTED","reason":"先别写"}"#;
        let event: ApprovalDecisionEvent = decode(raw).expect("decode");
        assert_eq!(event.approval_id, "task-1:2:0");
        assert_eq!(event.decision, ApprovalState::Rejected);
        assert_eq!(event.reason.as_deref(), Some("先别写"));

        // 理由是可省的：批准根本不需要理由。
        let approved: ApprovalDecisionEvent =
            decode(r#"{"approvalID":"task-1:2:0","decision":"APPROVED"}"#).expect("decode");
        assert_eq!(approved.reason, None);
    }

    #[test]
    fn tool_execution_activity_flattens_the_contract_body() {
        let activity = AgentToolExecutionActivity {
            traceparent: Some("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01".into()),
            request: AgentToolExecutionRequest {
                schema_version: INTERNAL_SCHEMA_VERSION,
                tenant_id: "t-1".into(),
                task_id: "task-1".into(),
                approval_id: "task-1:2:0".into(),
                embed_model: "text-embedding-3-small".into(),
                allowed_tools: vec!["memory_write".into()],
                tool_call: AgentToolCall {
                    id: "call-1".into(),
                    name: "memory_write".into(),
                    arguments: Some("{}".into()),
                    tool_call_type: Some("function".into()),
                },
            },
        };
        let json = encode(&activity).expect("encode");

        assert!(json.contains(r#""approvalID":"task-1:2:0""#), "{json}");
        assert!(json.contains(r#""tenantID":"t-1""#), "{json}");
        assert!(json.contains(r#""taskID":"task-1""#), "{json}");
        assert!(json.contains(r#""toolCall""#), "{json}");
        assert!(
            json.contains(r#""allowedTools":["memory_write"]"#),
            "{json}"
        );

        let parsed: AgentToolExecutionActivity = decode(&json).expect("decode");
        assert_eq!(parsed.request.approval_id, "task-1:2:0");
    }

    #[test]
    fn memory_activity_flattens_the_contract_body_and_keeps_the_trace() {
        let activity = AgentMemoryActivity {
            traceparent: Some("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01".into()),
            request: AgentMemoryRequest {
                schema_version: INTERNAL_SCHEMA_VERSION,
                tenant_id: "t-1".into(),
                task_id: "task-1".into(),
                objective: "总结".into(),
                answer: "结论".into(),
                steps: 3,
                tool_calls: 2,
                embed_model: "text-embedding-3-small".into(),
            },
        };
        let json = encode(&activity).expect("encode");

        // 摊平后就是「多带一个 traceparent 的记忆请求」：活动输入是 cogito 自己的载荷，
        // 下游只看 request 部分，所以这里的字段名必须与契约逐字一致。
        assert!(json.contains(r#""tenantID":"t-1""#), "{json}");
        assert!(json.contains(r#""taskID":"task-1""#), "{json}");
        assert!(json.contains(r#""toolCalls":2"#), "{json}");
        assert!(json.contains(r#""embedModel""#), "{json}");

        let parsed: AgentMemoryActivity = decode(&json).expect("decode");
        assert_eq!(parsed.request.steps, 3);
    }
}
