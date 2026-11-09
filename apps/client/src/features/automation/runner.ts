/**
 * 定时任务的执行侧（前端）：收到 `automation:due` 就起正式会话跑 prompt，跑完回写结果。
 *
 * 为什么执行在前端：会话挂在 WebView 侧的 goose ACP 连接上，Rust 侧拿不到模型通道。
 * 因此 `owner=client` 的语义是「应用开着才执行」，worker 只负责 claim + 通知。
 *
 * 会话会落库（`agent_session` id = `automation-<runId>`），进侧栏「自动化」分组，
 * 跑完保留，可回看；不再「跑完即弃」。
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { LOCAL_FORMAT } from '@cogito/chat/adapters/thread-history'
import { v4 as UUIDV4 } from 'uuid'

import { ensureBackgroundTurn, followBackgroundTurn } from '@/features/agent/acp/background-turn'
import {
  closeThreadSession,
  respondToApproval,
  respondToElicitation,
  runThreadPrompt
} from '@/features/agent/acp/session'
import { markRunFinished, markRunStarted } from '@/features/agent/acp/run-state'
import { parseAcpStreamEvent } from '@/features/agent/acp/stream'
import { prepareTarget } from '@/features/agent/acp/target-guard'
import { clearApprovalModeFor, writeApprovalModeFor } from '@/features/agent/approval'
import { advanceGoal, beginGoalTurn, findGoalSignal, startGoalRun } from '@/features/agent/goal-run'
import { writeAgentModeFor } from '@/features/agent/mode'
import { notifyAutomationRun } from '@/features/agent/notify'
import { readPlanFile } from '@/features/agent/plan-file'
import { historyPort } from '@/features/agent/port/instance'
import { buildModelPort } from '@/features/agent/port/model'
import { buildBoundPlanPrompt, findBoundPlanTarget } from '@/features/automation/bound-plan'
import {
  listPickableSessions,
  useAutomationSessionPicker
} from '@/features/automation/session-picker'
import {
  THREAD_PREFIX,
  notifyAutomationSession,
  publishAutomationLife
} from '@/features/automation/events'
import {
  findAutomationSystemPrompt,
  findInitialPhase,
  parseAutomationApproval,
  PLAN_THEN_GOAL_BRIDGE,
  shouldApprove,
  shouldContinueToGoal,
  summarizeRunOutput,
  type AutomationApproval,
  type RunCounters
} from '@/features/automation/run-plan'
import { finishAutomationRun, patchAutomationRun, touchAutomationRun } from '@/lib/automation-ipc'
import { EVENTS } from '@/shared/ipc/channels'
import {
  AutomationDueSchema,
  type AutomationDue,
  type AutomationMode
} from '@/shared/ipc/specs/automation'
import { useAgentStore } from '@/stores/agent.ts'
import { useProviderStore } from '@/stores/provider'
import { reportCaught } from '@/utils/exception-report'

/** 长跑心跳：防止排队/挂死后 30 分钟收尸误伤仍在推进的任务 */
const HEARTBEAT_MS = 5 * 60 * 1000

function makeBlockID(): (messageId: string | null | undefined, kind: string) => string {
  return function (messageId, kind) {
    return `${kind}:${messageId ?? 'run'}`
  }
}

function findThreadID(runId: string): string {
  return `${THREAD_PREFIX}${runId}`
}

/** 任务工作目录绝对路径：显式目录优先，其次工作区里第一个可用目录；都没有则 null */
async function findWorkspacePath(
  workspaceId: string | null,
  workspacePath: string | null
): Promise<string | null> {
  // 一个工作区可以挂多个目录：任务里选了哪个就用哪个，不要退回「第一个可用目录」
  const explicit = workspacePath?.trim()
  if (explicit) return explicit
  if (!workspaceId) return null
  const folders = await useAgentStore.getState().toReadWorkspaceFolders()
  const found = folders.find(function (item) {
    return item.workspaceID === workspaceId && item.path
  })
  return found?.path ?? null
}

