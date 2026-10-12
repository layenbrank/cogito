/**
 * Goose ACP 对话：sidecar 为传输层；session 按 UI sessionID 绑定（对齐 goose desktop）
 * 对话路径只 setConfigOption，不写 config/save。
 */
import type { ActiveSession } from '@agentclientprotocol/sdk'
import {
  methods,
  type ClientConnection,
  type SessionConfigOption,
  type SessionConfigSelectOption,
  type SessionConfigSelectOptions
} from '@agentclientprotocol/sdk'
import { invoke } from '@tauri-apps/api/core'
import { homeDir } from '@tauri-apps/api/path'

import { bindGooseNotReady, clearAcpHandle, findAcpHandle } from '@/features/agent/acp/connection'
import { saveDefaults } from '@/features/agent/acp/goose-providers'
import { clearGooseUsage, writeGooseUsage } from '@/features/agent/acp/goose-usage'
import { parseAcpSessionUpdate, parseAcpUsageUpdate } from '@/features/agent/acp/normalize'
import { parseModels, stringifyModels } from '@/features/agent/model/providers'
import type { ChatMessage, NormalizedChunk, ProviderConfig } from '@/features/agent/types'
import { CHANNELS } from '@/shared/ipc/channels'
import { StatusSchema } from '@/shared/ipc/specs/sidecar'
import { useAgentStore } from '@/stores/agent'
import { useProviderStore } from '@/stores/provider'

/** ACP stdio MCP 条目（与 @agentclientprotocol/sdk McpServer 同形） */
interface AcpMcpServer {
  name: string
  command: string
  args: string[]
  env: Array<{ name: string; value: string }>
}

const COREX_MCP_PREF_KEY = 'corex.mcp.tools'

/** 开关：默认开；`VITE_COREX_MCP=0` 或 localStorage `corex.mcp.tools=0` 关闭。无旧工具适配层。 */
function isCorexToolsEnabled(): boolean {
  try {
    if (import.meta.env.VITE_COREX_MCP === '0') return false
    const stored = localStorage.getItem(COREX_MCP_PREF_KEY)
    if (stored === '0' || stored === 'false') return false
  } catch (error) {
    // 读不到偏好（隐私模式等）时按默认「开」处理，但要留痕
    console.warn('[goose-acp] 读取 corex-mcp 开关失败，按默认开启处理:', error)
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
      console.info('[goose-acp] 未注入 corex-mcp：缺少 mcpPath 或 dataDir')
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
    console.warn('[goose-acp] 解析 corex-mcp 注入失败:', error)
    return []
  }
}

interface GooseChatParams {
  signal?: AbortSignal
  sessionID?: string
}

interface AcpSessionCache {
  session: ActiveSession
  sessionID: string
  cwd: string
  providerId: string | null
  modelId: string | null
  configOptions: SessionConfigOption[] | null
  connection: unknown
}

const READY_POLL_MS = 500
const READY_TIMEOUT_MS = 30_000
const GOOSE_SERVE_NOT_READY = 'goose serve 未就绪'
const GOOSE_SYSTEM_PROMPT_SET = '_goose/unstable/session/system-prompt/set'

/** UI sessionID → ActiveSession（禁止仅按 cwd 复用，避免串话） */
const sessionByID = new Map<string, AcpSessionCache>()

bindGooseNotReady(function () {
  clearSessionCaches()
  clearGooseUsage()
})

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

function findLatestUserText(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'user' && message.content) return message.content
  }
  return ''
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

/**
 * fail-closed：必须命中 preferred；选项列表为空时返回 null（跳过 set，避免 Invalid params）
 */
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

  throw new Error(
    `goose 未提供 ${configId}=${wanted}（可选：${ids.slice(0, 8).join(', ') || '无'}）。请先在设置中配置供应商`
  )
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

function wrapInvalidParams(error: unknown, prefix: string): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/invalid\s*params/i.test(message)) {
    return new Error(
      `${prefix}：Invalid params。请确认 goose 已配置该供应商（设置里保存），且模型名与 goose 一致`
    )
  }
  return error instanceof Error ? error : new Error(`${prefix}: ${message}`)
}

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

