/**
 * 会话控制器（agentd 版）：一个 UI 会话（thread）对应 agentd 的一个 thread。
 *
 * ## 与旧实现的根本差别
 *
 * 旧版在 WebView 里直连 goose 的 wss ACP：会话、连接、票据、终态全在渲染进程里维护，
 * 于是要处理「连接断了 / 旧轮没停 / 终态迟到 / load 之后不再推 stop」这类问题。
 * 现在 agentd 持有会话与图，前端只做三件事：
 *
 * 1. 把一轮 prompt 发出去（`POST /threads/:id/runs`，202 即返回）；
 * 2. 订阅会话事件流（`GET /threads/:id/events?after=<seq>`），翻译成 `ThreadRunItem`；
 * 3. 把用户的回执投回去（`POST /threads/:id/approvals/:requestId`）。
 *
 * ## 保留不变的部分
 *
 * - **审批业务规则在前端**：计划模式 / 只读档拒绝写工具、目标模式在自动审批下放行。
 *   规则命中「拒绝 / 自动放行」时**不往 UI 推审批卡**（见 `handleApproval`）——
 *   事件已经发出去了，若再推一次会让卡片闪一下。
 * - **MCP 注入**：`session/new` 的名单仍在渲染进程算（要读 sidecar / bridge 的路径），
 *   随 run input 交给 agentd。
 * - `ThreadRunItem` 的形状一字未改，所以 `port/model.ts` 与 `parseAcpStreamEvent` 不用动。
 */

import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate
} from '@agentclientprotocol/sdk'

import { listen } from '@tauri-apps/api/event'
import { homeDir } from '@tauri-apps/api/path'
import { exists } from '@tauri-apps/plugin-fs'

import {
  createApprovalLedger,
  createElicitationRegistry,
  postApproval,
  postElicitation
} from '@cogito/agent-runtime/agentd/approvals'
import { GET_AGENTD_READY, POST_BRIDGE_INFO } from '@/apis/agent-runtime'
import { GET_SIDECAR_STATUS } from '@/apis/directive'
import { AGENTD_ROUTES } from '@cogito/agent-runtime/agentd/runs'
import type {
  AgentdApprovalTicket,
  AgentdElicitationPayload
} from '@cogito/agent-runtime/agentd/runs'
import { humanizeRunError } from '@cogito/agent-runtime/agentd/run-error'
import { pumpTurn, runTurn, TurnFailure } from '@cogito/agent-runtime/agentd/turn'
import type { TurnCursor, TurnItem, TurnSyncInfo } from '@cogito/agent-runtime/agentd/turn'
import type { ChatElicitationResponse, ChatStreamEvent, ChatToolApproval } from '@cogito/chat/ports'

import {
  parseAcpApprovalRequest,
  parseAcpElicitationRequest,
  parseAcpElicitationResponse,
  parseAcpStreamEvent
} from '@/features/agent/acp/stream'
import type { AcpStreamContext } from '@/features/agent/acp/stream'
import { writeGooseUsage } from '@/features/agent/acp/goose-usage'
import { POST_ACP_BINDING, recallBinding } from '@/features/agent/acp/session-binding'
import { callAgentd, callAgentdJson, agentdTransport, invokeGoose } from './agentd-rpc'
import { clearAcpHandle } from './agentd-connection'
import { abortAllBackgroundTurns } from '@/features/agent/acp/background-turn'
import { clearRunState } from '@/features/agent/acp/run-state'
import {
  clearSentSystemText,
  forgetSentSystemText,
  rememberSentSystemText
} from '@/features/agent/sent-system-text'
import { pickWorkspaceCwd } from '@/features/agent/acp/workspace-cwd'
import { decideApprovalForThread } from '@/features/agent/approval-decision'
import { findRunGooseMode } from '@/features/agent/effective-approval'
import { findModelKey, findModelPref } from '@/features/agent/model/model-prefs'
import { recordThinkingApplied } from '@/features/agent/model/thinking-capability'
import { resolveThinkingValue } from '@/features/agent/model/thinking-effort-map'
import { toGooseTemperature } from '@/features/agent/model/tuning'
import { readThinkingLevelFor } from '@/features/agent/thinking-level'
import type { AgentMode, ThinkingLevel } from '@/features/persist'
import { findPref } from '@/features/persist'
import { EVENTS } from '@/shared/ipc/channels'
import { BridgeInfoSchema } from '@/shared/ipc/specs/bridge'
import type { AgentdStatus } from '@/shared/ipc/specs/agentdStatus'

import { useAgentStore } from '@/stores/agent'
import { reportCaught } from '@/utils/exception-report'
import { readWikiApiConfig } from '@/views/knowledge/lib/wiki-api-config.ts'

/** ACP stdio MCP 条目（与 SDK 的 McpServer 同形） */
interface AcpMcpServer {
  name: string
  command: string
  args: string[]
  env: Array<{ name: string; value: string }>
}

/**
 * 一轮 prompt 的产出。
 *
 * `update` 是**原始** ACP 通知（映射成什么由调用方决定：新路径走 `stream.ts` 映射表，
 * 旧路径仍用自己的归一化）；`approval` / `elicitation` 已经带上 UI 要的形态，
 * 同时留着原始 params 给「自绘对话框」这类消费者。
 */
type ThreadRunItem =
  | { kind: 'update'; update: SessionUpdate }
  /**
   * 补历史重放（`session/load`）：`update` 形状与 `update` 项相同，但正文是每条消息的
   * **完整**文本 —— 调用方必须用 `{ ...context, replace: true }` 映射，否则正文翻倍。
   */
  | { kind: 'replay'; update: SessionUpdate }
  | { kind: 'approval'; event: ChatStreamEvent; params: RequestPermissionRequest }
  | { kind: 'elicitation'; event: ChatStreamEvent; params: CreateElicitationRequest }
  /**
   * 已经解析好的共享事件（不经 ACP 映射表）。
   *
   * 目前只有一处：审批回执落地后的 `tool-approval-settled`。它必须**立刻**到 UI，
   * 否则消息要等到 `tool-result` 才离开 requires-action，而工具可能跑几分钟。
   */
  | { kind: 'event'; event: ChatStreamEvent }
  | { kind: 'stop'; stopReason: string }

/** 正在跑的那一轮（本地侧只需要「能取消」与「能塞事件」）。 */
interface LiveRun {
  controller: AbortController
  /** 把「已拍板」立刻塞回这一轮的事件流（票据属于哪一轮，就塞哪一轮） */
  inject: (item: TurnItem) => void
}