/**
 * 确认工作目录可用（fail-closed）；返回绝对路径，无目录时 null。
 *
 * 返回值同时要传给 `runThreadPrompt` 作为会话 cwd：只拿它读计划文件、执行仍按
 * 「工作区第一个目录」起会话的话，用户在表单里选的目录就白选了。
 */
async function requireWorkspace(
  workspaceId: string | null,
  workspacePath: string | null,
  approval: AutomationApproval
): Promise<string | null> {
  if (!workspaceId && !workspacePath?.trim()) {
    if (shouldApprove(approval)) {
      throw new Error('任务没有指定工作目录，不能自动批准执行')
    }
    return null
  }
  const path = await findWorkspacePath(workspaceId, workspacePath)
  if (!path) {
    throw new Error(
      `任务的工作目录已不可用（工作区可能已被删除或未加载，id=${workspaceId}），请到任务表单重新指定`
    )
  }
  return path
}

/** 一次执行落在哪个会话上 */
interface SessionTarget {
  threadID: string
  /** 会话归属工作区（决定 cwd 与侧栏分组） */
  workspaceID: string | null
  /** true = 复用已有对话：不建记录会话、不覆盖会话自己的 cwd */
  bound: boolean
}

/** 读库里那条会话；不存在就报可操作错误（绑定关系已经失效） */
async function findBoundSession(sessionId: string | null): Promise<SessionTarget> {
  const id = sessionId?.trim()
  if (!id) throw new Error('任务绑定了固定对话但没有记录会话 id，请到任务表单重新选择')
  try {
    await useAgentStore.getState().toReadSessions()
  } catch (error) {
    console.warn('[agent.automation] 读取会话列表失败，按当前快照处理:', error)
  }
  const session = useAgentStore.getState().sessions.find(function (item) {
    return item.id === id
  })
  if (!session) {
    throw new Error(`任务绑定的对话已不存在（id=${id}），请到任务表单重新选择`)
  }
  return { threadID: session.id, workspaceID: session.workspaceID ?? null, bound: true }
}

/**
 * 决定这次执行写进哪个会话。
 *
 * - `new`（缺省）：`automation-<runId>`，跑完留在侧栏对应工作区分组里
 * - `fixed`：直接写进绑定的对话（上下文、标题都保持原样）
 * - `ask`：到点先问一句；没人答就按新建，别把这一轮排期卡死
 */
async function resolveSessionTarget(due: AutomationDue): Promise<SessionTarget> {
  const mode = due.sessionMode ?? 'new'
  if (mode === 'fixed') return findBoundSession(due.sessionId ?? null)
  if (mode === 'ask') {
    const choice = await useAutomationSessionPicker.getState().ask({
      taskName: due.name,
      sessions: await listPickableSessions()
    })
    if (choice) return findBoundSession(choice)
  }
  return {
    threadID: findThreadID(due.runId),
    workspaceID: due.workspaceId ?? null,
    bound: false
  }
}

/**
 * 读绑定计划并拼执行提示词；文件缺失/路径错直接抛错，让 run finish 失败。
 */
async function fetchBoundPlanPrompt(
  due: AutomationDue,
  budget: number,
  root: string,
  mode: AutomationMode
): Promise<string> {
  const relative = due.planFilePath?.trim()
  if (!relative) throw new Error('任务未绑定计划文件')
  let plan
  try {
    plan = await readPlanFile(root, relative)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`读取绑定计划失败（${relative}）：${detail}`)
  }
  return buildBoundPlanPrompt({
    body: plan.body,
    overview: plan.overview,
    filePath: plan.filePath,
    note: due.prompt,
    mode,
    budget
  })
}