function disposeSessionCache(cache: AcpSessionCache) {
  try {
    cache.session.dispose()
  } catch (error) {
    // 清理失败不该阻断后续清理，但原因要留下
    console.warn('[goose-acp] dispose session 失败:', error)
  }
}

function clearSessionCaches() {
  for (const cache of sessionByID.values()) {
    disposeSessionCache(cache)
  }
  sessionByID.clear()
}

function clearGooseRuntime() {
  clearSessionCaches()
  clearAcpHandle()
}

/**
 * 更新 goose defaults，并对已打开的 ACP session 做 setConfigOption
 */
async function switchGooseProviderModel(
  providerId: string,
  modelId: string | undefined
): Promise<void> {
  await waitGooseReady()
  const handle = await findAcpHandle()
  try {
    await saveDefaults(handle.connection, providerId, modelId ?? null)
  } catch (error) {
    console.warn('[goose-acp] defaultsSave 跳过:', error)
  }

  for (const cache of sessionByID.values()) {
    if (cache.connection !== handle.connection) continue
    const applied = await applyProviderModel(
      handle.connection,
      cache.session.sessionId,
      providerId,
      modelId,
      cache.configOptions
    )
    cache.providerId = applied.providerId
    cache.modelId = applied.modelId
    cache.configOptions = applied.configOptions
    await syncModelsToStore(applied.providerId, applied.configOptions)
  }
}

async function openAcpSession(
  sessionID: string,
  cwd: string,
  providerId: string,
  modelId: string | undefined
): Promise<AcpSessionCache> {
  const handle = await findAcpHandle()
  if (handle.needsProviderAuth) {
    console.info('[goose-acp] authMethods 含 goose-provider，请确认已在设置中配置供应商')
  }

  const mcpServers = await findCorexMcpServers(sessionID)
  const session = await handle.connection.agent
    .buildSession({
      cwd,
      mcpServers,
      _meta: { client: 'i-thinking' }
    })
    .start()

  let configOptions = session.newSessionResponse.configOptions ?? null
  const applied = await applyProviderModel(
    handle.connection,
    session.sessionId,
    providerId,
    modelId,
    configOptions
  )
  configOptions = applied.configOptions
  await syncModelsToStore(applied.providerId, configOptions)

  const cache: AcpSessionCache = {
    session,
    sessionID,
    cwd,
    providerId: applied.providerId,
    modelId: applied.modelId,
    configOptions,
    connection: handle.connection
  }
  handle.connection.closed.then(
    function () {
      const current = sessionByID.get(sessionID)
      if (current === cache) sessionByID.delete(sessionID)
    },
    function () {
      const current = sessionByID.get(sessionID)
      if (current === cache) sessionByID.delete(sessionID)
    }
  )
  return cache
}

async function ensureAcpSession(
  sessionID: string,
  cwd: string,
  providerId: string,
  modelId: string | undefined
): Promise<AcpSessionCache> {
  const handle = await findAcpHandle()
  const cached = sessionByID.get(sessionID)
  if (cached && cached.cwd === cwd && cached.connection === handle.connection) {
    const sameProvider = providerId === cached.providerId
    const sameModel = !modelId?.trim() || modelId === cached.modelId
    if (!sameProvider || !sameModel) {
      const applied = await applyProviderModel(
        handle.connection,
        cached.session.sessionId,
        providerId,
        modelId,
        cached.configOptions
      )
      cached.providerId = applied.providerId
      cached.modelId = applied.modelId
      cached.configOptions = applied.configOptions
      await syncModelsToStore(applied.providerId, applied.configOptions)
    }
    return cached
  }

  if (cached) {
    disposeSessionCache(cached)
    sessionByID.delete(sessionID)
  }

  const opened = await openAcpSession(sessionID, cwd, providerId, modelId)
  sessionByID.set(sessionID, opened)
  return opened
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
  if (code === -32000 || /auth|sign.?in|api.?key|configure|provider/i.test(message)) {
    return new Error(`${message}（请在设置中保存供应商配置，或执行 goose configure）`)
  }
  if (/invalid\s*params/i.test(message)) {
    return wrapInvalidParams(error, '请求参数无效')
  }
  return error instanceof Error ? error : new Error(message)
}

