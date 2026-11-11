/**
 * 会话控制器：一个 UI 会话（thread）对应一个 goose ACP session，并管住两处「停下来等人」。
 *
 * 为什么要有这一层：
 * - ACP 的 session 状态（cwd / provider / model / configOptions）必须跟着 thread 走，
 *   不能让 UI 每次发消息都重新 build 一次；
 * - 审批与追问是**两头等**的事：agent 侧挂起等回执，UI 侧挂起等用户点 —— 中间那张「票据」
 *   必须有超时、必须幂等（用户连点两下、或回执晚到都不该把流程卡死）。
 */
import type {
  ActiveSession,
  CreateElicitationRequest,
  CreateElicitationResponse,
  ClientConnection,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionConfigSelectOption,
  SessionConfigSelectOptions,
  SessionUpdate
} from '@agentclientprotocol/sdk'
import { methods } from '@agentclientprotocol/sdk'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { homeDir } from '@tauri-apps/api/path'
import { exists } from '@tauri-apps/plugin-fs'
import { v4 as UUIDV4 } from 'uuid'

import type {
  ChatApprovalOption,
  ChatElicitationResponse,
  ChatStreamEvent,
  ChatToolApproval
} from '@cogito/chat/ports'

import {
  bindAcpRequestRouter,
  bindGooseNotReady,
  bindSessionUpdateRoute,
  findAcpHandle
} from '@/features/agent/acp/connection'
import { mountCloudMcp } from '@/features/agent/acp/cloud-mcp'
import { readWikiApiConfig } from '@/views/knowledge/lib/wiki-api-config.ts'
import { humanizeRunError, isRunCancelled } from '@/features/agent/acp/run-error'
import { pickWorkspaceCwd } from '@/features/agent/acp/workspace-cwd'
import {
  abortAllBackgroundTurns,
  clearPersistedRunning,
  hasPersistedRunningTurn,
  pushTurnEvent
} from '@/features/agent/acp/background-turn'
import { clearGooseUsage, writeGooseUsage } from '@/features/agent/acp/goose-usage'
import {
  fetchSessionTools,
  saveDefaults,
  saveTemperature
} from '@/features/agent/acp/goose-providers'
import { syncSessionApprovalMode } from '@/features/agent/acp/sync-approval-mode'
import {
  bindSession,
  readBinding,
  unbindSession
} from '@/features/agent/acp/session-binding'
import { isWriteTool } from '@/features/agent/approval'
import { findEffectiveApprovalMode } from '@/features/agent/effective-approval'
import { clearRunState, markRunFinished, markRunStarted } from '@/features/agent/acp/run-state'
import { verifyAgentTools } from '@/features/agent/agent-tools'
import type { AgentToolServer } from '@/features/agent/agent-tools'
import { notifyTurnDone } from '@/features/agent/notify'
import { readGoalRun } from '@/features/agent/goal-run'
import { readAgentModeFor } from '@/features/agent/mode'
import { findPref } from '@/features/persist'
import {
  parseAcpApprovalRequest,
  parseAcpElicitationRequest,
  parseAcpElicitationResponse,
  parseAcpPermissionOutcome,
  parseAcpStreamEvent,
  type AcpStreamContext
} from '@/features/agent/acp/stream'
import { parseModels, stringifyModels } from '@/features/agent/model/providers'
import { toGooseTemperature } from '@/features/agent/model/tuning'
import { CHANNELS, EVENTS } from '@/shared/ipc/channels'
import {
  GOOSE_STATUS_EVENT,
  GooseStatusSchema
} from '@/shared/ipc/specs/gooseStatus'
import type { GooseStatus } from '@/shared/ipc/specs/gooseStatus'
import { BridgeInfoSchema } from '@/shared/ipc/specs/bridge'
import { StatusSchema } from '@/shared/ipc/specs/sidecar'
import { useAgentStore } from '@/stores/agent'
import { useProviderStore } from '@/stores/provider'

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
  | { kind: 'stop'; stopReason: string }

/** agent 侧的回执票据：三出口（回执 / 取消 / 超时）都必须落地，且只能落地一次 */
interface Ticket<T> {
  promise: Promise<T>
  settle(value: T): void
}

const READY_TIMEOUT_MS = 30_000
/**
 * 兜底自查间隔（S4）：主路径是 `goose://status` 事件，这个只在
 * 「事件早于订阅」或「监听注册失败」时起作用，所以可以放大到 2 s。
 */
const READY_FALLBACK_POLL_MS = 2_000
const GOOSE_SERVE_NOT_READY = 'goose serve 未就绪'
const GOOSE_SYSTEM_PROMPT_SET = '_goose/unstable/session/system-prompt/set'

/**
 * 票据超时（两边一起等，谁先到算谁）。
 *
 * 5 分钟是「用户去倒杯水还能回来」的尺度：再长，agent 侧会一直占着一次运行不放手；
 * 再短，用户只是走开一下就得到一句「已失效」。
 */
const TICKET_TIMEOUT_MS = 300_000

interface ThreadSession {
  threadID: string
  acpSessionID: string
  session: ActiveSession
  cwd: string
  providerID: string
  modelID: string | null
  configOptions: SessionConfigOption[] | null
  connection: ClientConnection
  /** 本次会话是否注入了 `cogito-mcp`（决定要不要校 `local` 工具基线） */
  mountsCogito: boolean
  /** 正在跑的那一轮（同一会话同时只允许一轮：并发 prompt 会让 goose 侧乱序） */
  run: ThreadRun | null
}

interface ThreadRun {
  queue: ReturnType<typeof makeItemQueue>
  /** 审批票据：键是 ACP 的 toolCallId */
  approvals: Map<
    string,
    Ticket<RequestPermissionResponse> & { options: readonly ChatApprovalOption[] }
  >
  /** 追问票据：键是本模块合成的 elicitationId（form 模式 ACP 不给 id） */
  elicitations: Map<string, Ticket<CreateElicitationResponse>>
  prompt: { cancelled: boolean }
  /** 是否已发过 `session/cancel`（同一个回合只发一次，避免轮询里刷屏） */
  cancelSent: boolean
  /**
   * 真正掐断这一轮。
   *
   * `prompt.cancelled` 只是个**标记**（用来把报错归类成「用户取消」），并不会让
   * `session/prompt` 提前返回。编辑重发 / 抢占时旧一轮还在跑，光打标记就只能干等
   * （超时后报错，而 goose 那边仍在跑）—— 所以这里保存一个能 abort 底层请求的开关。
   */
  cancel: () => void
  /**
   * 这一轮是被「会话/连接被重置」打断的（goose 侧车退出、连接对象换掉、会话 cwd 变了）。
   *
   * 它既不是用户按停止，也不是模型/网关报错：**没人做错，只是这一轮没地方跑了**。
   * 收尾按「中断、可重发」处理，不要把这句内部英文消息渲染成红色错误块。
   */
  reset: boolean
}

/** 会话登记表：按 thread 查（UI 侧），也按 ACP sessionId 查（agent 回调侧） */
const sessionByThread = new Map<string, ThreadSession>()
const sessionByAcpID = new Map<string, ThreadSession>()

/** 工具面自检按 ACP session 去重（每次建会话只查一次 tools/list） */
const verifiedToolSessions = new Set<string>()

/** session（按 ACP session id）的上一次累计用量：本轮增量 = 本轮结束累计 − 基线 */
const usageBaseline = new Map<
  string,
  { inputTokens: number; outputTokens: number; totalTokens: number }
>()

/**
 * 单消费者队列：把「ACP 推送的 update」「agent 发起的审批/追问」「终态」汇成一条流。
 *
 * 用队列而不是 `Promise.race`：审批是从**另一个方向**（agent 回调）塞进来的，
 * 两条来源各自的时序在这里被抹平，消费方只需要顺序读。
 */
function makeItemQueue() {
  const items: ThreadRunItem[] = []
  let wake: (() => void) | null = null

  return {
    push(item: ThreadRunItem) {
      items.push(item)
      const resume = wake
      wake = null
      resume?.()
    },
    async take(): Promise<ThreadRunItem> {
      while (items.length === 0) {
        await new Promise<void>(function (resolve) {
          wake = resolve
        })
      }
      return items.shift()!
    }
  }
}

/** 票据：默认值兜底 + 只 settle 一次 */
function makeTicket<T>(timeoutValue: T): Ticket<T> {
  let settled = false
  let resolveValue: ((value: T) => void) | null = null
  const timer = setTimeout(function () {
    settle(timeoutValue)
  }, TICKET_TIMEOUT_MS)

  function settle(value: T) {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolveValue?.(value)
  }

  return {
    promise: new Promise<T>(function (resolve) {
      resolveValue = resolve
    }),
    settle
  }
}