/** 落库正式会话；已存在则复用（同 runId 重入不应再建） */
async function ensureAutomationSession(
  runId: string,
  name: string,
  workspaceId: string | null,
  providerId: string | null
): Promise<string> {
  const threadID = findThreadID(runId)
  await useAgentStore.getState().toReadSessions()
  const existing = useAgentStore.getState().sessions.find(function (item) {
    return item.id === threadID
  })
  if (existing) {
    notifyAutomationSession(threadID)
    return threadID
  }
  const now = Date.now()
  await useAgentStore.getState().toWriteSession([
    {
      id: threadID,
      title: name,
      pinned: false,
      providerID: providerId,
      workspaceID: workspaceId,
      createdAt: now,
      updatedAt: now,
      // 自动跑出来的会话也先进「已读」：未读由「跑完时用户没看着」补上
      unread: false
    }
  ])
  notifyAutomationSession(threadID)
  return threadID
}

async function appendChatMessage(
  threadID: string,
  role: 'user' | 'assistant',
  text: string
): Promise<void> {
  try {
    const rows = await historyPort.findMessages({ threadID })
    const parentID = rows.length > 0 ? rows[rows.length - 1].id : null
    await historyPort.appendMessage({
      threadID,
      id: UUIDV4(),
      parentID,
      format: LOCAL_FORMAT,
      content: JSON.stringify({
        role,
        content: [{ type: 'text', text }],
        createdAt: new Date().toISOString()
      })
    })
  } catch (error) {
    reportCaught('agent.automation.appendMessage', error, role === 'user' ? 'error' : 'warning')
    // 用户消息落库失败必须 fail-closed：否则会话里看不见指令，却以为「没发给 agent」
    if (role === 'user') {
      throw error instanceof Error ? error : new Error(String(error))
    }
  }
}

/**
 * 本地 provider 行 id → goose 认的 providerId（`kind`）。
 * 与 `port/model.ts` 同口径：会话归属存 id，发起运行再换成 kind。
 */
function findGooseProviderID(localProviderID: string): string {
  const provider = useProviderStore.getState().providers.find(function (item) {
    return item.id === localProviderID
  })
  if (!provider) {
    throw new Error('选中的模型供应商已不存在，请到设置里重新选择')
  }
  return provider.kind
}

/**
 * 助手正文落库：若 UI resume 已写过末条 assistant，跳过，避免双写。
 */
async function appendAssistantUnlessPresent(threadID: string, text: string): Promise<void> {
  if (!text.trim()) return
  try {
    const rows = await historyPort.findMessages({ threadID })
    const last = rows[rows.length - 1]
    if (last?.format === LOCAL_FORMAT) {
      try {
        const payload = JSON.parse(last.content) as { role?: string }
        if (payload.role === 'assistant') return
      } catch (error) {
        console.warn('[agent.automation] 解码末条历史失败:', error)
      }
    }
  } catch (error) {
    reportCaught('agent.automation.findMessages', error, 'warning')
  }
  await appendChatMessage(threadID, 'assistant', text)
}

interface PromptTarget {
  providerID: string
  model: string
}

interface RunPromptInput {
  threadID: string
  text: string
  systemText: string
  workspaceID: string | null
  /** 本次运行的 cwd（任务里选的目录）；null = 按工作区默认目录 */
  cwd: string | null
  target: PromptTarget
  approval: AutomationApproval
  counters: RunCounters
}

interface PromptStreamHost {
  automationId: string
  runId: string
  phase: AutomationMode
}

/**
 * 跑一轮 ACP prompt，攒正文；审批按档位自动应答。
 *
 * 走后台回合泵（与普通聊天同源）：`ensureBackgroundTurn` 后 UI 才能
 * `hasRunningBackgroundTurn` → resume 流式。直接 `runThreadPrompt` 只会在
 * 跑完落库，打开会话只能看到用户消息。
 */