interface ThreadSession {
  threadID: string
  /** agentd 里的 goose session id（首轮跑完从 `/threads/:id/state` 读回） */
  sessionID: string | null
  MCPServers: AcpMcpServer[]
  run: LiveRun | null
  /**
   * 这一轮的模式（消息快照算出来的）。
   *
   * 恢复订阅时只能用**当初那一轮**的模式：用户中途切了档，按现在的档判定会把
   * 正在跑的这轮审批成拒绝（F-013）。跑完清空。
   */
  agentMode: AgentMode | null
  /** 事件流游标：断线重连 / 恢复时从这里续读 */
  lastSeq: number
  /** 事件流所属的 agentd 进程；与 sync 不同说明 agentd 重启过，游标必须丢弃 */
  epoch: string | null
}

const READY_TIMEOUT_MS = 30_000
const READY_FALLBACK_POLL_MS = 1_000
// 一轮的空闲上限已经搬进 `@cogito/agent-runtime/agentd/turn`（两端共用同一份）

const sessionByThread = new Map<string, ThreadSession>()
/** 每个 thread 的事件流序号（恢复订阅时用来续读） */
const seqByThread = new Map<string, number>()

/**
 * 审批票据与已拍板结果：与浏览器扩展共用同一份实现。
 *
 * 票据必须带 `threadID` —— 用户点审批时当前会话可能已经切走了（见 `respondToApproval`）。
 */
const approvalLedger = createApprovalLedger()
/** 待追问票据：回执只有 elicitationId，要靠它定位线程（与审批账本同层，故同生命周期） */
const pendingElicitations = createElicitationRegistry()

// ── 就绪状态 ────────────────────────────────────────────────────────────────

let agentdPhase: 'ready' | 'failed' | null = null
let agentdStatus: AgentdStatus | null = null
let statusSubscribed = false
const phaseWaiters = new Set<() => void>()

function notifyPhase(): void {
  const waiters = [...phaseWaiters]
  phaseWaiters.clear()
  for (const waiter of waiters) waiter()
}

function toAgentdStatus(payload: Record<string, unknown>): AgentdStatus | null {
  const state = payload.state
  if (state !== 'starting' && state !== 'ready' && state !== 'failed') return null
  const status: AgentdStatus = { state }
  if (typeof payload.readyMs === 'number') status.readyMs = payload.readyMs
  if (typeof payload.port === 'number') status.port = payload.port
  if (typeof payload.pid === 'number') status.pid = payload.pid
  if (typeof payload.restarts === 'number') status.restarts = payload.restarts
  if (typeof payload.reason === 'string') status.reason = payload.reason
  const goose = payload.goose
  if (goose === 'disabled' || goose === 'starting' || goose === 'ready' || goose === 'failed') {
    status.goose = goose
  }
  return status
}

async function subscribeStatus(): Promise<void> {
  if (statusSubscribed) return
  statusSubscribed = true
  try {
    await listen(EVENTS.AGENTD_STATUS, function (event) {
      const payload = (event.payload ?? {}) as Record<string, unknown>
      const status = toAgentdStatus(payload)
      if (!status) return
      agentdStatus = status
      agentdPhase = status.state === 'ready' ? 'ready' : status.state === 'failed' ? 'failed' : null
      if (status.state !== 'starting') notifyPhase()
    })
    await listen(EVENTS.AGENTD_NOT_READY, function () {
      // 宿主挂了：endpoint 与连接句柄都失效，会话表也失去了会话
      clearAcpHandle()
      agentdPhase = 'failed'
      agentdStatus = { state: 'failed', reason: 'agentd 未就绪' }
      for (const thread of sessionByThread.values()) thread.sessionID = null
      // 这一轮不会再有 `settled` 了。不主动收掉本地泵的话，侧栏会永远挂着「生成中」，
      // 而后台回合的 running 标记（内存 + localStorage + Rust）也一起僵在那里（F-021）。
      for (const thread of sessionByThread.values()) thread.run?.controller.abort()
      void abortAllBackgroundTurns().catch(function (error: unknown) {
        reportCaught('agent.session.abort-background', error, 'warning')
      })
      clearRunState()
      notifyPhase()
    })
  } catch (error) {
    // 监听注册失败不该让「发消息」直接失败；兜底轮询还在
    statusSubscribed = false
    reportCaught('agent.session.listen', error, 'warning')
  }
}

function waitForPhaseChange(ms: number): Promise<void> {
  return new Promise<void>(function (resolve) {
    const timer = setTimeout(function () {
      phaseWaiters.delete(onChange)
      resolve()
    }, ms)
    function onChange() {
      clearTimeout(timer)
      resolve()
    }
    phaseWaiters.add(onChange)
  })
}

/**
 * 等 agentd 就绪。
 *
 * 主路径是 `agentd://status` 事件（Rust 只在相位真的变化时发一次），命令轮询只用来兜住
 * 「事件早于订阅」这种时序缝隙 —— 冷启动时一页打几十次 IPC 的老毛病不要再来一遍。
 */
async function waitGooseReady(): Promise<void> {
  await subscribeStatus()
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (agentdPhase === 'ready') return
    if (agentdPhase === 'failed') {
      throw new Error(agentdStatus?.reason ?? 'agentd 启动失败')
    }
    const status = await GET_AGENTD_READY().catch(function () {
      return null
    })
    if (status === true) {
      agentdPhase = 'ready'
      return
    }
    if (status === false) {
      agentdPhase = 'failed'
      throw new Error('agentd 启动失败')
    }
    await waitForPhaseChange(READY_FALLBACK_POLL_MS)
  }
  throw new Error(`agentd 在 ${READY_TIMEOUT_MS / 1000}s 内未就绪`)
}

function readGooseStatus(): AgentdStatus | null {
  return agentdStatus
}

// ── 会话登记 ────────────────────────────────────────────────────────────────

