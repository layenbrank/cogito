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
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { homeDir } from '@tauri-apps/api/path'
import { exists } from '@tauri-apps/plugin-fs'

import type {
  ChatElicitationResponse,
  ChatStreamEvent,
  ChatToolApproval
} from '@cogito/chat/ports'

import {
  parseAcpApprovalRequest,
  parseAcpElicitationRequest,
  parseAcpElicitationResponse,
  parseAcpStreamEvent
} from '@/features/agent/acp/stream'
import type { AcpStreamContext } from '@/features/agent/acp/stream'
import { writeGooseUsage } from '@/features/agent/acp/goose-usage'
import { bindSession, recallBinding } from '@/features/agent/acp/session-binding'
import { callAgentd, callAgentdJson, forgetEndpoint, invokeGoose } from './agentd-rpc'
import { annotateRunFailure, humanizeRunError } from '@/features/agent/acp/run-error'
import { pickWorkspaceCwd } from '@/features/agent/acp/workspace-cwd'
import { findGooseMode } from '@/features/agent/approval'
import { decideApprovalForThread } from '@/features/agent/approval-decision'
import { findEffectiveApprovalMode } from '@/features/agent/effective-approval'
import { findModelKey, findModelPref } from '@/features/agent/model/model-prefs'
import { recordThinkingApplied } from '@/features/agent/model/thinking-capability'
import { resolveThinkingValue } from '@/features/agent/model/thinking-effort-map'
import { toGooseTemperature } from '@/features/agent/model/tuning'
import { readThinkingLevelFor } from '@/features/agent/thinking-level'
import type { ThinkingLevel } from '@/features/persist'
import { findPref } from '@/features/persist'
import { CHANNELS, EVENTS } from '@/shared/ipc/channels'
import { BridgeInfoSchema } from '@/shared/ipc/specs/bridge'
import type { AgentdStatus } from '@/shared/ipc/specs/agentdStatus'
import { StatusSchema } from '@/shared/ipc/specs/sidecar'
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

/** agentd 的审批载荷（`/threads/:id/events` 里 `kind:'approval'` 的 payload） */
interface ApprovalPayload {
  approval: {
    requestId: string
    threadID: string
    sessionId: string
    toolCall: unknown
    options: Array<{ optionId: string; name: string; kind: string }>
  }
  type?: string
  optionId?: string | null
}

/** 正在跑的那一轮（本地侧只需要「能取消」与「能塞事件」）。 */
interface LiveRun {
  controller: AbortController
  inject: (item: ThreadRunItem) => void
}

interface ThreadSession {
  threadID: string
  /** agentd 里的 goose session id（首轮跑完从 `/threads/:id/state` 读回） */
  sessionId: string | null
  mcpServers: AcpMcpServer[]
  run: LiveRun | null
  /** 事件流游标：断线重连 / 恢复时从这里续读 */
  lastSeq: number
}

const READY_TIMEOUT_MS = 30_000
const READY_FALLBACK_POLL_MS = 1_000
/** 一轮的兜底上限：真跑一小时也该有 settled，这里只防「事件流永久不闭嘴」。 */
const RUN_IDLE_TIMEOUT_MS = 60 * 60_000
const EVENTS_PATH = '/threads'

const sessionByThread = new Map<string, ThreadSession>()
/** 每个 thread 的事件流序号（恢复订阅时用来续读） */
const seqByThread = new Map<string, number>()

// ── SSE ─────────────────────────────────────────────────────────────────────

interface SseFrame {
  event: string
  data: Record<string, unknown>
}

/**
 * 读 SSE。**不做行缓冲复用**：SSE 的帧边界是空行，这里按 `\n\n` 切。
 *
 * `signal` 中止时直接结束迭代（不抛错）—— 调用方是在收尾，不该再收到异常。
 */