async function runOnePrompt(
  input: RunPromptInput,
  streamHost: PromptStreamHost | null
): Promise<string> {
  const blockID = makeBlockID()
  const approvalShouldPass = shouldApprove(input.approval)
  let content = ''

  async function* start(cancelSignal: AbortSignal) {
    // goose setConfigOption 认 kind；prepareTarget / agent_session 仍用本地行 id
    const gooseProviderID = findGooseProviderID(input.target.providerID)
    try {
      for await (const item of runThreadPrompt(input.threadID, {
        text: input.text,
        systemText: input.systemText,
        workspaceID: input.workspaceID,
        cwd: input.cwd,
        providerID: gooseProviderID,
        modelID: input.target.model,
        signal: cancelSignal
      })) {
        if (item.kind === 'update') {
          const parsed = parseAcpStreamEvent(item.update, { blockID })
          if (parsed) yield parsed
          continue
        }
        if (item.kind === 'approval') {
          if (item.event.kind === 'tool-approval-request') {
            if (approvalShouldPass) input.counters.granted += 1
            else input.counters.denied += 1
            respondToApproval({
              toolCallId: item.event.toolCallId,
              approved: approvalShouldPass
            })
          }
          continue
        }
        if (item.kind === 'elicitation') {
          if (item.event.kind === 'elicitation-request') {
            respondToElicitation({
              elicitationId: item.event.elicitationId,
              action: 'cancel'
            })
          }
          continue
        }
        if (item.kind === 'stop') {
          yield item.stopReason === 'cancelled'
            ? { kind: 'aborted' as const, usage: {} }
            : { kind: 'finish' as const, finishReason: item.stopReason, usage: {} }
          return
        }
      }
    } catch (error) {
      reportCaught('agent.automation.prompt', error)
      yield {
        kind: 'error' as const,
        message: error instanceof Error ? error.message : String(error),
        usage: {}
      }
    }
  }

  await ensureBackgroundTurn(input.threadID, start)
  if (streamHost) {
    publishAutomationLife({
      kind: 'stream',
      automationId: streamHost.automationId,
      runId: streamHost.runId,
      sessionId: input.threadID,
      phase: streamHost.phase
    })
  }

  for await (const event of followBackgroundTurn(input.threadID, undefined)) {
    if (event.kind === 'text') content += event.text
    if (event.kind === 'error') throw new Error(event.message)
  }
  return content
}

async function runAgentOrPlanPhase(input: {
  threadID: string
  prompt: string
  phase: 'agent' | 'plan'
  approval: AutomationApproval
  workspaceId: string | null
  /** 显式目录（任务里选的）；null = 按工作区默认目录 */
  cwd: string | null
  target: PromptTarget
  counters: RunCounters
  streamHost: PromptStreamHost
}): Promise<string> {
  // 计划阶段强制只读：流水线第一段不该动手改文件
  const effectiveApproval: AutomationApproval = input.phase === 'plan' ? 'readonly' : input.approval
  writeApprovalModeFor(input.threadID, effectiveApproval)
  await writeAgentModeFor(input.threadID, input.phase)
  await appendChatMessage(input.threadID, 'user', input.prompt)
  const content = await runOnePrompt(
    {
      threadID: input.threadID,
      text: input.prompt,
      systemText: findAutomationSystemPrompt(effectiveApproval, input.phase),
      workspaceID: input.workspaceId,
      cwd: input.cwd,
      target: input.target,
      approval: effectiveApproval,
      counters: input.counters
    },
    { ...input.streamHost, phase: input.phase }
  )
  await appendAssistantUnlessPresent(input.threadID, content)
  return content
}