function ensureRecord(threadID: string): ThreadSession {
  const existing = sessionByThread.get(threadID)
  if (existing) return existing
  // 刷新（WebView reload）后模块级的 `seqByThread` 是空的，但库里存着上一轮的游标。
  // 不读它，`runThreadPrompt` 会拿 `after=0` 去订阅 —— agentd 会把整段环形缓冲重放，
  // 里面**上一轮的 `settled` / `error` 事件会被当成本轮的终态**：新一轮立刻「结束」甚至报错。
  const bound = recallBinding(threadID)
  const record: ThreadSession = {
    threadID,
    // 会话 id 一并恢复：`bindSession` 每轮都写，库里就是最新值
    sessionID: bound?.acpSessionId ?? null,
    MCPServers: [],
    run: null,
    agentMode: null,
    lastSeq: seqByThread.get(threadID) ?? bound?.lastSeq ?? 0,
    // epoch 与 lastSeq 成对：跨进程（agentd 重启）不再比较 seq
    epoch: bound?.lastEpoch ?? null
  }
  sessionByThread.set(threadID, record)
  return record
}

function findThreadAcpSessionID(threadID: string): string | null {
  return sessionByThread.get(threadID.trim())?.sessionID ?? null
}

function hasThreadSession(threadID: string): boolean {
  const key = threadID.trim()
  if (!key) return false
  if (sessionByThread.get(key)?.sessionID) return true
  // 刷新 / 重开应用后内存表是空的，但库里存着上一轮的 ACP session id ——
  // 以前只看 `Map.has`，于是「有历史但没内存记录」的对话被当成「还没有会话」，
  // 压缩按钮点了只回一句「先发一条消息建立会话」。
  return Boolean(recallBinding(key)?.acpSessionId)
}

/**
 * 让 agentd 停掉这个线程上正在跑的那一轮。
 *
 * **只 abort 本地 SSE 是不够的**：agentd 的图还在跑、goose 还在执行工具、checkpoint 还在写。
 * UI 说「已停止」而进程还在动，是最难查的那类不一致。ACP 的 `session/cancel` 是唯一能真正
 * 收住长工具的信号。
 *
 * 幂等：没有活跃轮时 agentd 回 200（`{cancelled:false}`），重复调用无害。
 */
function requestThreadCancel(threadID: string): void {
  const key = threadID.trim()
  if (!key) return
  void callAgentd(AGENTD_ROUTES.cancel(key), { method: 'POST' }).catch(
    function (error: unknown) {
      reportCaught('agent.session.cancel', error, 'warning')
    }
  )
}

function clearThreadSessions(): void {
  for (const thread of sessionByThread.values()) {
    thread.run?.controller.abort()
    // 停全部也要告诉 agentd，否则被切走的会话会在后台继续跑完
    requestThreadCancel(thread.threadID)
  }
  sessionByThread.clear()
  seqByThread.clear()
  clearSentSystemText()
}

function closeThreadSession(threadID: string): void {
  const key = threadID.trim()
  const record = sessionByThread.get(key)
  if (!record) return
  record.run?.controller.abort()
  sessionByThread.delete(key)
  seqByThread.delete(key)
  forgetSentSystemText(key)
  // 没有活跃轮时 agentd 返回 200；网络失败也不该抛给调用方
  requestThreadCancel(key)
}

/** 幂等建线程：`thread_id` 就是本地会话 id，agentd 重启后仍能对上 checkpoint。 */
async function ensureThreadSession(threadID: string): Promise<ThreadSession> {
  const key = threadID.trim()
  if (!key) throw new Error('缺少会话 id')
  const record = ensureRecord(key)
  await callAgentdJson<{ thread_id: string }>(AGENTD_ROUTES.threads, {
    method: 'POST',
    body: JSON.stringify({ thread_id: key })
  })
  return record
}

/** 从图状态里补回 sessionId（首轮跑完 / 刷新后都能拿到）。 */
async function refreshSessionID(threadID: string): Promise<string | null> {
  const record = ensureRecord(threadID)
  try {
    const state = await callAgentdJson<{ values?: { sessionId?: unknown } }>(
      AGENTD_ROUTES.state(threadID)
    )
    const value = state.values?.sessionId
    record.sessionID = typeof value === 'string' && value ? value : null
    return record.sessionID
  } catch (error) {
    // 读不到状态就沿用本地记录：首轮刚建时 state 可能还是空的
    console.warn('[agent/session] 读取会话状态失败:', error)
    return record.sessionID
  }
}

// ── MCP 与 cwd ──────────────────────────────────────────────────────────────

function isCorexToolsEnabled(): boolean {
  try {
    if (import.meta.env.VITE_COREX_MCP === '0') return false
    if (findPref('agent').corexMcpTools === '0') return false
  } catch (error) {
    console.warn('[agent/session] 读取 corex-mcp 开关失败，按默认开启处理:', error)
  }
  return true
}

async function findCorexMcpServers(sessionID: string): Promise<AcpMcpServer[]> {
  if (!isCorexToolsEnabled()) return []
  try {
    const status = await GET_SIDECAR_STATUS()
    const command = status.mcpPath?.trim()
    const dataDir = status.dataDir?.trim()
    if (!command || !dataDir) {
      console.info('[agent/session] 未注入 corex-mcp：缺少 mcpPath 或 dataDir')
      return []
    }
    return [
      {
        name: 'corex',
        command,
        args: [],
        env: [
          { name: 'COREX_DATA_DIR', value: dataDir },
          { name: 'COREX_MCP_SESSION', value: `goose-acp:${sessionID}` }
        ]
      }
    ]
  } catch (error) {
    console.warn('[agent/session] 解析 corex-mcp 注入失败:', error)
    return []
  }
}

/**
 * 本地工具面 `cogito-mcp`：由 goose 按 env 拉起，所有调用再代理回 app 内的 loopback 桥。
 *
 * **server 名为什么是 `local` 而不是 `cogito`**：goose 用 `<server>__` 拼工具全名，
 * 叫 `cogito` 会得到 `cogito__cogito_workspace_read`。现在是 `local__cogito_workspace_read`。
 */
const LOCAL_SERVER_NAME = 'local'

async function findCogitoMcpServers(sessionID: string): Promise<AcpMcpServer[]> {
  try {
    if (!readWikiApiConfig().mcpEnabled) {
      console.info('[agent/session] 未注入 cogito-mcp：设置中已关闭 MCP 侧车')
      return []
    }
    const info = BridgeInfoSchema.parse(
      await POST_BRIDGE_INFO(`goose-acp:${sessionID}`)
    )
    const command = info.mcpPath.trim()
    if (!command || !info.url.trim() || !info.tokenFile.trim()) {
      console.info('[agent/session] 未注入 cogito-mcp：缺少 mcpPath 或桥信息')
      return []
    }
    return [
      {
        name: LOCAL_SERVER_NAME,
        command,
        args: [],
        env: [
          { name: 'COGITO_BRIDGE_URL', value: info.url },
          { name: 'COGITO_BRIDGE_TOKEN_FILE', value: info.tokenFile },
          { name: 'COGITO_SESSION_ID', value: `goose-acp:${sessionID}` }
        ]
      }
    ]
  } catch (error) {
    console.warn('[agent/session] 解析 cogito-mcp 注入失败:', error)
    return []
  }
}