async function* readSse(response: Response, signal: AbortSignal): AsyncGenerator<SseFrame> {
  const body = response.body
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!signal.aborted) {
      const chunk = await reader.read()
      if (chunk.done) return
      buffer += decoder.decode(chunk.value, { stream: true })
      let index = buffer.indexOf('\n\n')
      while (index >= 0) {
        const frame = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const eventMatch = /^event: (.+)$/m.exec(frame)
        const dataMatch = /^data: (.+)$/m.exec(frame)
        if (eventMatch && dataMatch) {
          try {
            yield {
              event: eventMatch[1].trim(),
              data: JSON.parse(dataMatch[1]) as Record<string, unknown>
            }
          } catch (error) {
            // 坏帧丢掉，不要让整条流断掉；但要留痕（否则「事件莫名消失」无从查起）
            console.warn('[agent/session] 丢弃一条坏的 SSE 帧:', error)
          }
        }
        index = buffer.indexOf('\n\n')
      }
    }
  } finally {
    void reader.cancel().catch(function () {
      // 已经关了
    })
  }
}

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
      // 宿主挂了：endpoint 已失效，会话表也失去了会话
      forgetEndpoint()
      agentdPhase = 'failed'
      agentdStatus = { state: 'failed', reason: 'agentd 未就绪' }
      for (const thread of sessionByThread.values()) thread.sessionId = null
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
    const status = await invoke<boolean | null>(CHANNELS.AGENTD.READY).catch(function () {
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
    sessionId: bound?.acpSessionId ?? null,
    mcpServers: [],
    run: null,
    lastSeq: seqByThread.get(threadID) ?? bound?.lastSeq ?? 0
  }
  sessionByThread.set(threadID, record)
  return record
}

function findThreadAcpSessionID(threadID: string): string | null {
  return sessionByThread.get(threadID.trim())?.sessionId ?? null
}