async function runGoalPhase(input: {
  threadID: string
  prompt: string
  budget: number
  approval: AutomationApproval
  workspaceId: string | null
  /** 显式目录（任务里选的）；null = 按工作区默认目录 */
  cwd: string | null
  target: PromptTarget
  counters: RunCounters
  streamHost: PromptStreamHost
}): Promise<string> {
  writeApprovalModeFor(input.threadID, input.approval)
  await writeAgentModeFor(input.threadID, 'goal')
  const summary = input.prompt.slice(0, 120)
  startGoalRun(input.threadID, { summary, detail: input.prompt }, input.budget, input.prompt)
  await appendChatMessage(input.threadID, 'user', input.prompt)

  let nextPrompt = input.prompt
  let lastContent = ''
  let turns = 0
  while (turns < input.budget + 1) {
    turns += 1
    beginGoalTurn(input.threadID)
    lastContent = await runOnePrompt(
      {
        threadID: input.threadID,
        text: nextPrompt,
        systemText: findAutomationSystemPrompt(input.approval, 'goal'),
        workspaceID: input.workspaceId,
        cwd: input.cwd,
        target: input.target,
        approval: input.approval,
        counters: input.counters
      },
      // 每轮都发 stream：新泵起来后 UI 要 reload/resume，不能只首轮切一次
      { ...input.streamHost, phase: 'goal' }
    )
    await appendAssistantUnlessPresent(input.threadID, lastContent)

    // 无人值守：没有收尾标记就继续推，直到 GOAL_DONE 或预算耗尽
    const signal = findGoalSignal(lastContent)
    const reason = signal === 'done' ? 'done' : 'continue'
    const outcome = advanceGoal(input.threadID, reason)
    if (outcome.kind !== 'dispatch') break
    nextPrompt = outcome.prompt
    await appendChatMessage(input.threadID, 'user', nextPrompt)
  }
  return lastContent
}

async function resolveTarget(due: AutomationDue): Promise<PromptTarget> {
  if (due.providerId && due.modelId) {
    return { providerID: due.providerId, model: due.modelId }
  }
  const target = await buildModelPort().findTarget()
  if (!target) throw new Error('还没有可用的模型，请先到设置里选择供应商与模型')
  return { providerID: target.providerID, model: target.model }
}