async function findSessionMcpServers(threadID: string): Promise<AcpMcpServer[]> {
  return [...(await findCorexMcpServers(threadID)), ...(await findCogitoMcpServers(threadID))]
}

function readBuiltinMcpSwitches(): { local: boolean; corex: boolean } {
  let local = true
  try {
    local = readWikiApiConfig().mcpEnabled
  } catch (error) {
    console.warn('[agent/session] 读取本地工具面开关失败，按开启处理:', error)
  }
  return { local, corex: isCorexToolsEnabled() }
}

/**
 * 会话的工作目录：按**这个会话自己的工作区**取第一个文件夹，没有就退回用户家目录。
 *
 * 不能读全局「当前工作区」指针：多个会话可以同时跑，指针早就指向别人了。
 */
async function findWorkspaceCwd(
  workspaceID: string | null,
  workspacePath?: string | null
): Promise<string> {
  const explicit = workspacePath?.trim()
  if (explicit) {
    if ((await probeWorkspacePath(explicit)) === false) {
      throw new Error(`任务指定的目录已不存在：${explicit}。请到任务表单重新选择目录`)
    }
    return explicit
  }
  const state = useAgentStore.getState()
  const owned = workspaceID
    ? state.workspaceFolders.filter(function (item) {
        return item.workspaceID === workspaceID
      })
    : []
  return pickWorkspaceCwd(owned, probeWorkspacePath, homeDir)
}

async function probeWorkspacePath(path: string): Promise<boolean | null> {
  try {
    return await exists(path)
  } catch (error) {
    console.warn('[agent/session] 探测工作区目录失败，按「无法判断」处理:', path, error)
    return null
  }
}

// ── goose 配置（走白名单透传） ──────────────────────────────────────────────

const GOOSE_DEFAULTS_SAVE = '_goose/unstable/defaults/save'
const GOOSE_CONFIG_READ = '_goose/unstable/config/read'
const GOOSE_CONFIG_UPSERT = '_goose/unstable/config/upsert'
const CONFIG_TEMPERATURE = 'GOOSE_TEMPERATURE'
/** 自动压缩阈值：goose 侧读的就是这个全局键 */
const CONFIG_AUTO_COMPACT_THRESHOLD = 'GOOSE_AUTO_COMPACT_THRESHOLD'
/** Desktop 同款 0.8：占用到 80% 就压 */
const AUTO_COMPACT_THRESHOLD = 0.8
/** 思考强度：goose 全局键，枚举 off/low/medium/high/max（与 cogito 五档同名） */
const CONFIG_THINKING_EFFORT = 'GOOSE_THINKING_EFFORT'

/** 上一次写进 goose 全局键的值：没变就不重复 upsert */
let lastThinkingEffort: string | null = null

/**
 * 自动压缩阈值：没配过就写 Desktop 默认 0.8。
 *
 * `aside-context` 一直在告诉用户「达到阈值会自动压缩」，但那个阈值在本仓
 * **从未被写过**（`goose-providers.ts` 里的 `ensureAutoCompactThreshold` 没有调用方，
 * 且它依赖已经被移除的直连 ACP）。于是 goose 只能用它自己的默认值，界面上那句
 * 承诺与实际行为不对应。这里走 agentd 的白名单通道补一次，成功一次就不再写。
 */
let autoCompactEnsured = false
async function ensureGooseAutoCompact(): Promise<void> {
  if (autoCompactEnsured) return
  try {
    const current = await invokeGoose<{ value?: unknown } | null>(GOOSE_CONFIG_READ, {
      key: CONFIG_AUTO_COMPACT_THRESHOLD,
      isSecret: false
    })
    const value = typeof current?.value === 'number' ? current.value : 0
    if (!(value > 0 && value <= 1)) {
      await invokeGoose(GOOSE_CONFIG_UPSERT, {
        key: CONFIG_AUTO_COMPACT_THRESHOLD,
        value: AUTO_COMPACT_THRESHOLD,
        isSecret: false
      })
    }
    autoCompactEnsured = true
  } catch (error) {
    // 软参数：写不进去不影响这一轮，下一轮再试
    console.warn('[agent/session] 自动压缩阈值同步跳过:', error)
  }
}

/**
 * 温度写进 goose 全局配置（对新会话生效）。
 * 界面滑杆是 0–2，goose 只收 0–1 —— 钳制在 `toGooseTemperature` 里做。
 */
async function applyGooseTemperature(temperature: number): Promise<void> {
  try {
    await waitGooseReady()
    await invokeGoose(GOOSE_CONFIG_UPSERT, {
      key: CONFIG_TEMPERATURE,
      value: toGooseTemperature(temperature),
      isSecret: false
    })
  } catch (error) {
    console.warn('[agent/session] 温度同步跳过:', error)
  }
}

/**
 * 把某个模型的思考档位落到 goose。
 *
 * 两条路都要走，缺一条就会「界面变了、模型没变」：
 * - 全局键 `GOOSE_THINKING_EFFORT`（对**新**会话生效）；
 * - 已开会话 `configOptions` 里的 thinking 选择项（**本轮**就生效），并把可选值记进
 *   `thinking-capability` —— 那是「这个模型能调到哪几档」唯一的真凭据。
 *
 * 软参数不挡发送：失败只 warn 并返回 null。
 */