/**
 * 就绪状态机（S4）：`goose://status` 事件是主路径，`goose:ready` 命令只作兜底。
 *
 * 之前是每 500 ms `invoke('goose:ready')` 轮询：冷启动时一个页面能打几十次 IPC，
 * 而且「就绪」这件事只有 Rust 知道，前端只能猜。现在 Rust 侧 emit 一次、这里 parse 一次
 * （契约在 `shared/ipc/specs/gooseStatus.ts`），事件到了立刻醒；命令只用来兜住
 * 「事件早于订阅」这种时序缝隙。
 */
type GoosePhase = 'ready' | 'failed'

let goosePhase: GoosePhase | null = null
let gooseStatus: GooseStatus | null = null
let gooseStatusSubscribed = false
const goosePhaseWaiters = new Set<() => void>()

function notifyGoosePhase() {
  const waiters = [...goosePhaseWaiters]
  goosePhaseWaiters.clear()
  for (const waiter of waiters) waiter()
}

/** 订阅只做一次；失败时解除标记，让下次调用重试（并发调用会重复 listen，无害） */
async function subscribeGooseStatus(): Promise<void> {
  if (gooseStatusSubscribed) return
  gooseStatusSubscribed = true
  try {
    await listen(GOOSE_STATUS_EVENT, function (event) {
      const parsed = GooseStatusSchema.safeParse(event.payload)
      // 契约不符就当没收到：继续走兜底命令，不要因为一条脏事件把等待卡死
      if (!parsed.success) return
      gooseStatus = parsed.data
      if (parsed.data.state === 'starting') {
        goosePhase = null
        notifyGoosePhase()
        return
      }
      goosePhase = parsed.data.state === 'ready' ? 'ready' : 'failed'
      notifyGoosePhase()
    })
    await listen(EVENTS.GOOSE_NOT_READY, function () {
      goosePhase = 'failed'
      notifyGoosePhase()
    })
  } catch (error) {
    gooseStatusSubscribed = false
    console.warn('[acp/session] 订阅 goose 就绪事件失败，退回命令轮询:', error)
  }
}