async function* chatGooseAcp(
  config: ProviderConfig,
  messages: ChatMessage[],
  params: GooseChatParams = {}
): AsyncGenerator<NormalizedChunk, void, unknown> {
  const sessionID = params.sessionID?.trim()
  if (!sessionID) {
    throw new Error('缺少 sessionID，无法建立 goose ACP 会话')
  }

  const promptText = findLatestUserText(messages).trim()
  if (!promptText) {
    yield { done: true, finishReason: 'stop' }
    return
  }

  const systemText = messages
    .find(function (item) {
      return item.role === 'system' && item.content?.trim()
    })
    ?.content?.trim()

  await waitGooseReady()
  const [handle, cwd] = await Promise.all([findAcpHandle(), findWorkspaceCwd()])
  const { session } = await ensureAcpSession(sessionID, cwd, config.kind, config.model)

  if (systemText) {
    try {
      await handle.connection.agent.request(GOOSE_SYSTEM_PROMPT_SET, {
        sessionId: session.sessionId,
        mode: 'append',
        key: 'i-thinking',
        text: systemText
      })
    } catch (error) {
      console.warn('[goose-acp] 设置 system prompt 失败（可忽略）:', error)
    }
  }

  const failureBox: { error?: Error } = {}
  const promptBlocks = [{ type: 'text' as const, text: promptText }]

  const promptPromise = session
    .prompt(promptBlocks, params.signal ? { cancellationSignal: params.signal } : undefined)
    .catch(function (error: unknown) {
      failureBox.error = parseAuthRequired(error)
    })

  while (true) {
    if (params.signal?.aborted) {
      yield { done: true, finishReason: 'cancelled' }
      break
    }
    if (failureBox.error) break

    const message = await session.nextUpdate()
    if (message.kind === 'stop') {
      yield {
        done: true,
        finishReason: message.stopReason === 'cancelled' ? 'cancelled' : 'stop'
      }
      break
    }

    const usage = parseAcpUsageUpdate(message.notification)
    if (usage) writeGooseUsage(sessionID, usage.used, usage.size)

    const chunk = parseAcpSessionUpdate(message.notification)
    if (chunk) yield chunk
  }

  await promptPromise
  if (failureBox.error) throw failureBox.error
}

/**
 * 手动压缩：对齐 Desktop MANUAL_COMPACT_TRIGGER，对已有 session prompt `/compact`
 */
async function compactGooseSession(sessionID: string): Promise<void> {
  const key = sessionID.trim()
  if (!key) throw new Error('缺少 sessionID，无法压缩上下文')

  await waitGooseReady()
  const handle = await findAcpHandle()
  const cached = sessionByID.get(key)
  if (!cached || cached.connection !== handle.connection) {
    throw new Error('当前对话尚无 goose session，请先发送一条消息后再压缩')
  }

  const failureBox: { error?: Error } = {}
  const promptPromise = cached.session.prompt([{ type: 'text', text: '/compact' }]).catch(function (
    error: unknown
  ) {
    failureBox.error = error instanceof Error ? error : new Error(String(error))
  })

  while (true) {
    if (failureBox.error) break
    const message = await cached.session.nextUpdate()
    if (message.kind === 'stop') break
    const usage = parseAcpUsageUpdate(message.notification)
    if (usage) writeGooseUsage(key, usage.used, usage.size)
  }

  await promptPromise
  if (failureBox.error) throw failureBox.error
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

export {
  chatGooseAcp,
  clearGooseRuntime,
  compactGooseSession,
  switchGooseProviderModel,
  waitGooseReady
}