function hasThreadSession(threadID: string): boolean {
  const key = threadID.trim()
  if (!key) return false
  if (sessionByThread.get(key)?.sessionId) return true
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
  void callAgentd(`${EVENTS_PATH}/${encodeURIComponent(key)}/cancel`, { method: 'POST' }).catch(
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
}

function closeThreadSession(threadID: string): void {
  const key = threadID.trim()
  const record = sessionByThread.get(key)
  if (!record) return
  record.run?.controller.abort()
  sessionByThread.delete(key)
  seqByThread.delete(key)
  // 没有活跃轮时 agentd 返回 200；网络失败也不该抛给调用方
  requestThreadCancel(key)
}

/** 幂等建线程：`thread_id` 就是本地会话 id，agentd 重启后仍能对上 checkpoint。 */
async function ensureThreadSession(threadID: string): Promise<ThreadSession> {
  const key = threadID.trim()
  if (!key) throw new Error('缺少会话 id')
  const record = ensureRecord(key)
  await callAgentdJson<{ thread_id: string }>(EVENTS_PATH, {
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
      `${EVENTS_PATH}/${encodeURIComponent(threadID)}/state`
    )
    const value = state.values?.sessionId
    record.sessionId = typeof value === 'string' && value ? value : null
    return record.sessionId
  } catch (error) {
    // 读不到状态就沿用本地记录：首轮刚建时 state 可能还是空的
    console.warn('[agent/session] 读取会话状态失败:', error)
    return record.sessionId
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
    const raw = await invoke(CHANNELS.SIDECAR.TO_READ)
    const status = StatusSchema.parse(raw)
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
      await invoke(CHANNELS.BRIDGE.INFO, { sessionID: `goose-acp:${sessionID}` })
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
    const sessionId = record?.sessionId ?? null
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
    if (model && thread.mcpServers.length < 0) continue
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

// ── 审批规则 ────────────────────────────────────────────────────────────────

/** 本轮要不要问用户（agentd 只看 mode，业务规则在这里）。 */
function resolveSessionMode(threadID: string): string {
  // 档位 → goose mode 的映射只有一份（`policy/approval.ts` 的 findGooseMode）：
  // 以前这里手写了一个不一样的版本（readonly → approve，而 policy 里写 smart_approve），
  // 两处一旦接反就会“选了只读，写工具还是弹审批卡让人点允许”。
  return findGooseMode(findEffectiveApprovalMode(threadID))
}

/**
 * 待审批票据：`toolCallId → { threadID, requestId, options }`。
 *
 * **必须带 threadID**：审批卡属于「那一轮」，而用户点的时候当前会话可能已经切走了
 * （或者会话记录已经被关掉）。靠遍历 `sessionByThread` 去找票据，一旦记录不在表里
 * 就永远返回 `false`，UI 只能报「已失效」—— 而 agentd 那边的票据还挂着 300s。
 */
interface ApprovalTicket {
  threadID: string
  requestId: string
  options: string[]
}
const pendingApprovals = new Map<string, ApprovalTicket>()
/** 待追问票据：`elicitationId → { threadID, requestId }`（回执只有 elicitationId，要靠它定位线程） */
const pendingElicitations = new Map<string, { threadID: string; requestId: string }>()
const settledApprovals = new Map<string, boolean>()
const SETTLED_APPROVALS_CAP = 256

function rememberSettled(toolCallId: string, approved: boolean): void {
  settledApprovals.set(toolCallId, approved)
  if (settledApprovals.size <= SETTLED_APPROVALS_CAP) return
  const oldest = settledApprovals.keys().next().value
  if (oldest !== undefined) settledApprovals.delete(oldest)
}

function findApprovalState(toolCallId: string): 'pending' | boolean | null {
  if (pendingApprovals.has(toolCallId)) return 'pending'
  const settled = settledApprovals.get(toolCallId)
  return settled === undefined ? null : settled
}

async function settleRemoteApproval(
  threadID: string,
  requestId: string,
  optionId: string | null
): Promise<boolean> {
  try {
    const response = await callAgentd(
      `${EVENTS_PATH}/${encodeURIComponent(threadID)}/approvals/${encodeURIComponent(requestId)}`,
      { method: 'POST', body: JSON.stringify(optionId === null ? { cancelled: true } : { optionId }) }
    )
    return response.ok
  } catch (error) {
    reportCaught('agent.session.approval', error, 'warning')
    return false
  }
}

/** 把追问回执写回 agentd；`action` 原样透传（accept 要带 content）。 */
async function settleRemoteElicitation(
  threadID: string,
  requestId: string,
  decision: CreateElicitationResponse
): Promise<boolean> {
  try {
    const response = await callAgentd(
      `${EVENTS_PATH}/${encodeURIComponent(threadID)}/elicitations/${encodeURIComponent(requestId)}`,
      { method: 'POST', body: JSON.stringify(decision) }
    )
    return response.ok
  } catch (error) {
    reportCaught('agent.session.elicitation', error, 'warning')
    return false
  }
}

/**
 * 回答一次审批（UI → 端口 → agentd）。
 *
 * 按**票据 id** 定位而不是「当前线程」：端口与工具卡是两个组件树分支，而一个会话可能
 * 在后台继续跑（那时「当前」已经是别人了）。找不到票据就返回 `false`，调用方据此如实
 * 告诉用户「已失效」，而不是假报成功。
 */
function respondToApproval(approval: ChatToolApproval): boolean {
  const ticket = pendingApprovals.get(approval.toolCallId)
  if (!ticket) return false
  pendingApprovals.delete(approval.toolCallId)
  const derived =
    approval.optionId ??
    ticket.options.find(function (optionId) {
      return approval.approved ? /allow/.test(optionId) : /reject/.test(optionId)
    }) ??
    null
  rememberSettled(approval.toolCallId, approval.approved)
  // 立刻把「已拍板」推回事件流：否则消息要等到 `tool-result` 才离开 requires-action，
  // 而工具可能跑几分钟 —— 用户看到的就是「点了审批没反应」。
  // 注入到**票据所属的线程**（可能就是后台那个），不是「当前会话」。
  sessionByThread.get(ticket.threadID)?.run?.inject({
    kind: 'event',
    event: { kind: 'tool-approval-settled', toolCallId: approval.toolCallId, approved: approval.approved }
  })
  void settleRemoteApproval(ticket.threadID, ticket.requestId, derived)
  return true
}

function respondToElicitation(response: ChatElicitationResponse): boolean {
  const ticket = pendingElicitations.get(response.elicitationId)
  if (!ticket) return false
  pendingElicitations.delete(response.elicitationId)
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

/** 可注入的单消费者队列：审批结论与 SSE 事件都要进同一条流。 */
function makeInjectQueue(): { push: (item: ThreadRunItem) => void; take: () => Promise<ThreadRunItem> } {
  const items: ThreadRunItem[] = []
  let wake: (() => void) | null = null
  return {
    push: function (item: ThreadRunItem) {
      items.push(item)
      const resume = wake
      wake = null
      resume?.()
    },
    take: function () {
      if (items.length > 0) return Promise.resolve(items.shift() as ThreadRunItem)
      return new Promise<ThreadRunItem>(function (resolve) {
        wake = function () {
          resolve(items.shift() as ThreadRunItem)
        }
      })
    }
  }
}

async function* runThreadPrompt(
  threadID: string,
  input: {
    text: string
    systemText?: string
    workspaceID?: string | null
    cwd?: string | null
    providerID: string
    modelID?: string
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
  const record = await ensureThreadSession(key)

  const cwd = await findWorkspaceCwd(input.workspaceID ?? null, input.cwd ?? null)
  const mcpServers = await findSessionMcpServers(key)
  record.mcpServers = mcpServers
  const mode = resolveSessionMode(key)

  const controller = new AbortController()
  const queue = makeInjectQueue()
  const run: LiveRun = {
    controller,
    inject: function (item: ThreadRunItem) {
      queue.push(item)
    }
  }
  record.run = run

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

  const after = record.lastSeq
  let settled = false
  let cancelled = false

  try {
    const eventsResponse = await callAgentd(
      `${EVENTS_PATH}/${encodeURIComponent(key)}/events?after=${after}`,
      { signal: controller.signal }
    )
    if (!eventsResponse.ok) {
      throw new Error(`订阅会话事件失败：${eventsResponse.status}`)
    }

    const runResponse = await callAgentd(`${EVENTS_PATH}/${encodeURIComponent(key)}/runs`, {
      method: 'POST',
      body: JSON.stringify({
        input: {
          prompt: promptText,
          cwd,
          mode,
          mcpServers,
          systemText: input.systemText ?? ''
        }
      }),
      signal: controller.signal
    })
    if (!runResponse.ok) {
      const detail = await runResponse.text().catch(function () {
        return ''
      })
      throw new Error(`发起运行失败：${runResponse.status}${detail ? `：${detail}` : ''}`)
    }

    const frames = readSse(eventsResponse, controller.signal)
    const deadline = Date.now() + RUN_IDLE_TIMEOUT_MS
    /** 已经应用到消息里的最大 seq：重放的旧事件到此为止 */
    let appliedSeq = after

    while (!settled && Date.now() < deadline) {
      // 两个来源抢同一个循环：SSE 帧 与 本地注入（审批结论）
      const raced = await Promise.race([
        frames.next().then(function (result) {
          return { type: 'frame' as const, result }
        }),
        queue.take().then(function (item) {
          return { type: 'inject' as const, item }
        })
      ])

      if (raced.type === 'inject') {
        yield raced.item
        continue
      }
      if (raced.result.done) break
      const frame = raced.result.value
      if (frame.event === 'sync') {
        if (typeof frame.data.lastSeq === 'number') {
          // `sync.lastSeq` 是服务端**已经写到这条连接上**的位置，它就是权威游标。
          // 不能只用 `Math.max` 抬高：agentd 重启后 `seq` 从 0 重新开始，而本地游标还是
          // 上一个进程的大数字 —— 不回退的话，新一轮的每一条事件（含 `status/running` 与
          // `settled`）都会被当成「重放过的旧帧」丢掉，界面就卡在「思考中」直到空闲超时。
          record.lastSeq = frame.data.lastSeq
          appliedSeq = frame.data.lastSeq
          seqByThread.set(key, frame.data.lastSeq)
        }
        continue
      }
      if (frame.event !== 'run') continue

      const kind = frame.data.kind
      const payload = frame.data.payload as Record<string, unknown>
      if (typeof frame.data.seq === 'number') {
        // 补发 + 实时尾部可能重叠：同一条事件只应用一次，否则正文会出现「用用」「直接直接」这类叠字
        if (frame.data.seq <= appliedSeq) continue
        appliedSeq = frame.data.seq
        record.lastSeq = frame.data.seq
        seqByThread.set(key, frame.data.seq)
      }

      if (kind === 'update') {
        const update = payload as unknown as SessionUpdate
        // 上下文用量是**旁路**的 UX 信息：写进内存表，让侧栏的用量条跟着动。
        // 旧实现在 ACP 连接层写，换到 agentd 后事件只在流里过一道，不写就永远不更新。
        if (update.sessionUpdate === 'usage_update') {
          const usage = update as unknown as { used?: number; size?: number }
          if (typeof usage.used === 'number' && typeof usage.size === 'number') {
            writeGooseUsage(key, usage.used, usage.size)
          }
        }
        yield { kind: 'update', update }
        continue
      }

      if (kind === 'approval') {
        const approval = payload as unknown as ApprovalPayload
        const toolCall = approval.approval.toolCall as {
          name?: string
          title?: string
          toolCallId: string
        }
        const toolName = toolCall.name?.trim() || toolCall.title?.trim() || ''
        const outcome = decideApprovalForThread(key, toolName, approval.approval.options)
        if (outcome.kind === 'cancel') {
          // 规则要求拦下但拿不到合适选项：宁可按取消结案，也不能让用户把它放行
          console.warn('[agent/session] 审批决定按取消结案:', outcome.reason)
          void settleRemoteApproval(key, approval.approval.requestId, null)
          rememberSettled(toolCall.toolCallId, false)
          continue
        }
        if (outcome.kind !== 'ask') {
          // 规则替用户拍板：立刻回执并**不推给 UI**（推了会闪一下审批卡）
          void settleRemoteApproval(key, approval.approval.requestId, outcome.optionId)
          rememberSettled(toolCall.toolCallId, outcome.kind === 'allow')
          continue
        }
        const toolCallId = toolCall.toolCallId
        pendingApprovals.set(toolCallId, {
          threadID: key,
          requestId: approval.approval.requestId,
          options: approval.approval.options.map(function (option) {
            return option.optionId
          })
        })
        const params = {
          sessionId: approval.approval.sessionId,
          toolCall: approval.approval.toolCall,
          options: approval.approval.options
        } as unknown as RequestPermissionRequest
        const event = parseAcpApprovalRequest(params)
        yield { kind: 'approval', event, params }
        continue
      }

      if (kind === 'elicitation') {
        // 结构化追问：goose 想让人填一张表。`requestId` 直接当 `elicitationId` 用 ——
        // 回执只需要一个稳定 id，而 agentd 那边本来就按 requestId 定位。
        const ticket = payload as unknown as {
          elicitation: {
            requestId: string
            sessionId: string
            mode: string
            message: string
            requestedSchema: unknown
          }
        }
        const request = ticket.elicitation
        const parsed = parseAcpElicitationRequest({
          mode: 'form',
          sessionId: request.sessionId,
          requestedSchema: request.requestedSchema
        } as CreateElicitationRequest)
        if (!parsed) {
          // 我们只有 form 模式的渲染面：其余模式直接 decline，别让 goose 干等
          void settleRemoteElicitation(key, request.requestId, { action: 'decline' })
          continue
        }
        pendingElicitations.set(request.requestId, { threadID: key, requestId: request.requestId })
        yield {
          kind: 'elicitation',
          event: {
            kind: 'elicitation-request',
            elicitationId: request.requestId,
            schema: parsed.schema,
            ...(parsed.prompt ? { prompt: parsed.prompt } : {})
          },
          params: {
            mode: 'form',
            sessionId: request.sessionId,
            requestedSchema: request.requestedSchema
          } as unknown as CreateElicitationRequest
        }
        continue
      }

      if (kind === 'status') {
        const phase = payload.phase
        if (phase === 'settled') {
          settled = true
          const status = payload.status
          const message = typeof payload.message === 'string' ? payload.message : ''
          if (status === 'error' && !/abort/i.test(message)) {
            // `errorKind` 是 agentd 的归因（模型/网关、工具、授权、连接）：先把「哪一层坏了」
            // 摆出来，用户才知道该去看工具卡还是看 provider 配置
            throw new Error(annotateRunFailure(message, payload.errorKind))
          }
          cancelled = controller.signal.aborted || /abort/i.test(message)
        }
        continue
      }
    }

    if (!settled) {
      // 事件流自己断了（agentd 重启 / 网络抖动）：如实报错，别假装说完
      throw new Error('会话事件流意外结束，这一轮没有收到结束信号')
    }
    // 会话 id 每轮都刷新：首轮刚建、agentd 重启后失效都会变
    await refreshSessionID(key)
    // 把绑定落库：刷新页面 / 重开应用后才能接着看这一轮，而不是从头开始
    if (record.sessionId) {
      void bindSession(key, {
        acpSessionId: record.sessionId,
        cwd,
        lastSeq: record.lastSeq
      })
    }
    yield { kind: 'stop', stopReason: cancelled ? 'cancelled' : 'end_turn' }
  } catch (error) {
    if (controller.signal.aborted) {
      yield { kind: 'stop', stopReason: 'cancelled' }
      return
    }
    // `reset=false`：agentd 已经替我们把「连接断了」翻译成带原因的错误，这里只做人话化
    throw humanizeRunError(error instanceof Error ? error : new Error(String(error)), false)
  } finally {
    record.run = null
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
  /** 已经应用的最大 seq：重放只能从它后面接 */
  let appliedSeq = record.lastSeq
  try {
    const response = await callAgentd(
      `${EVENTS_PATH}/${encodeURIComponent(key)}/events?after=${record.lastSeq}`,
      { signal: controller.signal }
    )
    if (!response.ok) {
      // 拿不到事件流：明确说「已停止」，别让适配器把它当成流异常
      yield { kind: 'aborted', usage: {} }
      return
    }
    for await (const frame of readSse(response, controller.signal)) {
      if (frame.event === 'sync') {
        // 与 `runThreadPrompt` 同一口径：服务端报的 `lastSeq` 才是权威游标，
        // agentd 重启后它会比本地小，必须跟着回退，否则续播的每一帧都被当成旧帧丢掉。
        if (typeof frame.data.lastSeq === 'number') {
          appliedSeq = frame.data.lastSeq
          record.lastSeq = frame.data.lastSeq
          seqByThread.set(key, frame.data.lastSeq)
        }
        continue
      }
      if (typeof frame.data.seq === 'number') {
        // 同一条事件只应用一次（补发与实时尾部会重叠）
        if (frame.data.seq <= appliedSeq) continue
        appliedSeq = frame.data.seq
        record.lastSeq = frame.data.seq
        seqByThread.set(key, frame.data.seq)
      }
      if (frame.event !== 'run') continue
      if (frame.data.kind === 'update') {
        const event = parseAcpStreamEvent(frame.data.payload as SessionUpdate, context)
        if (event) yield event
        continue
      }
      if (frame.data.kind === 'approval') {
        // 恢复时也可能有**还没回执**的审批：补发的事件里带着它，必须交给 UI，
        // 否则用户刷新页面后这张卡就永远消失了（而 goose 还在等）
        const approval = frame.data.payload as ApprovalPayload
        const ticket = approval.approval
        const toolCallId = (ticket.toolCall as { toolCallId?: string }).toolCallId ?? ''
        if (toolCallId) {
          pendingApprovals.set(toolCallId, {
            threadID: key,
            requestId: ticket.requestId,
            options: ticket.options.map(function (option) {
              return option.optionId
            })
          })
        }
        const params = {
          sessionId: ticket.sessionId,
          toolCall: ticket.toolCall,
          options: ticket.options
        } as unknown as RequestPermissionRequest
        const event = parseAcpApprovalRequest(params)
        if (event) yield event
        continue
      }

      if (frame.data.kind === 'elicitation') {
        const request = (
          frame.data.payload as {
            elicitation: {
              requestId: string
              sessionId: string
              message: string
              requestedSchema: unknown
            }
          }
        ).elicitation
        const parsed = parseAcpElicitationRequest({
          mode: 'form',
          sessionId: request.sessionId,
          requestedSchema: request.requestedSchema
        } as CreateElicitationRequest)
        if (!parsed) {
          void settleRemoteElicitation(key, request.requestId, { action: 'decline' })
          continue
        }
        pendingElicitations.set(request.requestId, { threadID: key, requestId: request.requestId })
        yield {
          kind: 'elicitation-request',
          elicitationId: request.requestId,
          schema: parsed.schema,
          ...(parsed.prompt ? { prompt: parsed.prompt } : {})
        }
        continue
      }

      if (frame.data.kind === 'status') {
        const payload = frame.data.payload as {
          phase?: string
          status?: string
          message?: string
          errorKind?: unknown
        }
        if (payload.phase !== 'settled') continue
        if (payload.status === 'error' && payload.message) {
          yield { kind: 'error', message: annotateRunFailure(payload.message, payload.errorKind), usage: {} }
          return
        }
        yield { kind: 'finish', finishReason: 'end_turn', usage: {} }
        return
      }
    }
    yield { kind: 'aborted', usage: {} }
  } finally {
    // 恢复过程同样在推进游标。不落库的话，下次刷新又会从旧位置重放一遍，
    // 而重放的旧 `settled` 会把下一轮当场判成结束。
    if (record.sessionId && record.lastSeq > 0) {
      void bindSession(key, { acpSessionId: record.sessionId, lastSeq: record.lastSeq })
    }
    controller.abort()
    signal?.removeEventListener('abort', forwardAbort)
  }
}

/** 压缩上下文：就是往同一线程发一条 `/compact`（仍走单飞路径）。 */
async function compactThreadSession(threadID: string): Promise<void> {
  const key = threadID.trim()
  if (!key) throw new Error('缺少会话 id，无法压缩上下文')
  if (!sessionByThread.get(key)?.sessionId) {
    throw new Error('当前对话尚无 goose session，请先发送一条消息后再压缩')
  }
  for await (const item of runThreadPrompt(key, {
    text: '/compact',
    providerID: '',
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