async function applyGooseThinking(
  threadID: string,
  providerID: string,
  modelID?: string | null,
  override?: ThinkingLevel | null
): Promise<string | null> {
  const model = modelID?.trim() ?? ''
  const key = findModelKey(providerID, model)
  try {
    const level =
      override ?? readThinkingLevelFor(threadID) ?? findModelPref(providerID, model).thinking
    await waitGooseReady()

    const record = sessionByThread.get(threadID.trim())
    const sessionId = record?.sessionID ?? null
    // 可选值目前只能靠「试一下」：goose 不会主动把 configOptions 推给我们，
    // 而为了读它去改一次 mode 是有副作用的错做法。拿不到就让 `resolveThinkingValue`
    // 按全局档位直出（那对新会话一定生效）。
    const available: string[] | null = null
    const dispatch = resolveThinkingValue(level, available)
    if (lastThinkingEffort !== level) {
      await invokeGoose(GOOSE_CONFIG_UPSERT, {
        key: CONFIG_THINKING_EFFORT,
        value: level,
        isSecret: false
      })
      lastThinkingEffort = level
    }
    // 会话内立刻生效：模型没有这个选项时 goose 会拒，按软参数处理（不拦发送）
    let sessionApplied = false
    if (sessionId) {
      try {
        await invokeGoose('session/set_config_option', {
          sessionId,
          configId: 'thinking_effort',
          value: dispatch.value
        })
        sessionApplied = true
      } catch (error) {
        console.info('[agent/session] 本会话不支持 thinking_effort，只写了全局键:', error)
      }
    }

    // 作用域只由「这一值到底写进了哪一层」决定：会话拒了还报 session，
    // 界面就会说「本轮已生效」，而实际只有下一轮（新会话）才会变。
    const applied = dispatch.matched ? dispatch.value : level
    recordThinkingApplied(key, applied, sessionApplied ? 'session' : 'global')
    return applied
  } catch (error) {
    console.warn('[agent/session] 思考强度同步跳过:', error)
    return null
  }
}

async function applyThinkingToOpenSessions(
  providerID: string,
  modelID?: string | null
): Promise<void> {
  const model = modelID?.trim() ?? ''
  const targets: string[] = []
  for (const thread of sessionByThread.values()) {
    // 会话表里没有 provider/model 缓存：按「全都推一遍」处理（幂等，且不会漏）
    targets.push(thread.threadID)
  }
  if (targets.length === 0) {
    await applyGooseThinking('', providerID, model)
    return
  }
  await Promise.all(
    targets.map(function (threadID) {
      return applyGooseThinking(threadID, providerID, model)
    })
  )
}

/** 切换 provider / model：写 goose defaults（对已开会话的切换在下一次 run 时随 mode 生效） */
async function switchGooseProviderModel(
  providerID: string,
  modelID: string | undefined
): Promise<void> {
  await waitGooseReady()
  try {
    await invokeGoose(GOOSE_DEFAULTS_SAVE, { providerId: providerID, modelId: modelID ?? null })
  } catch (error) {
    console.warn('[agent/session] defaultsSave 跳过:', error)
  }
}

/** 上一次已写进 defaults 的运行目标：同目标不重复写（写 defaults 对用户是可见副作用） */
let lastRunTarget = ''

/**
 * 把**本轮显式指定的** provider / model 落到 goose defaults。
 *
 * 为什么不是「发个参数给 agentd 就完了」：agentd 的 run input 里没有模型字段，goose 建会话
 * 时读的是自己的 defaults。内联改写 / 子代理 / 目标首轮这些场景**本轮就要新建会话**，
 * 不先写 defaults 就会用用户当前的默认模型 —— 调用方传进来的 provider 白传（F-014）。
 *
 * 已开的会话不会因此换模型（goose 的会话级 model 配置项还没接），这里只保证「这一轮
 * 要新建的会话」按指定目标创建。失败只 warn：模型是软参数，不挡发送。
 */
async function applyRunTarget(providerID: string, modelID?: string): Promise<void> {
  const provider = providerID.trim()
  if (!provider) return
  const model = modelID?.trim() ?? ''
  const key = `${provider}|${model}`
  if (key === lastRunTarget) return
  lastRunTarget = key
  await switchGooseProviderModel(provider, model || undefined)
}

// ── 审批规则 ────────────────────────────────────────────────────────────────

function resolveSessionMode(threadID: string, agentMode?: AgentMode): string {
  // 档位换算只有一份（`findRunGooseMode`）：问答 / 计划 → `approve`，执行跟审批档。
  // 以前这里手写过另一个版本（readonly → approve，而 policy 里写 smart_approve），
  // 两处一旦接反就会“选了只读，写工具还是弹审批卡让人点允许”。
  return findRunGooseMode(threadID, agentMode)
}

/** 补历史请求的最小间隔：同一 thread 反复刷新时不要每次都拉一遍完整历史 */
const REPLAY_THROTTLE_MS = 60_000
/** threadID → 上次发起补历史的时间 */
const replayRequestedAt = new Map<string, number>()

/**
 * 补历史：事件日志已淘汰（`sync.truncated`）时，让 agentd 把 goose 侧会话历史重放一遍
 * （R5-D3，见 `docs/decisions/agent-r5-hardening.md`）。
 *
 * 三条纪律：
 * 1. **不 await 结果**：它是旁路，调用方正在跑的轮次不能等它；
 * 2. **409 `run_active` 是正常情况**（自己这轮还在跑）：留一条诊断，等下一轮或刷新时再补；
 * 3. 重放事件回到**同一条 SSE**（`kind:'replay'`），映射时按 `replace` 覆盖正文，
 *    所以「补到了」这件事不需要额外通道。
 */
async function requestThreadReplay(threadID: string): Promise<void> {
  const key = threadID.trim()
  if (!key) return
  const now = Date.now()
  const last = replayRequestedAt.get(key) ?? 0
  if (now - last < REPLAY_THROTTLE_MS) return
  replayRequestedAt.set(key, now)
  try {
    const response = await agentdTransport.call(AGENTD_ROUTES.replay(key), { method: 'POST' })
    if (response.ok) return
    const detail = await response.text().catch(function () {
      return ''
    })
    reportCaught(
      'agent.session.replay',
      new Error(`补历史未完成：${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}`),
      'warning'
    )
  } catch (error) {
    reportCaught('agent.session.replay', error, 'warning')
  }
}

/** 这张追问表单我们渲染得了吗（只实现了 `form` 模式） */
function canRenderElicitation(request: AgentdElicitationPayload['elicitation']): boolean {
  return (
    parseAcpElicitationRequest({
      mode: 'form',
      sessionId: request.sessionId,
      requestedSchema: request.requestedSchema
    } as CreateElicitationRequest) !== null
  )
}

/** 协议层的审批票据 → UI 事件 + 原始 params（自绘对话框那种消费者要 params） */
function toApprovalItem(
  ticket: AgentdApprovalTicket
): Extract<ThreadRunItem, { kind: 'approval' }> {
  const params = {
    sessionId: ticket.sessionId,
    toolCall: ticket.toolCall,
    options: ticket.options
  } as unknown as RequestPermissionRequest
  return { kind: 'approval', event: parseAcpApprovalRequest(params), params }
}

