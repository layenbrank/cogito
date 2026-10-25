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
import { homeDir } from '@tauri-apps/api/path'
import { v4 as UUIDV4 } from 'uuid'

import type {
  ChatApprovalOption,
  ChatElicitationResponse,
  ChatStreamEvent,
  ChatToolApproval
} from '@cogito/chat/ports'

import { bindAcpRequestRouter, bindGooseNotReady, findAcpHandle } from '@/features/agent/acp/connection'
import { clearGooseUsage, writeGooseUsage } from '@/features/agent/acp/goose-usage'
import { saveDefaults } from '@/features/agent/acp/goose-providers'
import { findPref } from '@/features/persist'
import {
  parseAcpApprovalRequest,
  parseAcpElicitationRequest,
  parseAcpElicitationResponse,
  parseAcpPermissionOutcome
} from '@/features/agent/acp/stream'
import { parseModels, stringifyModels } from '@/features/agent/model/providers'
import { CHANNELS } from '@/shared/ipc/channels'
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

const READY_POLL_MS = 500
const READY_TIMEOUT_MS = 30_000
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
  /** 正在跑的那一轮（同一会话同时只允许一轮：并发 prompt 会让 goose 侧乱序） */
  run: ThreadRun | null
}

interface ThreadRun {
  queue: ReturnType<typeof createItemQueue>
  /** 审批票据：键是 ACP 的 toolCallId */
  approvals: Map<string, Ticket<RequestPermissionResponse> & { options: readonly ChatApprovalOption[] }>
  /** 追问票据：键是本模块合成的 elicitationId（form 模式 ACP 不给 id） */
  elicitations: Map<string, Ticket<CreateElicitationResponse>>
  prompt: { cancelled: boolean }
}