/** 等到「相位变化」或超时，谁先到算谁 */
function waitForPhaseChange(ms: number): Promise<void> {
  return new Promise(function (resolve) {
    let settled = false
    const done = function () {
      if (settled) return
      settled = true
      clearTimeout(timer)
      goosePhaseWaiters.delete(done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    goosePhaseWaiters.add(done)
  })
}

async function waitGooseReady(): Promise<void> {
  await subscribeGooseStatus()
  const deadline = Date.now() + READY_TIMEOUT_MS
  for (;;) {
    if (goosePhase === 'ready') {
      await findAcpHandle()
      return
    }
    if (goosePhase === 'failed') throw new Error(GOOSE_SERVE_NOT_READY)
    // 兜底：事件可能在我们订阅之前就发出去了（或监听注册失败）
    const status = await invoke<boolean | null>(CHANNELS.GOOSE.READY)
    if (status === true) {
      goosePhase = 'ready'
      await findAcpHandle()
      return
    }
    if (status === false) {
      goosePhase = 'failed'
      throw new Error(GOOSE_SERVE_NOT_READY)
    }
    if (Date.now() >= deadline) throw new Error(GOOSE_SERVE_NOT_READY)
    await waitForPhaseChange(READY_FALLBACK_POLL_MS)
  }
}

/** 最近一次就绪状态（诊断页展示 readyMs / RSS 基线；没收到过就是 null） */
function readGooseStatus(): GooseStatus | null {
  return gooseStatus
}

/** 开关：默认开；`VITE_COREX_MCP=0` 或 agent.json `corexMcpTools=0` 关闭 */
function isCorexToolsEnabled(): boolean {
  try {
    if (import.meta.env.VITE_COREX_MCP === '0') return false
    if (findPref('agent').corexMcpTools === '0') return false
  } catch (error) {
    // 读不到偏好时按默认「开」处理，但要留痕
    console.warn('[acp/session] 读取 corex-mcp 开关失败，按默认开启处理:', error)
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
      console.info('[acp/session] 未注入 corex-mcp：缺少 mcpPath 或 dataDir')
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
    console.warn('[acp/session] 解析 corex-mcp 注入失败:', error)
    return []
  }
}

/**
 * 本地工具面 `cogito-mcp`：由 goose 按 env 拉起，所有调用再代理回 app 内的 loopback 桥。
 *
 * 桥信息（url/tokenFile）只在内存里传递：`bridge:info` 每次都取当前进程的值，
 * 令牌本身不经过渲染进程（Rust 写到 `<appLocalData>/bridge/token`，MCP 自己读）。
 * 缺 `mcpPath` 时不注入（未 stage / 平台不支持），而不是注入一个必然失败的命令。
 */
async function findCogitoMcpServers(sessionID: string): Promise<AcpMcpServer[]> {
  try {
    if (!readWikiApiConfig().mcpEnabled) {
      console.info('[acp/session] 未注入 cogito-mcp：设置中已关闭 MCP 侧车')
      return []
    }
    // 会话登记：桥侧据此校验 `x-cogito-session`，令牌单独泄漏也调不动工具
    const info = BridgeInfoSchema.parse(
      await invoke(CHANNELS.BRIDGE.INFO, { sessionID: `goose-acp:${sessionID}` })
    )
    const command = info.mcpPath.trim()
    if (!command || !info.url.trim() || !info.tokenFile.trim()) {
      console.info('[acp/session] 未注入 cogito-mcp：缺少 mcpPath 或桥信息')
      return []
    }
    return [
      {
        name: 'cogito',
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
    console.warn('[acp/session] 解析 cogito-mcp 注入失败:', error)
    return []
  }
}

/**
 * 会话的工作目录：按**这个会话自己的工作区**取第一个文件夹，没有就退回用户家目录。
 *
 * 不再区分主文件夹——工作区内部以列表顺序为准（与 `findRootPath` 同口径）。
 *
 * 不能读全局的「当前工作区」指针：库允许多个会话同时跑，用户切到 B 会话后 A 还在后台跑，
 * 指针已经变成了 B 的工作区 —— 拿它算 A 的 cwd 会得到不一致的值，`ensureThreadSession`
 * 就会把 A 的 ACP session 重建（上下文清零），这就是「多会话不能同时干活」的根因。
 */
async function findWorkspaceCwd(
  workspaceID: string | null,
  workspacePath?: string | null
): Promise<string> {
  // 显式目录（任务里选的）优先：一个工作区可以挂多个目录，只按 id 取第一个会把会话
  // 锁死在「默认目录」上 —— 表单里选的目录必须真的成为 cwd。
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

/**
 * 目录是否真的在磁盘上。
 *
 * 返回 null 表示判断不了（非 Tauri 环境、权限不足、网络盘超时）
 * 这种情况不能拦人发消息：让 goose 自己去报错，也比因为一次探测失败把对话卡死强。
 */
async function probeWorkspacePath(path: string): Promise<boolean | null> {
  try {
    return await exists(path)
  } catch (error) {
    console.warn('[acp/session] 探测工作区目录失败，按「无法判断」处理:', path, error)
    return null
  }
}

function flattenSelectOptions(options: SessionConfigSelectOptions): SessionConfigSelectOption[] {
  if (!Array.isArray(options) || options.length === 0) return []
  const first = options[0]
  if (first && typeof first === 'object' && 'group' in first) {
    return (options as Array<{ options: SessionConfigSelectOption[] }>).flatMap(function (group) {
      return group.options
    })
  }
  return options as SessionConfigSelectOption[]
}

function findSelectOption(configOptions: SessionConfigOption[] | null, configId: string) {
  if (!configOptions?.length) return null
  for (const option of configOptions) {
    if (option.type !== 'select') continue
    if (option.id === configId || option.category === configId) return option
  }
  return null
}

/** fail-closed：必须命中 preferred；选项列表为空时返回 null（跳过 set，避免 Invalid params） */
function resolveSelectValue(
  option: SessionConfigOption & { type: 'select' },
  preferred: string | undefined,
  configId: string
): string | null {
  const wanted = preferred?.trim() || ''
  if (!wanted) {
    throw new Error(`未指定 ${configId}，无法切换 goose session 配置`)
  }

  const available = flattenSelectOptions(option.options)
  const ids = available.map(function (item) {
    return item.value
  })
  if (ids.length === 0) return null
  if (ids.includes(wanted)) return wanted

  const byName = available.find(function (item) {
    return item.name === wanted || item.value === wanted
  })
  if (byName) return byName.value

  const hint =
    wanted === 'cogito_gateway'
      ? '组织模型供应商未载入 goose，请重新打开对话或到「设置 → 模型」刷新后再试'
      : '请先在设置中配置供应商'
  throw new Error(
    `goose 未提供 ${configId}=${wanted}（可选：${ids.slice(0, 8).join(', ') || '无'}）。${hint}`
  )
}

function wrapInvalidParams(error: unknown, prefix: string): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/invalid\s*params/i.test(message)) {
    return new Error(
      `${prefix}：Invalid params。请确认 goose 已配置该供应商（设置里保存），且模型名与 goose 一致`
    )
  }
  return error instanceof Error ? error : new Error(`${prefix}: ${message}`)
}

/**
 * 先 provider 后 model（切换 provider 会重置 model，与 goose desktop 一致）
 */
async function syncProviderModel(
  connection: ClientConnection,
  sessionId: string,
  providerId: string,
  modelId: string | undefined,
  configOptions: SessionConfigOption[] | null
): Promise<{
  providerId: string
  modelId: string | null
  configOptions: SessionConfigOption[] | null
}> {
  let options = configOptions

  const providerOption = findSelectOption(options, 'provider')
  if (!providerOption) {
    throw new Error('goose session 无 provider 配置项')
  }
  const targetProvider = resolveSelectValue(providerOption, providerId, 'provider')
  let appliedProvider = providerOption.currentValue || providerId
  if (targetProvider && targetProvider !== providerOption.currentValue) {
    try {
      const response = await connection.agent.request(methods.agent.session.setConfigOption, {
        sessionId,
        configId: 'provider',
        value: targetProvider
      })
      options = response.configOptions ?? options
      appliedProvider = targetProvider
    } catch (error) {
      throw wrapInvalidParams(error, `切换 provider=${targetProvider} 失败`)
    }
  } else if (targetProvider) {
    appliedProvider = targetProvider
  }

  let appliedModel: string | null = findSelectOption(options, 'model')?.currentValue ?? null
  const wantedModel = modelId?.trim()
  if (wantedModel) {
    const modelOption = findSelectOption(options, 'model')
    if (!modelOption) {
      throw new Error('goose session 无 model 配置项')
    }
    const targetModel = resolveSelectValue(modelOption, wantedModel, 'model')
    if (targetModel && targetModel !== modelOption.currentValue) {
      try {
        const response = await connection.agent.request(methods.agent.session.setConfigOption, {
          sessionId,
          configId: 'model',
          value: targetModel
        })
        options = response.configOptions ?? options
        appliedModel = targetModel
      } catch (error) {
        throw wrapInvalidParams(error, `切换 model=${targetModel} 失败`)
      }
    } else if (targetModel) {
      appliedModel = targetModel
    } else {
      appliedModel = modelOption.currentValue || wantedModel
    }
  }

  return { providerId: appliedProvider, modelId: appliedModel, configOptions: options }
}

/** goose 给出的模型清单回流到 provider 存储（设置面板据此显示可选模型） */
async function syncModelsToStore(
  providerId: string | null,
  configOptions: SessionConfigOption[] | null,
  listedModels?: string[]
) {
  if (!providerId) return
  const modelOption = findSelectOption(configOptions, 'model')
  const fromOptions = modelOption
    ? flattenSelectOptions(modelOption.options).map(function (item) {
        return item.value
      })
    : []
  const models = listedModels?.length ? listedModels : fromOptions
  const current = modelOption?.currentValue || null
  if (models.length === 0 && !current) return

  const store = useProviderStore.getState()
  const matched = store.providers.filter(function (provider) {
    return provider.kind === providerId || provider.id === providerId
  })
  if (matched.length === 0) return

  await store.toUpdateProvider(
    matched.map(function (provider) {
      const nextModels = models.length > 0 ? models : parseModels(provider.models)
      const keep =
        provider.model && nextModels.includes(provider.model)
          ? provider.model
          : current || nextModels[0] || provider.model
      return { id: provider.id, models: stringifyModels(nextModels), model: keep }
    })
  )
}

function parseAuthRequired(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  const code =
    error && typeof error === 'object' && 'code' in error
      ? Number((error as { code?: unknown }).code)
      : NaN
  if (/no user query found/i.test(message)) {
    return new Error(
      `${message}（Ollama/Qwen 工具环常见问题：已尽量内联 @ 文件内容；请新开对话重试，或升级 Ollama）`
    )
  }
  // Cursor Agent CLI：与 Cogito 登录 / 组织网关无关，须本机 agent login 或 CURSOR_API_KEY
  if (
    /not logged in to cursor[-_]?agent|cursor[-_]?agent login|run ['"]?agent login|please run ['"]?cursor[-_]?agent login/i.test(
      message
    )
  ) {
    return new Error(
      'Cursor Agent 未登录。请在本机终端执行 agent login，或设置环境变量 CURSOR_API_KEY 后完整重启客户端（与 Cogito 账号登录无关）',
      { cause: error instanceof Error ? error : undefined }
    )
  }
  // 网关 401 / 用户未登录：组织模型走 JWT helper，不是个人供应商配置
  if (/用户未登录|401\s*unauthorized|authentication failed for .*gateway/i.test(message)) {
    return new Error(
      '组织模型鉴权失败（网关未收到有效登录令牌）。请重新登录后重试；若仍失败，完整重启客户端以重载 goose',
      { cause: error instanceof Error ? error : undefined }
    )
  }
  if (code === -32000 || /auth|sign.?in|api.?key|configure|provider/i.test(message)) {
    return new Error(
      `${message}（请在「设置 → 模型」保存个人供应商 API Key；组织模型请先登录 Cogito；Cursor Agent 请本机执行 agent login）`
    )
  }
  if (/invalid\s*params/i.test(message)) {
    return wrapInvalidParams(error, '请求参数无效')
  }
  // goose 常把上游/网关失败收成这一句；组织模型场景补一句可操作提示
  if (/^internal\s*error$/i.test(message.trim())) {
    return new Error(
      '组织模型调用失败（网关或上游模型服务异常）。请确认思考服务与上游供应商可用，或改用个人模型',
      { cause: error instanceof Error ? error : undefined }
    )
  }
  // 默认透传，但把 JSON-RPC code / data 一并拼出，避免只看到一个笼统的 "Internal error"。
  const data = error && typeof error === 'object' ? (error as { data?: unknown }).data : undefined
  if (!Number.isNaN(code) || (data !== null && data !== undefined)) {
    const parts = [message]
    if (!Number.isNaN(code)) parts.unshift(`[code ${code}]`)
    if (data !== null && data !== undefined) {
      if (typeof data === 'string') parts.push(data)
      else {
        try {
          parts.push(JSON.stringify(data))
        } catch (cause) {
          console.debug('[acp/session] 错误 data 无法序列化', cause)
        }
      }
    }
    return new Error(parts.join(' '), { cause: error })
  }
  return error instanceof Error ? error : new Error(message)
}

function disposeThreadSession(thread: ThreadSession) {
  try {
    thread.session.dispose()
  } catch (error) {
    // 清理失败不该阻断后续清理，但原因要留下
    console.warn('[acp/session] dispose session 失败:', error)
  }
}

function forgetThreadSession(thread: ThreadSession) {
  if (sessionByThread.get(thread.threadID) === thread) sessionByThread.delete(thread.threadID)
  if (sessionByAcpID.get(thread.acpSessionID) === thread) sessionByAcpID.delete(thread.acpSessionID)
  usageBaseline.delete(thread.acpSessionID)
  clearGooseUsage(thread.threadID)
  forgetSessionMapping(thread.threadID)
}

/** goose 退出 / 重连：会话与上下文用量都得清（旧 session 已经不可用） */
function clearThreadSessions() {
  for (const thread of sessionByThread.values()) {
    // 正在跑的那一轮握着 `nextUpdate()`：`dispose()` 会直接把它打回（SDK 抛
    // `Active session disposed`）。先打标记，让它按「连接被重置」收尾，
    // 否则一句内部英文消息会被当成模型失败弹到对话里。
    if (thread.run) thread.run.reset = true
    disposeThreadSession(thread)
    usageBaseline.delete(thread.acpSessionID)
    // goose 已经退出：这些 ACP session 在它那边也没了，绑定必须一起清，
    // 否则刷新后 `resumeThreadRun` 会拿死 sessionID 去 `session/load`
    forgetSessionMapping(thread.threadID)
  }
  sessionByThread.clear()
  sessionByAcpID.clear()
  verifiedToolSessions.clear()
  clearGooseUsage()
  clearRunState()
  // 同步中止 background-turn 内存泵，避免 run-state 已清、泵还在跑的分裂态
  void abortAllBackgroundTurns().catch(function (error) {
    console.warn('[acp/session] 中止后台回合失败:', error)
  })
}

/**
 * 关掉某个 thread 的 ACP session（一次性用途，如编辑器内联改写）。
 *
 * 只在**没有在跑**的时候关：正在跑的那一轮还握着 `session.nextUpdate()`，
 * 提前 dispose 会让它拿到一个永远不会结束的流。
 */
function closeThreadSession(threadID: string): void {
  const thread = sessionByThread.get(threadID)
  if (!thread) return
  if (thread.run) {
    console.warn('[acp/session] 会话仍有运行中，跳过关闭:', threadID)
    return
  }
  disposeThreadSession(thread)
  forgetThreadSession(thread)
}

/**
 * 建会话后对一次工具面：实际名与 `agent-tools.lock.json` 不一致时告警。
 * 只打日志、不抛错：工具名漂移不该阻断用户发消息。
 *
 * `local`（cogito-mcp）只在本次会话确实注入了侧车时校验 —— 没注入时缺工具是预期行为。
 */
async function verifyToolSurface(thread: ThreadSession): Promise<void> {
  if (verifiedToolSessions.has(thread.acpSessionID)) return
  verifiedToolSessions.add(thread.acpSessionID)
  try {
    const tools = await fetchSessionTools(thread.connection, thread.acpSessionID)
    const names = tools.map(function (tool) {
      return tool.name
    })
    const servers: AgentToolServer[] = []
    if (isCorexToolsEnabled()) servers.push('corex')
    if (thread.mountsCogito) servers.push('local')
    for (const server of servers) {
      const result = verifyAgentTools(names, server)
      if (result.missing.length > 0) {
        console.warn(
          `[acp/session] ${server} 工具名与基线不一致，缺少:`,
          result.missing,
          '实际:',
          names
        )
      }
      // 侧车已挂却没有可见终端入口 → 模型只能走黑盒 shell，必须显式告警
      if (
        server === 'local' &&
        result.missing.some(function (name) {
          return name === 'app_terminal_run'
        })
      ) {
        console.error(
          '[acp/session] 缺少 app_terminal_run：Agent 无法走右栏可见终端，请检查 cogito-mcp 侧车'
        )
      }
    }
  } catch (error) {
    console.warn('[acp/session] 工具自检失败:', error)
  }
}

bindGooseNotReady(clearThreadSessions)
// agent 反向发起的审批 / 追问交给本模块（连接的注册在 `connection.ts`，见那里的环注释）
bindAcpRequestRouter({
  requestPermission: requestThreadPermission,
  requestElicitation: requestThreadElicitation
})

/**
 * 刷新后恢复进行中回合：thread → ACP session 绑定现在落在 SQLite（S9）。
 *
 * 为什么从 localStorage 搬走：换机器 / 清缓存 / 重装都会丢，而「接上后台还在跑的
 * 那一轮」恰恰是重装后最需要的能力；更糟的是 `cwd` 一旦写错，恢复出来的回合会在
 * 错误的目录里读写文件。绑定写库（`agent_session.acpSessionID / acpCwd / lastSeq`），
 * 内存里留一份缓存做同步查询，启动时由 `main.tsx` 调 `preloadBindings()` 灌满。
 *
 * 两个函数都是「尽力而为」：绑定是运行态元数据，写失败顶多让刷新后恢复不了，
 * 绝不能把这一轮对话卡住，所以都不返回错误、也不 await 到阻塞发消息的路径上。
 */
function rememberSessionMapping(threadID: string, sessionID: string, cwd: string): void {
  void bindSession(threadID, { acpSessionId: sessionID, cwd })
}

function forgetSessionMapping(threadID: string): void {
  void unbindSession(threadID)
}

/** 刷新后恢复订阅：sessionID → 队列；全局 session/update 通知按 sessionId 喂进来 */
interface ResumeFeed {
  push(update: SessionUpdate): void
  close(): void
}

const resumeFeeds = new Map<string, ResumeFeed>()

bindSessionUpdateRoute(function (notification) {
  const feed = resumeFeeds.get(notification.sessionId)
  if (feed) feed.push(notification.update)
})

/**
 * `session/new` 失败时的翻译层。
 *
 * goose 对坏的 cwd / 未就绪的 provider 都只回一句 JSON-RPC `-32602 Invalid params`，
 * 原文到了界面上等于什么都没说。这里补回三样东西：**用的哪个目录**、原始 code/data、
 * 以及下一步该检查什么 —— 用户看得到 cwd，就能立刻发现是工作区路径失效。
 */
function wrapSessionOpenError(error: unknown, cwd: string): Error {
  const message = error instanceof Error ? error.message : String(error)
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined
  const data = error && typeof error === 'object' ? (error as { data?: unknown }).data : undefined
  const parts = [typeof code === 'number' ? `[code ${code}] ${message}` : message]
  if (data !== undefined && data !== null) {
    if (typeof data === 'string') parts.push(data)
    else {
      try {
        parts.push(JSON.stringify(data))
      } catch (serializeError) {
        console.debug('[acp/session] 会话错误 data 无法序列化', serializeError)
      }
    }
  }
  const detail = parts.join(' ')
  const hint = /invalid\s*params/i.test(message)
    ? 'goose 拒绝了会话参数，最常见的原因是 cwd 目录不存在或不可访问，其次是 provider/model 没有在 goose 侧配置好'
    : '请到「设置 → 诊断」查看侧车日志'
  return new Error(`创建 goose 会话失败（cwd=${cwd}）：${detail}。${hint}。`, {
    cause: error instanceof Error ? error : undefined
  })
}

async function openAcpSession(
  connection: ClientConnection,
  cwd: string,
  mcpServers: AcpMcpServer[],
  threadID: string
): Promise<ActiveSession> {
  try {
    return await connection.agent
      .buildSession({
        cwd,
        mcpServers,
        _meta: { client: 'cogito', threadID }
      })
      .start()
  } catch (error) {
    throw wrapSessionOpenError(error, cwd)
  }
}

async function openThreadSession(
  threadID: string,
  cwd: string,
  providerID: string,
  modelID: string | undefined
): Promise<ThreadSession> {
  const handle = await findAcpHandle()
  if (handle.needsProviderAuth) {
    console.info('[acp/session] authMethods 含 goose-provider，请确认已在设置中配置供应商')
  }

  const mcpServers = [
    ...(await findCorexMcpServers(threadID)),
    ...(await findCogitoMcpServers(threadID))
  ]
  // session/new 失败时 goose 只回一句 Invalid params：这里补上 cwd，把它变成能照做的提示
  const session = await openAcpSession(handle.connection, cwd, mcpServers, threadID)

  const initialOptions = session.newSessionResponse.configOptions ?? null
  const applied = await syncProviderModel(
    handle.connection,
    session.sessionId,
    providerID,
    modelID,
    initialOptions
  )
  await syncModelsToStore(applied.providerId, applied.configOptions)

  // 本地工具网关没挂上时（cogito-mcp 缺失/桥没起），把云端检索作为会话扩展补上；
  // 两边同时存在会让模型对同一个查询调两次（`app_knowledge_search` + `cogito_knowledge_search`）。
  const mountsLocalGateway = mcpServers.some(function (server) {
    return server.name === 'cogito'
  })
  if (!mountsLocalGateway) {
    await mountCloudMcp(handle.connection, session.sessionId)
  }

  const thread: ThreadSession = {
    threadID,
    acpSessionID: session.sessionId,
    session,
    cwd,
    providerID: applied.providerId,
    modelID: applied.modelId,
    configOptions: applied.configOptions,
    connection: handle.connection,
    mountsCogito: mountsLocalGateway,
    run: null
  }
  sessionByAcpID.set(thread.acpSessionID, thread)
  rememberSessionMapping(threadID, thread.acpSessionID, cwd)
  handle.connection.closed.then(
    function () {
      forgetThreadSession(thread)
    },
    function () {
      forgetThreadSession(thread)
    }
  )
  try {
    await syncSessionApprovalMode(
      handle.connection,
      thread.acpSessionID,
      findEffectiveApprovalMode(threadID)
    )
  } catch (error) {
    console.warn('[acp/session] 同步审批策略到 goose 失败:', error)
  }
  return thread
}

/**
 * 取（必要时建）这个 thread 的 ACP session。
 *
 * provider / model 变了就地 `setConfigOption`，**不重建 session** —— 重建会把上下文丢掉，
 * 用户只是换了个模型，不该把之前聊的内容清零。
 */
async function ensureThreadSession(
  threadID: string,
  workspaceID: string | null,
  providerID: string,
  modelID: string | undefined,
  workspacePath?: string | null
): Promise<ThreadSession> {
  await waitGooseReady()
  const [handle, cwd] = await Promise.all([
    findAcpHandle(),
    findWorkspaceCwd(workspaceID, workspacePath)
  ])
  const cached = sessionByThread.get(threadID)

  if (cached && cached.cwd === cwd && cached.connection === handle.connection) {
    const sameProvider = providerID === cached.providerID
    const sameModel = !modelID?.trim() || modelID === cached.modelID
    if (!sameProvider || !sameModel) {
      const applied = await syncProviderModel(
        handle.connection,
        cached.acpSessionID,
        providerID,
        modelID,
        cached.configOptions
      )
      cached.providerID = applied.providerId
      cached.modelID = applied.modelId
      cached.configOptions = applied.configOptions
      await syncModelsToStore(applied.providerId, applied.configOptions)
    }
    // 已开会话也重推有效审批档：计划模式只读 / 用户偏好；避免仍停在 goose 默认 auto
    try {
      await syncSessionApprovalMode(
        handle.connection,
        cached.acpSessionID,
        findEffectiveApprovalMode(threadID)
      )
    } catch (error) {
      console.warn('[acp/session] 重同步审批 mode 失败:', error)
    }
    return cached
  }

  if (cached) {
    // 同 `clearThreadSessions`：正在跑的那一轮得知道自己是被重置掉的，不是报错
    if (cached.run) cached.run.reset = true
    disposeThreadSession(cached)
    forgetThreadSession(cached)
  }

  const opened = await openThreadSession(threadID, cwd, providerID, modelID)
  sessionByThread.set(threadID, opened)
  void verifyToolSurface(opened)
  return opened
}

/**
 * 跑一轮 prompt。
 *
 * 产出的终态**只有一个** `stop`：ACP 的 `session/prompt` 返回值、取消、异常三条路
 * 都归到这里，调用方据此发一个终态事件（不能发两个，assistant-ui 会认为这轮还没完）。
 */
/**
 * 发一次协议级取消（`session/cancel`）。
 *
 * ACP 规定 `session/prompt` 的 `cancellationSignal` 只负责取消**那次请求**
 * （SDK 发的是 `$/cancel_request`），而「让 agent 立刻停下手上的工具」是
 * `session/cancel` 的语义 —— goose 只实现了后者。两件事都做，停止才真的停。
 */
function notifySessionCancel(thread: ThreadSession): void {
  try {
    void thread.connection.agent
      .notify('session/cancel', { sessionId: thread.acpSessionID })
      .catch(function (error: unknown) {
        console.warn('[acp/session] 发送 session/cancel 失败:', error)
      })
  } catch (error) {
    console.warn('[acp/session] 发送 session/cancel 抛错:', error)
  }
}

async function* runThreadPrompt(
  threadID: string,
  input: {
    text: string
    systemText?: string
    /** 本会话所属工作区：cwd 跟着**会话**走，不跟全局指针走 */
    workspaceID?: string | null
    /** 显式目录（任务里选的），优先于工作区默认目录 */
    cwd?: string | null
    providerID: string
    modelID?: string
    signal?: AbortSignal
  }
): AsyncGenerator<ThreadRunItem, void, unknown> {
  const promptText = input.text.trim()
  if (!promptText) {
    yield { kind: 'stop', stopReason: 'end_turn' }
    return
  }

  let thread = await ensureThreadSession(
    threadID,
    input.workspaceID ?? null,
    input.providerID,
    input.modelID,
    input.cwd ?? null
  )
  if (thread.run) {
    // 编辑重发 / 目标续跑 / 抢占：上一轮的 **UI 订阅**已经 abort，但 ACP 侧收尾是异步的
    // （prompt 的 cancellationSignal 被打回 → 生成器的 finally 才清 `thread.run`）。
    // 这里直接 throw 就是「刚发消息想改内容 → 编辑点更新报错、后台其实还在跑」的根因：
    // 新一轮进来时旧一轮还没走完，界面收到错误就停住，只有整页重载才恢复渲染。
    //
    // 现在的处理：先发 session/cancel 并等一个有限窗口；窗口内没停下就**作废这把被占住的
    // 会话**、重建 ACP session 再继续 —— 宁可丢一次 goose 侧内存上下文，也不让整个对话框
    // 永久卡在「发送中」。UI 的历史仍在自己手里，下一条消息照常发出。
    const cleared = await waitForRunIdle(thread)
    if (!cleared) {
      // 旧一轮握着 ACP session 不放：把被占住的会话作废重建，让这一轮能真的发出去。
      // 只作废、不抛错 —— 抛错会让界面停在「已报错但后台还在跑」，正是这条缺陷的旧形态。
      console.warn('[acp/session] 上一轮未在时限内停下，重建会话后继续:', threadID)
      if (thread.run) thread.run.reset = true
      disposeThreadSession(thread)
      forgetThreadSession(thread)
      thread = await ensureThreadSession(
        threadID,
        input.workspaceID ?? null,
        input.providerID,
        input.modelID,
        input.cwd ?? null
      )
    }
  }

  if (input.systemText?.trim()) {
    try {
      await thread.connection.agent.request(GOOSE_SYSTEM_PROMPT_SET, {
        sessionId: thread.acpSessionID,
        mode: 'append',
        key: 'cogito',
        text: input.systemText.trim()
      })
    } catch (error) {
      console.warn('[acp/session] 设置 system prompt 失败（可忽略）:', error)
    }
  }

  const queue = makeItemQueue()
  /**
   * 本轮自有的取消开关：UI / 抢占方只要 abort 它，ACP 的 `session/prompt` 立刻收到取消。
   * 与 `input.signal` 是**串联**关系：外部信号一 abort 就转发进来，反过来不会。
   */
  const runCancel = new AbortController()
  const run: ThreadRun = {
    queue,
    approvals: new Map(),
    elicitations: new Map(),
    cancelSent: false,
    prompt: { cancelled: false },
    cancel: function () {
      run.prompt.cancelled = true
      // 协议级取消：SDK 的 cancellationSignal 只发 `$/cancel_request`，
      // 而 ACP 要求 agent 必须支持 `session/cancel` —— goose 认的是后者。
      // 少了这一下，长工具（dev server、大构建）根本不会停，
      // 编辑重发就只能干等超时，界面上表现为「报错但后台还在跑」。
      if (!run.cancelSent) {
        run.cancelSent = true
        notifySessionCancel(thread)
      }
      if (!runCancel.signal.aborted) runCancel.abort()
    },
    reset: false
  }
  thread.run = run

  // prompt 失败 / abort 后 goose 可能不再推 stop：用 release 打断泵，避免 finally 挂死
  // box：TS 收窄看不到「回调里赋的值」
  const releaseBox: { release: (() => void) | null } = { release: null }
  const pumpReleased = new Promise<void>(function (resolve) {
    releaseBox.release = resolve
  })

  if (input.signal) {
    const onAbort = function () {
      run.cancel()
    }
    if (input.signal.aborted) onAbort()
    else input.signal.addEventListener('abort', onAbort, { once: true })
  }

  // ACP 推送的 update 与 agent 发起的审批/追问是同一条队列的两个生产者：这里只负责把
  // update 泵进去，直到 goose 明确说这轮结束，或本轮被 release

  // 失败要在这里也写得到：泵自己断了同样得终结这一轮（见下面 pump 的 catch）
  const failureBox: { error: Error | null } = { error: null }

  const pump = (async function () {
    while (true) {
      const raced = await Promise.race([
        thread.session.nextUpdate().then(function (message) {
          return { type: 'message' as const, message }
        }),
        pumpReleased.then(function () {
          return { type: 'released' as const }
        })
      ])
      if (raced.type === 'released') return
      const message = raced.message
      if (message.kind === 'stop') {
        queue.push({ kind: 'stop', stopReason: message.stopReason })
        return
      }
      const usage = message.notification.update
      if (usage.sessionUpdate === 'usage_update') {
        writeGooseUsage(threadID, usage.used, usage.size)
      }
      queue.push({ kind: 'update', update: message.notification.update })
    }
  })().catch(function (error: unknown) {
    // 连接断了 / goose 崩了：这一轮不会再有 stop 事件，`queue.take()` 会一直等——
    // 界面永远停在「思考中」，用户只会觉得对话突然没声了，也看不出是出错。
    // 这里补一条终态，交给模型层收尾。
    //
    // 但「取消」也会把这次读打回（`session/prompt` 带 cancellationSignal 被拒，
    // SDK 连带 reject 排队中的 `nextUpdate()`）：那是用户自己停的，判成失败就会
    // 在按停止时弹一个错误块。
    const cancelled = isRunCancelled(run, input.signal)
    failureBox.error = cancelled ? null : humanizeRunError(error, run.reset)
    queue.push({ kind: 'stop', stopReason: cancelled ? 'cancelled' : 'error' })
    releaseBox.release?.()
  })

  const promptDone = thread.session
    .prompt([{ type: 'text' as const, text: promptText }], {
      cancellationSignal: runCancel.signal
    })
    .catch(function (error: unknown) {
      const cancelled = isRunCancelled(run, input.signal)
      failureBox.error = cancelled ? null : humanizeRunError(parseAuthRequired(error), run.reset)
      queue.push({ kind: 'stop', stopReason: cancelled ? 'cancelled' : 'error' })
      releaseBox.release?.()
    })

  // 从这里开始到 finally 之间不能有同步抛出的路径，否则左栏会一直显示「生成中」
  markRunStarted(threadID)
  try {
    while (true) {
      const item = await queue.take()
      if (item.kind === 'stop') {
        if (failureBox.error && item.stopReason !== 'cancelled') throw failureBox.error
        yield item
        return
      }
      yield item
    }
  } finally {
    // 只清「自己那一轮」：会话被作废重建后 thread 可能已被新一轮接管，
    // 无条件清空会把别人的运行状态抹掉（下一轮会以为没人跑，并发起两条 prompt）。
    if (thread.run === run) thread.run = null
    markRunFinished(threadID)
    void notifyTurnDone(threadID, run.prompt.cancelled)
    releaseBox.release?.()
    // 这一轮没被回答的票据全部作废：留着的 promise 会让 goose 侧一直等，且用户看到的
    // 「待审批」永远不会消失（票随轮次生死）
    for (const ticket of run.approvals.values())
      ticket.settle({ outcome: { outcome: 'cancelled' } })
    for (const ticket of run.elicitations.values()) ticket.settle({ action: 'cancel' })
    run.approvals.clear()
    run.elicitations.clear()
    const response = await promptDone
    await recordUsage(thread, input.modelID, response?.usage)
    await pump.catch(function (error: unknown) {
      console.warn('[acp/session] update 泵异常结束:', error)
    })
  }
}

/**
 * 把本轮 token 账写进 `agent_usage`。
 *
 * `PromptResponse.usage` 是 **session 累计**（goose 的 `build_prompt_usage` 直接取
 * `session.usage`），所以本轮增量 = 本次累计 − 上一次结束时的基线。基线按 ACP session id 存：
 * session 重建（重启 / 换线程）自然拿到零基线；compaction 重置导致负增量时直接跳过，
 * 不落一条 0 账。
 */
/** 上一轮收尾的等待上限：正常取消几十毫秒内完成，留足余量给慢工具 */
const RUN_HANDOFF_TIMEOUT_MS = 8_000
const RUN_HANDOFF_POLL_MS = 50

/**
 * 等上一轮真正收尾（`thread.run` 在生成器 finally 里被清掉）。
 *
 * 同时打上取消标记：即使调用方的 abort 信号没接上，也不会让新一轮干等满额超时 ——
 * 用户看到的是「编辑后要点两三次才发出去」，而不是一个无从理解的报错。
 */
async function waitForRunIdle(thread: ThreadSession): Promise<boolean> {
  const deadline = Date.now() + RUN_HANDOFF_TIMEOUT_MS
  while (thread.run) {
    // 打标记只是让报错归类成「取消」；真正让它停下来的是 cancel()。
    // 少了这一步，编辑重发只能干等旧一轮自然跑完 —— 用户看到的就是
    // 「点了更新报错，但 agent 还在后台跑，页面也不再刷新」。
    thread.run.cancel()
    if (Date.now() >= deadline) return false
    await new Promise(function (resolve) {
      window.setTimeout(resolve, RUN_HANDOFF_POLL_MS)
    })
  }
  return true
}

async function recordUsage(
  thread: ThreadSession,
  modelID: string | undefined,
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null | undefined
): Promise<void> {
  try {
    if (!usage) return
    const baseline = usageBaseline.get(thread.acpSessionID)
    const inputTokens = baseline ? usage.inputTokens - baseline.inputTokens : usage.inputTokens
    const outputTokens = baseline ? usage.outputTokens - baseline.outputTokens : usage.outputTokens
    const totalTokens = baseline ? usage.totalTokens - baseline.totalTokens : usage.totalTokens
    usageBaseline.set(thread.acpSessionID, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens
    })
    if (inputTokens <= 0 && outputTokens <= 0) return
    const model = modelID?.trim() || thread.modelID?.trim() || ''
    if (!model) return
    await useAgentStore.getState().toWriteUsage([
      {
        id: UUIDV4(),
        runID: UUIDV4(),
        sessionID: thread.threadID,
        providerID: thread.providerID,
        model,
        inputTokens,
        outputTokens,
        totalTokens,
        createdAt: Date.now()
      }
    ])
  } catch (error) {
    // 记账失败不阻断运行结束：token 数是旁路，丢了只影响历史页的用量展示
    console.warn('[acp/session] 写入 agent_usage 失败:', error)
  }
}

/**
 * 目标推进期间无人值守：审批自动放行。
 *
 * 优先一次性授权（`allow_once`），其次常驻；找不到“允许”类选项才退回取消 ——
 * 不要因为挑不出选项就把整轮卡到票据超时。
 */
function pickAutoAllowOption(
  options: RequestPermissionRequest['options']
): RequestPermissionRequest['options'][number] | null {
  return (
    options.find(function (option) {
      return option.kind === 'allow_once'
    }) ??
    options.find(function (option) {
      return option.kind === 'allow_always'
    }) ??
    options.find(function (option) {
      return /allow|approve|yes/i.test(option.name)
    }) ??
    null
  )
}

/**
 * agent 请求权限（由连接的 `session/request_permission` 回调转进来）。
 *
 * 找不到对应会话时**按取消回复**：宁可让 agent 知道这次没被批准，也不能让它悬着。
 */
async function requestThreadPermission(
  params: RequestPermissionRequest
): Promise<RequestPermissionResponse> {
  const thread = sessionByAcpID.get(params.sessionId)
  const run = thread?.run
  if (!thread || !run) {
    return { outcome: { outcome: 'cancelled' } }
  }

  // 计划模式硬只读：写工具直接拒绝（不改用户审批偏好，对齐「模式 = 能力面」）。
  const toolName =
    params.toolCall.name?.trim() || params.toolCall.title?.trim() || params.toolCall.toolCallId
  if (readAgentModeFor(thread.threadID) === 'plan' && isWriteTool(toolName)) {
    console.info('[acp/session] 计划模式拒绝写工具:', toolName)
    return { outcome: { outcome: 'cancelled' } }
  }

  // 目标模式特有的兜底：这一线程的推进不是“问一次动一下”，不能停下来等人。
  // 直接回允许，不挂票据、不往队列塞审批事件（否则用户回来只看到一堆已失效的卡片）。
  if (readGoalRun(thread.threadID)) {
    const allow = pickAutoAllowOption(params.options)
    if (allow) {
      console.info(
        '[acp/session] 目标模式自动批准:',
        params.toolCall.title ?? params.toolCall.toolCallId
      )
      return { outcome: { outcome: 'selected', optionId: allow.optionId } }
    }
    console.warn('[acp/session] 目标模式找不到可批准项，按取消处理:', params.toolCall.toolCallId)
    return { outcome: { outcome: 'cancelled' } }
  }

  const event = parseAcpApprovalRequest(params)
  const options = event.kind === 'tool-approval-request' ? (event.options ?? []) : []
  const toolCallId = params.toolCall.toolCallId
  const previous = run.approvals.get(toolCallId)
  if (previous) previous.settle({ outcome: { outcome: 'cancelled' } })
  const ticket = makeTicket<RequestPermissionResponse>({ outcome: { outcome: 'cancelled' } })
  run.approvals.set(toolCallId, { ...ticket, options })
  run.queue.push({ kind: 'approval', event, params })
  return ticket.promise
}

/**
 * agent 发起追问（由连接的 `elicitation/create` 回调转进来）。
 *
 * form 模式 ACP 不给 id，而回执必须能定位到票据 —— 这里按「会话 + 工具调用 + 序号」合成一个。
 */
async function requestThreadElicitation(
  params: CreateElicitationRequest
): Promise<CreateElicitationResponse> {
  const rawSessionID: unknown = 'sessionId' in params ? params.sessionId : null
  const sessionId = typeof rawSessionID === 'string' ? rawSessionID : ''
  const thread = sessionByAcpID.get(sessionId)
  const run = thread?.run
  if (!thread || !run) {
    return { action: 'cancel' }
  }

  // 目标推进无人值守：追问在这里必须**立刻**取消。
  // 否则票据会挂到 `TICKET_TIMEOUT_MS`（5 分钟）才超时，而后台目标轮根本没人能
  // 看到表单 —— 用户看到的就是「目标推进停住了」，实际上在等一个永远不会来的回答。
  if (readGoalRun(thread.threadID)) {
    console.warn('[acp/session] 目标模式自动取消追问:', params.mode)
    return { action: 'cancel' }
  }

  const parsed = parseAcpElicitationRequest(params)
  if (!parsed) {
    // url 模式另有交互（浏览器里填，靠 elicitation/complete 通知收尾），这里不该被问到
    console.warn('[acp/session] 收到非表单追问，暂不处理:', params.mode)
    return { action: 'cancel' }
  }

  // 联合里的「未来模式」让字段收不紧（索引签名），按运行时判断读一个字符串出来
  const rawToolCallID: unknown = 'toolCallId' in params ? params.toolCallId : null
  const toolCallID = typeof rawToolCallID === 'string' && rawToolCallID ? rawToolCallID : '-'
  const elicitationID = `${sessionId}\u0000${toolCallID}\u0000${run.elicitations.size}`
  const ticket = makeTicket<CreateElicitationResponse>({ action: 'cancel' })
  run.elicitations.set(elicitationID, ticket)
  run.queue.push({
    kind: 'elicitation',
    event: {
      kind: 'elicitation-request',
      elicitationId: elicitationID,
      schema: parsed.schema,
      ...(parsed.prompt ? { prompt: parsed.prompt } : {})
    },
    params
  })
  return ticket.promise
}

/**
 * 回答一次审批（UI → 端口 → 这里）。
 *
 * 按**票据 id** 定位而不是「当前线程」：端口与工具卡是两个组件树分支，而一个会话可能
 * 在后台继续跑（那时「当前」已经是别人了）。找不到票据就返回 `false`，调用方据此如实告诉
 * 用户「已失效」，而不是假报成功。
 */
function respondToApproval(approval: ChatToolApproval): boolean {
  for (const thread of sessionByThread.values()) {
    if (thread.run?.approvals.has(approval.toolCallId))
      return settleApproval(thread.threadID, approval)
  }
  return false
}

/**
 * 已受理的审批回执（`toolCallId → 是否允许`）。
 *
 * 事件要经过「泵 → 缓冲 → 适配器」才落到 part 上，中间有几帧；卡片靠这份缓存
 * 立刻离开待审批态，不会先闪回一下再变。同时它也是「历史旧卡」的判据：
 * 既没有票据也没有回执 = 那次审批早就结束了，不该再可点。
 */
const settledApprovals = new Map<string, boolean>()
const SETTLED_APPROVALS_CAP = 256

function rememberSettledApproval(toolCallId: string, approved: boolean): void {
  settledApprovals.set(toolCallId, approved)
  if (settledApprovals.size <= SETTLED_APPROVALS_CAP) return
  const oldest = settledApprovals.keys().next().value
  if (oldest !== undefined) settledApprovals.delete(oldest)
}

/**
 * 审批卡要的实时状态：
 * - `'pending'`：票据还在等待（可以点）；
 * - `boolean`：已拍板（事件可能还没到，UI 直接按它渲染）；
 * - `null`：既没票据也没回执 —— 历史重建出来的旧卡，已失效。
 */
function findApprovalState(toolCallId: string): 'pending' | boolean | null {
  const settled = settledApprovals.get(toolCallId)
  if (settled !== undefined) return settled
  for (const thread of sessionByThread.values()) {
    if (thread.run?.approvals.has(toolCallId)) return 'pending'
  }
  return null
}

/** 按线程收敛一次审批（内部）：票据在手上就销号并回执 */
function settleApproval(threadID: string, approval: ChatToolApproval): boolean {
  const run = sessionByThread.get(threadID)?.run
  const ticket = run?.approvals.get(approval.toolCallId)
  if (!run || !ticket) return false
  run.approvals.delete(approval.toolCallId)
  ticket.settle({ outcome: parseAcpPermissionOutcome(approval, ticket.options) })
  // 先记回执再推事件：UI 下一次渲染就能拿到结论，不必等事件穿过泵
  rememberSettledApproval(approval.toolCallId, approval.approved)
  // 立刻把「已拍板」推回事件流：否则消息要一直等到 `tool-result` 才离开
  // `requires-action`，而工具可能跑几分钟 —— 用户看到的就是「点了审批没反应」。
  pushTurnEvent(threadID, {
    kind: 'tool-approval-settled',
    toolCallId: approval.toolCallId,
    approved: approval.approved
  })
  return true
}

/** 回答一次追问；定位与语义都同审批 */
function respondToElicitation(response: ChatElicitationResponse): boolean {
  for (const thread of sessionByThread.values()) {
    if (thread.run?.elicitations.has(response.elicitationId))
      return settleElicitation(thread.threadID, response)
  }
  return false
}

/** 按线程收敛一次追问（内部） */
function settleElicitation(threadID: string, response: ChatElicitationResponse): boolean {
  const run = sessionByThread.get(threadID)?.run
  const ticket = run?.elicitations.get(response.elicitationId)
  if (!run || !ticket) return false
  run.elicitations.delete(response.elicitationId)
  ticket.settle(parseAcpElicitationResponse(response))
  return true
}

/**
 * 手动压缩：对齐 goose desktop 的 MANUAL_COMPACT_TRIGGER —— 对已有 session 发 `/compact`。
 * 复用同一条 update 泵（压缩过程也会推 update），只是不把内容往外发。
 */
async function compactThreadSession(threadID: string): Promise<void> {
  const key = threadID.trim()
  if (!key) throw new Error('缺少会话 id，无法压缩上下文')

  await waitGooseReady()
  const handle = await findAcpHandle()
  const thread = sessionByThread.get(key)
  if (!thread || thread.connection !== handle.connection) {
    throw new Error('当前对话尚无 goose session，请先发送一条消息后再压缩')
  }
  if (thread.run) throw new Error('这一轮还在进行中，等它结束再压缩')

  const failureBox: { error: Error | null } = { error: null }
  const promptDone = thread.session.prompt([{ type: 'text', text: '/compact' }]).catch(function (
    error: unknown
  ) {
    failureBox.error = error instanceof Error ? error : new Error(String(error))
    return { stopReason: 'error' }
  })

  while (true) {
    const message = await thread.session.nextUpdate()
    if (message.kind === 'stop') break
    const update = message.notification.update
    if (update.sessionUpdate === 'usage_update') {
      writeGooseUsage(key, update.used, update.size)
    }
  }

  const response = await promptDone
  // compact 也推高 session 累计用量：更新基线，避免下一轮用户 prompt 把 compact 消耗算进去
  if (response && 'usage' in response && response.usage) {
    const usage = response.usage as {
      inputTokens?: number
      outputTokens?: number
      totalTokens?: number
    }
    usageBaseline.set(thread.acpSessionID, {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      totalTokens: usage.totalTokens ?? 0
    })
  }
  if (failureBox.error) throw failureBox.error
}

/** 切换 provider / model：写 goose defaults，并对已打开的 session 就地改配置 */
async function switchGooseProviderModel(
  providerID: string,
  modelID: string | undefined
): Promise<void> {
  await waitGooseReady()
  const handle = await findAcpHandle()
  try {
    await saveDefaults(handle.connection, providerID, modelID ?? null)
  } catch (error) {
    console.warn('[acp/session] defaultsSave 跳过:', error)
  }

  for (const thread of sessionByThread.values()) {
    if (thread.connection !== handle.connection) continue
    // 正在跑的会话不碰：改配置会打断别处那一轮（多会话并发时它可能正在后台生成）。
    // 它下一轮开始时 `ensureThreadSession` 会按当时选中的目标重新应用。
    if (thread.run) continue
    const applied = await syncProviderModel(
      handle.connection,
      thread.acpSessionID,
      providerID,
      modelID,
      thread.configOptions
    )
    thread.providerID = applied.providerId
    thread.modelID = applied.modelId
    thread.configOptions = applied.configOptions
    await syncModelsToStore(applied.providerId, applied.configOptions)
  }
}

/**
 * 温度写进 goose 全局配置（`GOOSE_TEMPERATURE`，对新会话生效）。
 * 界面滑杆是 0–2，goose 只收 0–1 —— 钳制在 `toGooseTemperature` 里做。
 * 写失败只提醒，不打断界面：温度是软参数，不该挡发送。
 */
async function applyGooseTemperature(temperature: number): Promise<void> {
  try {
    await waitGooseReady()
    const handle = await findAcpHandle()
    await saveTemperature(handle.connection, toGooseTemperature(temperature))
  } catch (error) {
    console.warn('[acp/session] 温度同步跳过:', error)
  }
}

/** 会话是否已经建过（UI 用它决定「压缩」是否可用，避免无 session 时白跑一趟） */
function hasThreadSession(threadID: string): boolean {
  return sessionByThread.has(threadID)
}

/**
 * 恢复订阅空闲：load 之后 goose **不会**再推 prompt 级 stop，只能靠静默推断结束。
 * - 窗口要覆盖长工具无输出（数分钟级），但总要有上限，否则 orphan 会永远挂起
 *   （刷新后 running 标记会粘住，不能靠「仍 running 就不收尾」）。
 * - 到期必须 `finish`，禁止 `error`——后者会被 adapter throw，观感像崩溃。
 */
const RESUME_IDLE_TIMEOUT_MS = 600_000

/**
 * resume 专用队列：load 重放阶段在入队时就截到「最后 user 之后」尾巴，
 * 避免整段 session/load 历史在 JS 里堆一份再二次过滤。
 */
function makeResumeQueue() {
  const items: Array<SessionUpdate | null> = []
  let wake: (() => void) | null = null
  /** load 返回前为 true：遇到 user chunk 清空已积压助手更新 */
  let isReplaying = true

  return {
    push(item: SessionUpdate | null) {
      if (isReplaying && item !== null && item.sessionUpdate === 'user_message_chunk') {
        // 历史用户消息本身不进 resume 流；只作截尾锚点
        items.length = 0
        return
      }
      items.push(item)
      const resume = wake
      wake = null
      resume?.()
    },
    async take(): Promise<SessionUpdate | null> {
      while (items.length === 0) {
        await new Promise<void>(function (resolve) {
          wake = resolve
        })
      }
      return items.shift()!
    },
    /**
     * 非阻塞取走当前已入队的全部项：`session/load` 返回时调用，
     * 此时队列里只剩「最后 user 之后」的助手更新（入队时已截尾）。
     */
    drain(): Array<SessionUpdate | null> {
      isReplaying = false
      return items.splice(0, items.length)
    }
  }
}

/**
 * 刷新后恢复进行中回合：用 session/load 接上 goose 会话。
 *
 * goose 声明 `loadSession` 而**不**声明 `session/resume`。`session/load` 会做两件事：
 * 1) 把会话全量历史重放成 session/update 通知（UserMessageChunk / AgentMessageChunk /
 *    ToolCall ...）；2) 把会话 attach 回当前连接 —— 后台仍在跑的一轮，其后续 update
 *    会继续推来。我们只取「进行中这一轮」：重放历史里最后一个 UserMessageChunk 之后的
 *    助手内容（detach 前已渲染过的历史由 SQLite 负责，这里不重复产）。
 *
 * 结束信号：goose 在 load 之外不推「这轮结束」标记（stop 只来自 session/prompt 响应），
 * 故用空闲超时兜底 —— load 后短窗口内一片静默就说明后台已跑完，yield finish 收尾。
 */
async function* resumeThreadRun(
  threadID: string,
  signal: AbortSignal | undefined
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  const remembered = await readBinding(threadID)
  if (!remembered || !remembered.cwd) {
    // 空流会落到适配器「流异常」；明确 aborted，让 UI 标「已停止」而非假错误
    yield { kind: 'aborted', usage: {} }
    return
  }

  const handle = await findAcpHandle()
  if (!handle.canLoadSession) {
    console.warn('[acp/session] goose 未声明 session/load，无法恢复进行中回合:', threadID)
    yield { kind: 'aborted', usage: {} }
    return
  }

  const queue = makeResumeQueue()
  const feed: ResumeFeed = {
    push: function (update) {
      queue.push(update)
    },
    close: function () {
      queue.push(null)
    }
  }
  resumeFeeds.set(remembered.acpSessionId, feed)

  let finished = false
  let closeReason: 'idle' | 'abort' | 'closed' = 'idle'
  const close = function (reason: 'idle' | 'abort' | 'closed') {
    if (finished) return
    finished = true
    closeReason = reason
    feed.close()
  }

  let onAbort: (() => void) | null = null
  if (signal) {
    onAbort = function () {
      close('abort')
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  handle.connection.closed.then(
    function () {
      close('closed')
    },
    function () {
      close('closed')
    }
  )

  const context: AcpStreamContext = {
    blockID: function (messageId, kind) {
      return messageId ? `${kind}:${messageId}` : `${kind}:run`
    },
    // live 续尾时 usage_update 也会推来：与正常 run 路径（pump 里单独处理）对齐，
    // 否则「后台还在跑、刷新后恢复」的场景里侧栏上下文占用会停在旧值。
    onContextUsage: function (usage) {
      writeGooseUsage(threadID, usage.used, usage.size)
    }
  }

  let idleTimer: ReturnType<typeof setTimeout> | null = null

  const armIdle = function () {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(function () {
      console.warn(
        '[acp/session] 恢复订阅空闲，按完成收尾（非 error）:',
        threadID,
        hasPersistedRunningTurn(threadID) ? '(仍有 running 标记)' : ''
      )
      close('idle')
    }, RESUME_IDLE_TIMEOUT_MS)
  }

  const terminal = function (): ChatStreamEvent {
    if (closeReason === 'idle') {
      // 静默收尾用 finish：禁止 error，否则 mapChatStreamToRunResults 会 throw
      return { kind: 'finish', finishReason: 'end_turn', usage: {} }
    }
    // abort（用户停止）与 closed（连接断开）都是未完成
    return { kind: 'aborted', usage: {} }
  }

  try {
    if (finished) {
      // 中止 / 断连发生在 load 之前：不发请求，直接按原因收尾
      yield terminal()
      return
    }

    try {
      await handle.connection.agent.request(methods.agent.session.load, {
        sessionId: remembered.acpSessionId,
        cwd: remembered.cwd,
        // load 是「接上」不是重建：空名单沿用会话已有扩展，不新增 MCP
        mcpServers: []
      })
    } catch (error) {
      console.warn('[acp/session] 恢复加载会话失败:', threadID, error)
      yield { kind: 'aborted', usage: {} }
      return
    }

    // load 重放已在入队时截尾：drain 出来的就是进行中这一轮
    const replayed = queue.drain()
    for (const update of replayed) {
      if (update === null) break
      const event = parseAcpStreamEvent(update, context)
      if (event) yield event
    }

    armIdle()
    while (true) {
      const update = await queue.take()
      if (update === null) break
      armIdle()
      const event = parseAcpStreamEvent(update, context)
      if (event) yield event
    }

    // mapChatStreamToRunResults 靠 finish/aborted 才能出终态快照，这里补上
    yield terminal()
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
    // orphan resume 结束：无论 finish / aborted，清掉粘住的 running 标记
    clearPersistedRunning(threadID)
    resumeFeeds.delete(remembered.acpSessionId)
    if (signal && onAbort) signal.removeEventListener('abort', onAbort)
  }
}

/** 读某 thread 已建立 goose session 的 ACP session id（未建立则 null）；设置面枚举工具用 */
function findThreadAcpSessionID(threadID: string): string | null {
  return sessionByThread.get(threadID.trim())?.acpSessionID ?? null
}

export {
  applyGooseTemperature,
  clearThreadSessions,
  closeThreadSession,
  compactThreadSession,
  ensureThreadSession,
  findApprovalState,
  findThreadAcpSessionID,
  hasThreadSession,
  humanizeRunError,
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
export type { ThreadRunItem }