/** 协议层的追问票据 → UI 事件；渲染不了就返回 null（状态机已经代发了 decline） */
function toElicitationItem(
  request: AgentdElicitationPayload['elicitation']
): Extract<ThreadRunItem, { kind: 'elicitation' }> | null {
  const params = {
    mode: 'form',
    sessionId: request.sessionId,
    requestedSchema: request.requestedSchema
  } as unknown as CreateElicitationRequest
  const parsed = parseAcpElicitationRequest(params)
  if (!parsed) return null
  return {
    kind: 'elicitation',
    event: {
      kind: 'elicitation-request',
      elicitationId: request.requestId,
      schema: parsed.schema,
      ...(parsed.prompt ? { prompt: parsed.prompt } : {})
    },
    params
  }
}

/** 待审批票据的账本与派生规则在 `@cogito/agent-runtime/agentd/approvals`（与扩展共用）。 */
function findApprovalState(toolCallId: string): 'pending' | boolean | null {
  return approvalLedger.findState(toolCallId)
}

async function settleRemoteApproval(
  threadID: string,
  requestId: string,
  optionId: string | null
): Promise<boolean> {
  const ok = await postApproval(agentdTransport, threadID, requestId, optionId)
  // 失败要进 client 的诊断通道：包里的 console.warn 在打包后的诊断页看不到
  if (!ok) {
    reportCaught('agent.session.approval', new Error(`审批回执投递失败：${requestId}`), 'warning')
  }
  return ok
}

/** 把追问回执写回 agentd；`action` 原样透传（accept 要带 content）。 */
async function settleRemoteElicitation(
  threadID: string,
  requestId: string,
  decision: CreateElicitationResponse
): Promise<boolean> {
  const ok = await postElicitation(agentdTransport, threadID, requestId, decision)
  if (!ok) {
    reportCaught('agent.session.elicitation', new Error(`追问回执投递失败：${requestId}`), 'warning')
  }
  return ok
}

/**
 * 回答一次审批（UI → 端口 → agentd）。
 *
 * 按**票据 id** 定位而不是「当前线程」：端口与工具卡是两个组件树分支，而一个会话可能
 * 在后台继续跑（那时「当前」已经是别人了）。找不到票据就返回 `false`，调用方据此如实
 * 告诉用户「已失效」，而不是假报成功。
 */
function respondToApproval(approval: ChatToolApproval): boolean {
  const taken = approvalLedger.take(approval.toolCallId, {
    approved: approval.approved,
    optionId: approval.optionId ?? null
  })
  if (!taken) return false
  // 立刻把「已拍板」推回事件流：否则消息要等到 `tool-result` 才离开 requires-action，
  // 而工具可能跑几分钟 —— 用户看到的就是「点了审批没反应」。
  // 注入到**票据所属的线程**（可能就是后台那个），不是「当前会话」。
  sessionByThread.get(taken.ticket.threadID)?.run?.inject({
    kind: 'approval_settled',
    toolCallId: approval.toolCallId,
    approved: taken.approved
  })
  void settleRemoteApproval(taken.ticket.threadID, taken.ticket.requestId, taken.optionId)
  return true
}

function respondToElicitation(response: ChatElicitationResponse): boolean {
  const ticket = pendingElicitations.findTicket(response.elicitationId)
  if (!ticket) return false
  pendingElicitations.forget(response.elicitationId)
  const decision = parseAcpElicitationResponse(response)
  void settleRemoteElicitation(ticket.threadID, ticket.requestId, decision)
  return true
}

function requestThreadElicitation(
  _params: CreateElicitationRequest
): Promise<CreateElicitationResponse> {
  return Promise.resolve({ action: 'cancel' })
}

function requestThreadPermission(
  _params: RequestPermissionRequest
): Promise<RequestPermissionResponse> {
  // 反向请求现在是 agentd → 前端的 approval 事件，不再是「前端等回调」
  return Promise.resolve({ outcome: { outcome: 'cancelled' } })
}

// ── 一轮 ────────────────────────────────────────────────────────────────────