async function execute(due: AutomationDue): Promise<void> {
  // 绑定会话时 threadID 由任务决定（「执行前选择」还要先问人），先留兜底值给报错路径
  let threadID = findThreadID(due.runId)
  const approval = parseAutomationApproval(due.approval)
  const counters: RunCounters = { denied: 0, granted: 0 }
  const hasBoundPlan = Boolean(due.planFilePath?.trim())
  // 绑定计划与现场「计划后执行」互斥：有绑定时一律跳过流水线
  const planThenGoal = hasBoundPlan ? false : Boolean(due.planThenGoal)
  const configured = due.mode ?? 'agent'
  const mode: AutomationMode = hasBoundPlan ? findBoundPlanTarget(configured) : configured
  const budget = due.goalBudget === 3 || due.goalBudget === 12 ? due.goalBudget : 6
  let phase = findInitialPhase(planThenGoal, mode)
  let heartbeat: ReturnType<typeof setInterval> | null = null
  const chunks: string[] = []

  try {
    // 1) 先定会话：固定对话直接用；「执行前选择」在这里问一次（超时 / 关掉都按新建）
    const session = await resolveSessionTarget(due)
    threadID = session.threadID
    publishAutomationLife({
      kind: 'start',
      automationId: due.automationId,
      runId: due.runId,
      sessionId: threadID,
      phase
    })
    markRunStarted(threadID)

    // 2) 只有新建会话才按任务的工作区 / 目录起 cwd；绑定的对话沿用会话自己的目录
    const cwd = session.bound
      ? null
      : await requireWorkspace(due.workspaceId ?? null, due.workspacePath ?? null, approval)
    await touchAutomationRun(due.runId)
    heartbeat = setInterval(function () {
      void touchAutomationRun(due.runId).catch(function (error) {
        reportCaught('agent.automation.heartbeat', error, 'warning')
      })
    }, HEARTBEAT_MS)

    const target = await resolveTarget(due)
    await prepareTarget(target.providerID, target.model, 'agent.automation')

    // 绑定已有对话时不建记录会话：那条会话本来就在侧栏里，标题也不该被任务改名
    if (!session.bound) {
      await ensureAutomationSession(due.runId, due.name, session.workspaceID, target.providerID)
    }
    await patchAutomationRun({ runId: due.runId, sessionId: threadID, phase })

    async function runPhase(current: AutomationMode, prompt: string): Promise<string> {
      phase = current
      await patchAutomationRun({ runId: due.runId, phase: current })
      publishAutomationLife({
        kind: 'phase',
        automationId: due.automationId,
        runId: due.runId,
        sessionId: threadID,
        phase: current
      })
      const streamHost: PromptStreamHost = {
        automationId: due.automationId,
        runId: due.runId,
        phase: current
      }
      if (current === 'goal') {
        return runGoalPhase({
          threadID,
          prompt,
          budget,
          approval,
          workspaceId: session.workspaceID,
          cwd,
          target,
          counters,
          streamHost
        })
      }
      return runAgentOrPlanPhase({
        threadID,
        prompt,
        phase: current === 'plan' ? 'plan' : 'agent',
        approval,
        workspaceId: session.workspaceID,
        cwd,
        target,
        counters,
        streamHost
      })
    }

    let promptText = due.prompt
    if (hasBoundPlan) {
      if (!cwd) {
        throw new Error('绑定计划需要有效工作目录，请到任务表单重新指定')
      }
      promptText = await fetchBoundPlanPrompt(due, budget, cwd, mode)
    }
    const first = await runPhase(phase, promptText)
    chunks.push(first)

    if (shouldContinueToGoal(planThenGoal, phase)) {
      const bridge = [
        PLAN_THEN_GOAL_BRIDGE,
        '',
        '## 计划',
        first.trim() || '（计划阶段没有产出正文，请根据原始指令推进）',
        '',
        '## 原始指令',
        due.prompt
      ].join('\n')
      const second = await runPhase('goal', bridge)
      chunks.push(second)
    }

    const output = summarizeRunOutput(
      chunks.filter(Boolean).join('\n\n---\n\n'),
      counters,
      approval
    )
    await finishAutomationRun({ runId: due.runId, output })
    await notifyAutomationRun(due.name, true, null)
    publishAutomationLife({
      kind: 'finish',
      automationId: due.automationId,
      runId: due.runId,
      sessionId: threadID,
      ok: true
    })
  } catch (error) {
    reportCaught('agent.automation.run', error)
    const message = error instanceof Error ? error.message : String(error)
    try {
      await finishAutomationRun({ runId: due.runId, error: message })
    } catch (inner) {
      reportCaught('agent.automation.finish', inner)
    }
    await notifyAutomationRun(due.name, false, message)
    publishAutomationLife({
      kind: 'finish',
      automationId: due.automationId,
      runId: due.runId,
      sessionId: threadID,
      ok: false,
      error: message
    })
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    clearApprovalModeFor(threadID)
    markRunFinished(threadID)
    // 保留 agent_session + 消息；只释放 ACP 租约。
    // closeThreadSession 内部若仍有 run 会自行跳过；这里不再抢关后台泵未收尾的会话。
    try {
      closeThreadSession(threadID)
    } catch (error) {
      reportCaught('agent.automation.closeSession', error, 'warning')
    }
  }
}

/** 串行队列：同时拉起多个会话既抢模型配额，也让日志无法对应 */
let chain: Promise<void> = Promise.resolve()

/**
 * 跑一次（定时触发与「立即执行」共用）：排队后再执行，避免两个会话抢配额。
 */
function runDue(due: AutomationDue): Promise<void> {
  const next = chain.then(function () {
    return execute(due)
  })
  chain = next.catch(function () {
    return undefined
  })
  return next
}

function enqueue(due: AutomationDue): void {
  void runDue(due)
}

/**
 * 安装事件监听。返回取消监听的函数（组件卸载时调用）。
 */
async function installAutomationRunner(): Promise<UnlistenFn> {
  return listen(EVENTS.AUTOMATION_DUE, function (event) {
    const parsed = AutomationDueSchema.safeParse(event.payload)
    if (!parsed.success) {
      reportCaught('agent.automation.payload', parsed.error, 'warning')
      return
    }
    enqueue(parsed.data)
  })
}

export { findThreadID, installAutomationRunner, runDue }