/** 会话登记表：按 thread 查（UI 侧），也按 ACP sessionId 查（agent 回调侧） */
const sessionByThread = new Map<string, ThreadSession>()
const sessionByAcpID = new Map<string, ThreadSession>()

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
function createItemQueue() {
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
function createTicket<T>(timeoutValue: T): Ticket<T> {
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

function sleep(ms: number): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

async function waitGooseReady(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const status = await invoke<boolean | null>(CHANNELS.GOOSE.READY)
    if (status === true) {
      await findAcpHandle()
      return
    }
    if (status === false) throw new Error(GOOSE_SERVE_NOT_READY)
    await sleep(READY_POLL_MS)
  }
  throw new Error(GOOSE_SERVE_NOT_READY)
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

/** 会话的工作目录：取当前工作区的主目录，没有就退回用户家目录 */
async function findWorkspaceCwd(): Promise<string> {
  const state = useAgentStore.getState()
  const workspaceID = state.activeWorkspaceID
  const primary = state.workspaceFolders.find(function (item) {
    return item.workspaceID === workspaceID && item.isPrimary
  })
  if (primary?.path) return primary.path
  const anyFolder = state.workspaceFolders.find(function (item) {
    return item.workspaceID === workspaceID
  })
  if (anyFolder?.path) return anyFolder.path
  return homeDir()
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
async function applyProviderModel(
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
  // 网关 401 / 用户未登录：组织模型走 JWT helper，不是 goose configure
  if (/用户未登录|401\s*unauthorized|authentication failed for .*gateway/i.test(message)) {
    return new Error(
      '组织模型鉴权失败（网关未收到有效登录令牌）。请重新登录后重试；若仍失败，完整重启客户端以重载 goose',
      { cause: error instanceof Error ? error : undefined }
    )
  }
  if (code === -32000 || /auth|sign.?in|api.?key|configure|provider/i.test(message)) {
    return new Error(`${message}（请在设置中保存供应商配置，或执行 goose configure）`)
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
  if (!Number.isNaN(code) || data !== null && data !== undefined) {
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
}

/** goose 退出 / 重连：会话与上下文用量都得清（旧 session 已经不可用） */
function clearThreadSessions() {
  for (const thread of sessionByThread.values()) {
    disposeThreadSession(thread)
    usageBaseline.delete(thread.acpSessionID)
  }
  sessionByThread.clear()
  sessionByAcpID.clear()
  clearGooseUsage()
}

bindGooseNotReady(clearThreadSessions)
// agent 反向发起的审批 / 追问交给本模块（连接的注册在 `connection.ts`，见那里的环注释）
bindAcpRequestRouter({
  requestPermission: requestThreadPermission,
  requestElicitation: requestThreadElicitation
})

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

  const mcpServers = await findCorexMcpServers(threadID)
  const session = await handle.connection.agent
    .buildSession({
      cwd,
      mcpServers,
      _meta: { client: 'cogito' }
    })
    .start()

  const initialOptions = session.newSessionResponse.configOptions ?? null
  const applied = await applyProviderModel(
    handle.connection,
    session.sessionId,
    providerID,
    modelID,
    initialOptions
  )
  await syncModelsToStore(applied.providerId, applied.configOptions)

  const thread: ThreadSession = {
    threadID,
    acpSessionID: session.sessionId,
    session,
    cwd,
    providerID: applied.providerId,
    modelID: applied.modelId,
    configOptions: applied.configOptions,
    connection: handle.connection,
    run: null
  }
  sessionByAcpID.set(thread.acpSessionID, thread)
  handle.connection.closed.then(
    function () {
      forgetThreadSession(thread)
    },
    function () {
      forgetThreadSession(thread)
    }
  )
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
  providerID: string,
  modelID: string | undefined
): Promise<ThreadSession> {
  await waitGooseReady()
  const [handle, cwd] = await Promise.all([findAcpHandle(), findWorkspaceCwd()])
  const cached = sessionByThread.get(threadID)

  if (cached && cached.cwd === cwd && cached.connection === handle.connection) {
    const sameProvider = providerID === cached.providerID
    const sameModel = !modelID?.trim() || modelID === cached.modelID
    if (!sameProvider || !sameModel) {
      const applied = await applyProviderModel(
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
    return cached
  }

  if (cached) {
    disposeThreadSession(cached)
    forgetThreadSession(cached)
  }

  const opened = await openThreadSession(threadID, cwd, providerID, modelID)
  sessionByThread.set(threadID, opened)
  return opened
}

/**
 * 跑一轮 prompt。
 *
 * 产出的终态**只有一个** `stop`：ACP 的 `session/prompt` 返回值、取消、异常三条路
 * 都归到这里，调用方据此发一个终态事件（不能发两个，assistant-ui 会认为这轮还没完）。
 */
async function* runThreadPrompt(
  threadID: string,
  input: { text: string; systemText?: string; providerID: string; modelID?: string; signal?: AbortSignal }
): AsyncGenerator<ThreadRunItem, void, unknown> {
  const promptText = input.text.trim()
  if (!promptText) {
    yield { kind: 'stop', stopReason: 'end_turn' }
    return
  }

  const thread = await ensureThreadSession(threadID, input.providerID, input.modelID)
  if (thread.run) {
    throw new Error('这个会话已经有一轮在进行中，请先等它结束或中止')
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

  const queue = createItemQueue()
  const run: ThreadRun = {
    queue,
    approvals: new Map(),
    elicitations: new Map(),
    prompt: { cancelled: false }
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
      run.prompt.cancelled = true
    }
    if (input.signal.aborted) onAbort()
    else input.signal.addEventListener('abort', onAbort, { once: true })
  }

  // ACP 推送的 update 与 agent 发起的审批/追问是同一条队列的两个生产者：这里只负责把
  // update 泵进去，直到 goose 明确说这轮结束，或本轮被 release
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
  })()

  // 用 box 装失败：TS 的收窄看不到「回调里赋的值」，直接写 `let failure` 会在 throw 处被当成 null
  const failureBox: { error: Error | null } = { error: null }
  const promptDone = thread.session
    .prompt([{ type: 'text' as const, text: promptText }], input.signal ? { cancellationSignal: input.signal } : undefined)
    .catch(function (error: unknown) {
      failureBox.error = parseAuthRequired(error)
      const stopReason = run.prompt.cancelled || input.signal?.aborted ? 'cancelled' : 'error'
      queue.push({ kind: 'stop', stopReason })
      releaseBox.release?.()
    })

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
    thread.run = null
    releaseBox.release?.()
    // 这一轮没被回答的票据全部作废：留着的 promise 会让 goose 侧一直等，且用户看到的
    // 「待审批」永远不会消失（票随轮次生死）
    for (const ticket of run.approvals.values()) ticket.settle({ outcome: { outcome: 'cancelled' } })
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
 * agent 请求权限（由连接的 `session/request_permission` 回调转进来）。
 *
 * 找不到对应会话时**按取消回复**：宁可让 agent 知道这次没被批准，也不能让它悬着。
 */
async function requestThreadPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
  const thread = sessionByAcpID.get(params.sessionId)
  const run = thread?.run
  if (!thread || !run) {
    return { outcome: { outcome: 'cancelled' } }
  }

  const event = parseAcpApprovalRequest(params)
  const options = event.kind === 'tool-approval-request' ? (event.options ?? []) : []
  const toolCallId = params.toolCall.toolCallId
  const previous = run.approvals.get(toolCallId)
  if (previous) previous.settle({ outcome: { outcome: 'cancelled' } })
  const ticket = createTicket<RequestPermissionResponse>({ outcome: { outcome: 'cancelled' } })
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
  const ticket = createTicket<CreateElicitationResponse>({ action: 'cancel' })
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
    if (thread.run?.approvals.has(approval.toolCallId)) return settleApproval(thread.threadID, approval)
  }
  return false
}

/** 按线程收敛一次审批（内部）：票据在手上就销号并回执 */
function settleApproval(threadID: string, approval: ChatToolApproval): boolean {
  const run = sessionByThread.get(threadID)?.run
  const ticket = run?.approvals.get(approval.toolCallId)
  if (!run || !ticket) return false
  run.approvals.delete(approval.toolCallId)
  ticket.settle({ outcome: parseAcpPermissionOutcome(approval, ticket.options) })
  return true
}

/** 回答一次追问；定位与语义都同审批 */
function respondToElicitation(response: ChatElicitationResponse): boolean {
  for (const thread of sessionByThread.values()) {
    if (thread.run?.elicitations.has(response.elicitationId)) return settleElicitation(thread.threadID, response)
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
  const promptDone = thread.session.prompt([{ type: 'text', text: '/compact' }]).catch(function (error: unknown) {
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
async function switchGooseProviderModel(providerID: string, modelID: string | undefined): Promise<void> {
  await waitGooseReady()
  const handle = await findAcpHandle()
  try {
    await saveDefaults(handle.connection, providerID, modelID ?? null)
  } catch (error) {
    console.warn('[acp/session] defaultsSave 跳过:', error)
  }

  for (const thread of sessionByThread.values()) {
    if (thread.connection !== handle.connection) continue
    const applied = await applyProviderModel(
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

/** 会话是否已经建过（UI 用它决定「压缩」是否可用，避免无 session 时白跑一趟） */
function hasThreadSession(threadID: string): boolean {
  return sessionByThread.has(threadID)
}

/** 读某 thread 已建立 goose session 的 ACP session id（未建立则 null）；设置面枚举工具用 */
function findThreadAcpSessionID(threadID: string): string | null {
  return sessionByThread.get(threadID.trim())?.acpSessionID ?? null
}

export {
  clearThreadSessions,
  compactThreadSession,
  ensureThreadSession,
  findThreadAcpSessionID,
  hasThreadSession,
  requestThreadElicitation,
  requestThreadPermission,
  respondToApproval,
  respondToElicitation,
  runThreadPrompt,
  switchGooseProviderModel,
  waitGooseReady
}
export type { ThreadRunItem }