async function* runThreadPrompt(
  threadID: string,
  input: {
    text: string
    systemText?: string
    workspaceID?: string | null
    cwd?: string | null
    /** 本轮要用哪个 provider（goose 的 providerId，即本地 provider 行的 `kind`） */
    providerID?: string
    modelID?: string
    /**
     * 要不要给这一轮挂 MCP 工具（默认挂）。
     *
     * 内联改写传 `false`：那条链路上没有审批 UI，一旦模型真的要写东西，用户只看到
     * 「卡住」直到票据超时（F-015）。不挂工具是确定性方案，比在提示词里恳求模型别用可靠。
     */
    withTools?: boolean
    /**
     * 本轮的模式（消息快照算出来的）。
     *
     * 以前这一轮只认会话偏好：重新生成一条「执行」模式的老消息时，提示词要它动手、
     * 而审批与 goose 会话档还按**当前**（可能已改成计划）的档锁只读 → 写工具全被拒，
     * 表现为「模型说要做、然后什么也没发生」（F-013）。不传 = 按会话偏好。
     */
    agentMode?: AgentMode
    signal?: AbortSignal
  }
): AsyncGenerator<ThreadRunItem, void, unknown> {
  const key = threadID.trim()
  if (!key) throw new Error('缺少会话 id，已拒绝发起运行')
  const promptText = input.text.trim()
  if (!promptText) {
    yield { kind: 'stop', stopReason: 'end_turn' }
    return
  }

  await waitGooseReady()
  void ensureGooseAutoCompact()
  // 必须在建会话**之前**：goose 建会话时读自己的 defaults
  await applyRunTarget(input.providerID ?? '', input.modelID)
  const record = await ensureThreadSession(key)

  const cwd = await findWorkspaceCwd(input.workspaceID ?? null, input.cwd ?? null)
  const mcpServers = input.withTools === false ? [] : await findSessionMcpServers(key)
  record.MCPServers = mcpServers
  // 本轮的模式记在**会话登记**上：恢复订阅（`resumeThreadRun`）也要用它
  record.agentMode = input.agentMode ?? null
  const runAgentMode = input.agentMode
  const mode = resolveSessionMode(key, runAgentMode)

  const controller = new AbortController()
  /**
   * 状态机的**注入出口**：审批回执要能立刻插进这一轮的事件流。
   *
   * 用 ref 而不是直接持有队列：队列由状态机自己持有，宿主只拿到一个「往里塞」的句柄，
   * 收尾时状态机把它置空，晚到的回执自然就丢（那一轮已经结束了，本来也该丢）。
   */
  const injectRef: { current: ((item: TurnItem) => void) | null } = { current: null }
  const run: LiveRun = {
    controller,
    inject: function (item: TurnItem) {
      injectRef.current?.(item)
    }
  }
  record.run = run
  /** 这一轮开始时发现事件日志已淘汰（缺段）：收尾后补历史 */
  let truncatedSeen = false

  /**
   * 外部取消（用户点「停止」/ 切走会话）要**同时**做两件事：
   * ① 让 agentd 停 —— ACP `session/cancel` 是唯一能收住长工具的信号；
   * ② 断本地 SSE。
   *
   * 只做 ② 的话，UI 显示「已停止」而 agentd 还在跑：图继续推进、工具继续执行、
   * checkpoint 继续写，下一轮打开会看到「我明明停了它却做完了」。
   *
   * 注意 `detach`（离开页面）不该走到这里 —— `background-turn` 已经把它过滤掉了。
   */
  const externalSignal = input.signal
  const onAbort = function () {
    requestThreadCancel(key)
    controller.abort()
  }
  if (externalSignal) {
    if (externalSignal.aborted) onAbort()
    else externalSignal.addEventListener('abort', onAbort, { once: true })
  }

  /**
   * 终态必落库（成功、取消、失败都算）。
   *
   * 旧实现只在成功路径写绑定：取消或报错后刷新，游标还是旧值，重放出来的旧 `settled`
   * 会把下一轮当场判成结束（F-012）。
   */
  async function persistCursor(cursor: TurnCursor): Promise<void> {
    // 会话 id 每轮都刷新：首轮刚建、agentd 重启后失效都会变
    const sessionId = (await refreshSessionID(key)) ?? record.sessionID
    if (!sessionId) return
    void POST_ACP_BINDING(key, {
      acpSessionId: sessionId,
      cwd,
      lastSeq: cursor.lastSeq,
      lastEpoch: cursor.epoch
    })
  }

  try {
    // 本轮实际发出去的系统提示留给上下文估算（估算器自己推导会与实际不一致）
    rememberSentSystemText(key, input.systemText ?? '')
    for await (const item of runTurn(
      {
        threadID: key,
        prompt: promptText,
        mode,
        cwd,
        mcpServers,
        systemText: input.systemText ?? ''
      },
      {
        threadID: key,
        after: record.lastSeq,
        epoch: record.epoch,
        gates: {
          transport: agentdTransport,
          ledger: approvalLedger,
          elicitations: pendingElicitations,
          policy: function (toolName, options) {
            // 业务规则只有一份（`decideApprovalForThread`）：只读 / 计划 / 目标都在里面
            return decideApprovalForThread(key, toolName, options, runAgentMode)
          },
          onSettleError: function (channel, requestId) {
            const label = channel === 'approval' ? '审批' : '追问'
            reportCaught(
              channel === 'approval' ? 'agent.session.approval' : 'agent.session.elicitation',
              new Error(`${label}回执投递失败：${requestId}`),
              'warning'
            )
          }
        },
        signal: controller.signal,
        injectRef,
        canRenderElicitation,
        onSync: function (info: TurnSyncInfo) {
          record.epoch = info.epoch
          if (info.truncated) {
            // 缺段只能靠 goose 侧历史补。这一轮紧接着要 POST /runs，agentd 会因「有活跃轮」
            // 拒绝补历史，所以只记下意图，收尾后再发起（那时本轮已结束）。
            truncatedSeen = true
            reportCaught(
              'agent.session.events',
              new Error(`事件补发存在缺段（日志已淘汰），已准备补历史：${key}`),
              'warning'
            )
          }
          if (info.lastSeq !== null) record.lastSeq = info.lastSeq
        },
        onProgress: function (cursor) {
          // 断线/崩溃时下一轮要靠它接上，所以逐帧更新内存游标
          record.lastSeq = cursor.lastSeq
          seqByThread.set(key, cursor.lastSeq)
        },
        onCursor: function (cursor) {
          // `onCursor` 是同步回调（结束路径上不能 await）：落库用 fire-and-forget，失败进诊断
          void persistCursor(cursor).catch(function (error: unknown) {
            reportCaught('agent.session.binding', error, 'warning')
          })
        }
      }
    )) {
      if (item.kind === 'update') {
        const update = item.update
        // 上下文用量是**旁路**的 UX 信息：写进内存表，让侧栏的用量条跟着动。
        if (update.sessionUpdate === 'usage_update') {
          const usage = update as unknown as { used?: number; size?: number }
          if (typeof usage.used === 'number' && typeof usage.size === 'number') {
            writeGooseUsage(key, usage.used, usage.size)
          }
        }
        yield { kind: 'update', update }
        continue
      }
      if (item.kind === 'replay') {
        // 补历史：交给上层按覆盖语义映射（这里只透传，不参与用星记账）
        yield { kind: 'replay', update: item.update }
        continue
      }
      if (item.kind === 'approval') {
        yield toApprovalItem(item.ticket)
        continue
      }
      if (item.kind === 'approval_settled') {
        // 任一客户端结案后的广播（也包含本进程内即时注入的那一条）
        yield {
          kind: 'event',
          event: {
            kind: 'tool-approval-settled',
            toolCallId: item.toolCallId,
            approved: item.approved
          }
        }
        continue
      }
      if (item.kind === 'elicitation') {
        const mapped = toElicitationItem(item.request)
        if (mapped) yield mapped
        continue
      }
      yield { kind: 'stop', stopReason: item.stopReason }
    }
  } catch (error) {
    if (controller.signal.aborted) {
      yield { kind: 'stop', stopReason: 'cancelled' }
      return
    }
    // `reset=false`：agentd 已经替我们把「连接断了」翻译成带原因的错误，这里只做人话化
    throw humanizeRunError(error instanceof Error ? error : new Error(String(error)), false)
  } finally {
    record.run = null
    // 这一轮已经结束：模式只对「在跑的那一轮」有意义，留着会让下一轮的恢复订阅读错档
    record.agentMode = null
    // 本轮开始时发现缺段 → 现在没有活跃轮了，补历史才可能成功（409 已在里面降级）
    if (truncatedSeen) void requestThreadReplay(key)
    // 摘掉外部监听：`{ once: true }` 只在真的触发时移除；正常结束的回合如果一直不摘，
    // 之后这个 signal 被 abort 会再发一次 cancel 到 agentd（可能误杀别人那一轮）
    externalSignal?.removeEventListener('abort', onAbort)
    controller.abort()
  }
}

/** 恢复订阅：刷新后 UI 想接着看正在进行的那一轮（产出已解析的共享事件，供历史回填）。 */
async function* resumeThreadRun(
  threadID: string,
  signal?: AbortSignal
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  const key = threadID.trim()
  if (!key) return
  const record = ensureRecord(key)
  const controller = new AbortController()
  const forwardAbort = function () {
    controller.abort()
  }
  if (signal) {
    if (signal.aborted) forwardAbort()
    else signal.addEventListener('abort', forwardAbort, { once: true })
  }
  /** 与 `stream.ts` 同一口径：有 messageId 就按它分段，没有就整轮一段 */
  const context: AcpStreamContext = {
    blockID: function (messageId, kind) {
      return messageId ? `${kind}:${messageId}` : `${kind}:run`
    }
  }

  try {
    // 恢复订阅复用同一个泵：帧处理、游标、审批策略都不允许有第二份实现（F-019）
    for await (const item of pumpTurn({
      threadID: key,
      after: record.lastSeq,
      epoch: record.epoch,
      gates: {
        transport: agentdTransport,
        ledger: approvalLedger,
        elicitations: pendingElicitations,
        policy: function (toolName, options) {
          // 恢复订阅时用**当初那一轮**的模式：用户中途切档不该把在跑的这轮判成拒绝
          return decideApprovalForThread(key, toolName, options, record.agentMode ?? undefined)
        },
        onSettleError: function (channel, requestId) {
          const label = channel === 'approval' ? '审批' : '追问'
          reportCaught(
            channel === 'approval' ? 'agent.session.approval' : 'agent.session.elicitation',
            new Error(`${label}回执投递失败：${requestId}`),
            'warning'
          )
        }
      },
      signal: controller.signal,
      canRenderElicitation,
      onSync: function (info: TurnSyncInfo) {
        record.epoch = info.epoch
        if (info.truncated) {
          // 恢复订阅时没有自己的活跃轮，补历史有机会成功；重放事件回到**这条** SSE，
          // 映射时按 `replace` 覆盖正文（失败无副作用，下次再试）
          void requestThreadReplay(key)
          reportCaught(
            'agent.session.events',
            new Error(`恢复订阅时事件已淘汰，已触发补历史：${key}`),
            'warning'
          )
        }
        if (info.lastSeq !== null) record.lastSeq = info.lastSeq
      },
      onProgress: function (cursor) {
        record.lastSeq = cursor.lastSeq
        seqByThread.set(key, cursor.lastSeq)
      },
      onCursor: function () {
        // 恢复过程同样在推进游标。不落库的话，下次刷新又会从旧位置重放一遍，
        // 而重放的旧 `settled` 会把下一轮当场判成结束。
        if (!record.sessionID || record.lastSeq <= 0) return
        void POST_ACP_BINDING(key, {
          acpSessionId: record.sessionID,
          lastSeq: record.lastSeq,
          lastEpoch: record.epoch
        })
      }
    })) {
      if (item.kind === 'update') {
        const event = parseAcpStreamEvent(item.update, context)
        if (event) yield event
        continue
      }
      if (item.kind === 'replay') {
        // 补历史：正文是完整文本，必须走覆盖语义（否则会与已渲染部分重叠）
        const event = parseAcpStreamEvent(item.update, { ...context, replace: true })
        if (event) yield event
        continue
      }
      if (item.kind === 'approval') {
        // 恢复时也可能有**还没回执**的审批：补发的帧里带着它，必须交给 UI，
        // 否则用户刷新页面后这张卡就永远消失了（而 goose 还在等）
        yield toApprovalItem(item.ticket).event
        continue
      }
      if (item.kind === 'approval_settled') {
        yield {
          kind: 'tool-approval-settled',
          toolCallId: item.toolCallId,
          approved: item.approved
        }
        continue
      }
      if (item.kind === 'elicitation') {
        const mapped = toElicitationItem(item.request)
        if (mapped) yield mapped.event
        continue
      }
      // 终态：恢复路径只补齐「这一轮已经结束」，不区分取消与正常结束
      yield { kind: 'finish', finishReason: item.stopReason, usage: {} }
      return
    }
    yield { kind: 'aborted', usage: {} }
  } catch (error) {
    if (error instanceof TurnFailure && error.code === 'stream_closed') {
      // 流自己断了：恢复场景下等同于「这一轮已不在进行」，别弹红块（但仍要留痕）
      reportCaught('agent.session.resume', error, 'warning')
      yield { kind: 'aborted', usage: {} }
      return
    }
    // 消息已经在状态机里带过归因（模型/网关、工具、授权、连接）
    const message = error instanceof Error ? error.message : String(error)
    yield { kind: 'error', message, usage: {} }
  } finally {
    controller.abort()
    signal?.removeEventListener('abort', forwardAbort)
  }
}

/** 压缩上下文：就是往同一线程发一条 `/compact`（仍走单飞路径）。 */
async function compactThreadSession(threadID: string): Promise<void> {
  const key = threadID.trim()
  if (!key) throw new Error('缺少会话 id，无法压缩上下文')
  // 这一轮还在跑：`/compact` 也是一轮 run，发出去会抢单飞（agentd 会中止正文那轮）
  if (sessionByThread.get(key)?.run) {
    throw new Error('这一轮还在跑，等它结束再压缩')
  }
  // 刷新 / 重开应用后内存表是空的，但库里存着上一轮的 ACP session id —— 得认（F-020）
  if (!hasThreadSession(key)) {
    throw new Error('当前对话尚无 goose session，请先发送一条消息后再压缩')
  }
  for await (const item of runThreadPrompt(key, {
    text: '/compact',
    workspaceID: null
  })) {
    if (item.kind === 'stop') return
  }
}

export {
  applyGooseTemperature,
  applyGooseThinking,
  applyThinkingToOpenSessions,
  clearThreadSessions,
  closeThreadSession,
  compactThreadSession,
  ensureThreadSession,
  findApprovalState,
  findSessionMcpServers,
  findThreadAcpSessionID,
  hasThreadSession,
  humanizeRunError,
  readBuiltinMcpSwitches,
  readGooseStatus,
  requestThreadElicitation,
  requestThreadPermission,
  respondToApproval,
  respondToElicitation,
  resumeThreadRun,
  runThreadPrompt,
  switchGooseProviderModel,
  waitGooseReady
}
export type { AcpMcpServer, ThreadRunItem }
