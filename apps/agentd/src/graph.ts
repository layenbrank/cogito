/**
 * 最小编排图：`START → goose → END`。
 *
 * 刻意**不含任何模型调用**：推理与工具都在 goose 里发生（唯一出网点仍是 gateway）。
 * 后续 P6 会在此扩成 `plan → worker → review → humanGate`，但每个节点仍然只是
 * 「开一个 goose 会话跑一轮」，不会自己连 LLM。
 *
 * **会话复用是本节点的关键**：`sessionId` 进 state（因此进 checkpoint），第二轮不再
 * `session/new`。否则每轮都是全新会话，模型看不到上一轮说过什么 —— 这不是「体验降级」，
 * 而是多轮对话根本不成立。goose 重启后旧 sessionId 会失效，所以失败时重开一次。
 */

import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import { listHardDenyToolNames } from '@cogito/agent-protocol/policy'

import type { GooseAcpClient } from './goose/client'
import type { GooseSupervisor } from './goose/supervisor'
import type { ApprovalHub } from './approvals'
import type { ElicitationHub } from './elicitations'
import { toErrorExcerpt } from './error-kind'
import type { EventHub } from './events'
import type { Metrics } from './observability'

const OrchestrationState = Annotation.Root({
  /** 客户端 `agent_session.id` */
  threadID: Annotation<string>({
    reducer: function (_prev, next) {
      return next
    },
    default: function () {
      return ''
    }
  }),
  /** 工作区绝对路径（`session/new` 的 cwd） */
  cwd: Annotation<string>({
    reducer: function (_prev, next) {
      return next
    },
    default: function () {
      return process.cwd()
    }
  }),
  /** 用户这一轮的消息 */
  prompt: Annotation<string>({
    reducer: function (_prev, next) {
      return next
    },
    default: function () {
      return ''
    }
  }),
  /** goose 这一轮产出的正文（增量拼好） */
  reply: Annotation<string>({
    reducer: function (_prev, next) {
      return next
    },
    default: function () {
      return ''
    }
  }),
  /** goose 会话 id：跨轮复用，goose 重启后失效（节点会重开一次） */
  sessionId: Annotation<string>({
    reducer: function (_prev, next) {
      return next
    },
    default: function () {
      return ''
    }
  }),
  /**
   * 本轮要用的会话权限档（`auto` / `approve` / `smart_approve` / `chat`）。
   *
   * 空串 = 沿用 goose 自己的当前档。前端每轮都会传（审批是安全闸门，不能靠默认值），
   * 这里只是不把它写进 checkpoint —— 档位属于「这次调用」而不是「这个会话的历史」。
   */
  mode: Annotation<string>({
    reducer: function (_prev, next) {
      return next
    },
    default: function () {
      return ''
    }
  }),
  /**
   * `session/new` 的 MCP 服务器（cogito-mcp / corex 等）。
   *
   * 只在**建会话**时生效；会话复用时必须与上次一致，否则工具面会静默地少一批
   * （goose 不会因为 mcpServers 变了而重挂）。前端总是全量给出，这里不合并。
   */
  mcpServers: Annotation<readonly unknown[]>({
    reducer: function (_prev, next) {
      return next
    },
    default: function (): readonly unknown[] {
      return []
    }
  }),
  /**
   * 建会话那一刻用的 MCP 配置指纹（见 `fingerprintMcpServers`）。
   *
   * 必须有它才能判断「当前这轮的 MCP 配置和会话实际挂的一致吗」：桥地址是内核随机端口，
   * app 一重启就换，而复用旧会话不会重挂 MCP —— `cogito-mcp` 会去连一个没人监听的端口，
   * 日志里留一行「桥不可达 … os error 10061」，前端看到的是整个本地工具面消失。
   */
  mcpFingerprint: Annotation<string>({
    reducer: function (_prev, next) {
      return next
    },
    default: function () {
      return ''
    }
  }),
  /**
   * 附加到会话上的系统提示（`append` 模式，key=`cogito`）。
   *
   * 必须由 agentd 写：session 是在它内部建的，前端拿不到「刚建好」那个时机。
   */
  systemText: Annotation<string>({
    reducer: function (_prev, next) {
      return next
    },
    default: function () {
      return ''
    }
  })
})

interface TextChunk {
  type?: string
  text?: string
}

/** 一轮的结果：正文 + 实际用的 sessionId（首轮新建时要写回 state）。 */
interface TurnResult {
  reply: string
  sessionId: string
  /** 本次建会话用的 MCP 指纹；复用会话时原样带回 */
  mcpFingerprint: string
}

/**
 * MCP 配置指纹：`name` + `command` + `args` + 排序后的 `env`。
 *
 * 只取会影响「子进程怎么被拉起」的字段。`COGITO_BRIDGE_URL` 每次 app 重启都变，
 * 所以这个指纹天然能反映「旧会话挂的 MCP 已经连不上了」。
 */
function fingerprintMcpServers(servers: readonly unknown[]): string {
  if (servers.length === 0) return ''
  const rows = servers.map(function (server) {
    const item = (server ?? {}) as {
      name?: unknown
      command?: unknown
      args?: unknown
      env?: unknown
    }
    const env = Array.isArray(item.env) ? item.env : []
    const pairs = env
      .map(function (entry) {
        const pair = (entry ?? {}) as { name?: unknown; value?: unknown }
        return `${String(pair.name ?? '')}=${String(pair.value ?? '')}`
      })
      .sort()
    return [
      String(item.name ?? ''),
      String(item.command ?? ''),
      JSON.stringify(item.args ?? []),
      pairs.join('&')
    ].join('|')
  })
  return rows.sort().join('\n')
}

/** 判断错误是不是「会话没了」（goose 重启 / session/load 失败）。 */
function isStaleSession(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /session/i.test(message) && /(not found|unknown|closed|不存在|失效|-32002)/i.test(message)
}

function collectText(chunks: TextChunk[]): string {
  return chunks
    .map(function (chunk) {
      return chunk.type === 'text' && typeof chunk.text === 'string' ? chunk.text : ''
    })
    .join('')
}

/** 工具名：与客户端同一口径（`name` → `title` → 占位），日志与工具卡才对得上 */
function findToolTraceName(record: Record<string, unknown>): string {
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (name) return name
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  return title || 'tool'
}

/**
 * 失败原因摘录：客户端有完整格式化，这里只要「够 grep 的一行」。
 *
 * 形状来自 ACP：结构化结果在 `rawOutput`，展示块在 `content`（可能多块）。
 * 都没有就返回 undefined —— 不拿空串冒充「有原因」。
 */
function findToolErrorExcerpt(record: Record<string, unknown>): string | undefined {
  const raw = record.rawOutput
  if (typeof raw === 'string' && raw.trim()) return toErrorExcerpt(raw)
  if (Array.isArray(record.content)) {
    const parts: string[] = []
    for (const block of record.content) {
      if (!block || typeof block !== 'object') continue
      const item = block as { text?: unknown; content?: unknown }
      if (typeof item.text === 'string' && item.text.trim()) parts.push(item.text)
      else if (typeof item.content === 'string' && item.content.trim()) parts.push(item.content)
    }
    if (parts.length > 0) return toErrorExcerpt(parts.join('\n'))
  }
  if (raw !== undefined && raw !== null) {
    try {
      return toErrorExcerpt(JSON.stringify(raw))
    } catch {
      return undefined
    }
  }
  return undefined
}

/** 依赖多了就不该再堆位置参数（`createGooseGraph(a, b, c, d)` 可读性为零）。 */
interface GooseGraphOptions {
  supervisor: GooseSupervisor
  checkpointer?: BaseCheckpointSaver
  approvals?: ApprovalHub
  /** 结构化追问（`elicitation/create`）：与审批同构，但回执形状不同 */
  elicitations?: ElicitationHub
  /** 把 goose 的 `session/update` 原样送去 `/threads/:id/events` */
  events?: EventHub
  /**
   * 结构化日志（`AGENTD_EVENT`）：工具调用**发生在 goose 内部**，agentd 只在
   * update 流里看得见它。不在这里记，日志里就只剩「这一轮失败了」这一句话。
   */
  logEvent?: ((name: string, fields?: Record<string, unknown>) => void) | null
  /** 计数器（工具成败）；为 null 时只是不计数 */
  metrics?: Metrics | null
}

function createGooseGraph(options: GooseGraphOptions) {
  const { supervisor, checkpointer, approvals, elicitations, events, logEvent, metrics } = options
  /** sessionId → threadID：审批请求只带 sessionId，得靠这张表回到线程。 */
  const sessionThreads = new Map<string, string>()

  /**
   * 每次拿到 client 都重新注册（goose 重启后 client 是新的）。
   * 同一个函数重复注册无副作用：它只读 `sessionThreads`。
   */
  function bindIncoming(client: GooseAcpClient): void {
    if (approvals) {
      client.onPermissionRequest(function (prompt) {
        const threadID = sessionThreads.get(prompt.sessionId) ?? prompt.sessionId
        return approvals.ask({
          threadID,
          sessionId: prompt.sessionId,
          toolCall: prompt.toolCall,
          options: prompt.options
        })
      })
    }
    if (elicitations) {
      client.onElicitationRequest(function (prompt) {
        const threadID = sessionThreads.get(prompt.sessionId) ?? prompt.sessionId
        return elicitations.ask({
          threadID,
          sessionId: prompt.sessionId,
          mode: prompt.mode,
          message: prompt.message,
          requestedSchema: prompt.requestedSchema,
          ...(prompt.url ? { url: prompt.url } : {})
        })
      })
    }
  }

  /**
   * 在一个已知 session 上跑一轮：
   * - 每条 `session/update` 原样发到事件流（前端靠它渲染正文与工具卡）；
   * - 同时只聚合 `agent_message_chunk` 的正文（写回 state，供 `/state` 与审计用）。
   */
  async function runTurn(
    client: GooseAcpClient,
    sessionId: string,
    prompt: string,
    threadID: string
  ): Promise<string> {
    const chunks: TextChunk[] = []
    /**
     * 工具调用的开始时刻，按 `toolCallId` 对账。
     *
     * `tool_call_update` 只带终态与 id，不带开始时间：不在这里记，日志里就没有耗时，
     * 「工具慢」和「模型慢」又会混成一团。
     */
    const pendingToolCalls = new Map<string, { name: string; startedAt: number }>()
    const unsubscribe = client.onSessionUpdate(function (updatedSessionId, update) {
      if (updatedSessionId !== sessionId) return
      if (typeof update !== 'object' || update === null) return
      // 事件流是**原始形状**：前端的 ACP 解析器按 session/update 的字段读，不再抄一遍
      events?.emit(threadID, 'update', update)
      const record = update as Record<string, unknown>

      // 工具卡在 goose 内部跑：成败只有这条流看得见，不记下来事后无从对账
      if (record.sessionUpdate === 'tool_call') {
        const toolCallId = typeof record.toolCallId === 'string' ? record.toolCallId : ''
        if (toolCallId) {
          pendingToolCalls.set(toolCallId, {
            name: findToolTraceName(record),
            startedAt: Date.now()
          })
        }
        return
      }

      if (record.sessionUpdate === 'tool_call_update') {
        // 中间态（in_progress）不记：一轮里几十条，日志会被进度刷满
        if (record.status !== 'completed' && record.status !== 'failed') return
        const toolCallId = typeof record.toolCallId === 'string' ? record.toolCallId : ''
        const started = toolCallId ? pendingToolCalls.get(toolCallId) : undefined
        if (toolCallId) pendingToolCalls.delete(toolCallId)
        const fields = {
          threadID,
          gooseSessionId: sessionId,
          tool: started?.name ?? findToolTraceName(record),
          toolCallId,
          durationMs: started ? Date.now() - started.startedAt : undefined
        }
        if (record.status === 'failed') {
          metrics?.inc('tools.failed')
          logEvent?.('tool.failed', { ...fields, error: findToolErrorExcerpt(record) })
        } else {
          metrics?.inc('tools.completed')
          logEvent?.('tool.completed', fields)
        }
        return
      }

      if (record.sessionUpdate !== 'agent_message_chunk') return
      const content = record.content
      if (typeof content === 'object' && content !== null) {
        chunks.push(content as TextChunk)
      }
    })

    try {
      await client.prompt(sessionId, prompt)
    } finally {
      unsubscribe()
    }
    return collectText(chunks)
  }

  /** 设置本会话的权限档；空值不改（沿用 goose 当前档）。
   *
   * **不是** `session/set_mode`：goose 对那个方法宽容返回 `{}` 但不改状态（实测：
   * 设 approve 后 write 仍直接执行）。真正的开关在 `configOptions` 里的 `mode` 项。
   */
  async function applyMode(client: GooseAcpClient, sessionId: string, mode: string): Promise<void> {
    if (!mode) return
    await client.request('session/set_config_option', {
      sessionId,
      configId: 'mode',
      value: mode
    })
  }

  /**
   * 已同步过硬禁用的 goose 会话。
   *
   * 键是 goose 的 session id：goose 重启后会话消失，重开时 id 会变，缓存自然失效。
   */
  const hardenedSessions = new Set<string>()

  /**
   * 把「黑盒 shell / 原厂写工具」写成 `never_allow`，**每个会话一次**。
   *
   * ## 为什么必须在 agentd 做
   *
   * goose 的权限判定是「`user` 段 → 只读 annotation → `smart_approve` 段 → 默认问」，
   * 而 `auto` 档直接 Allow、根本不看后面任何一道 —— 所以黑盒 shell 在 `auto` 档下
   * **只能靠 permission.yaml 的 `never_allow` 拦**。旧实现把这次写入挂在客户端
   * 「切审批档 / 切模式 / Goal 启停」三个动作上：全新会话、全新安装，在用户碰过
   * 那三处之前，`permission.yaml` 里没有任何一条 `never_allow`... 而系统提示却
   * 已经告诉模型「shell 已被禁用」。把写入放到会话建立这一层，才是「不可遗漏」。
   *
   * 失败**不拦这一轮**：不进缓存，下一轮重试。
   */
  async function ensureHardDeny(client: GooseAcpClient, sessionId: string): Promise<void> {
    if (hardenedSessions.has(sessionId)) return
    try {
      const listed = (await client.request('_goose/unstable/tools/list', { sessionId })) as {
        tools?: Array<{ name?: unknown }>
      }
      const names: string[] = []
      for (const tool of listed.tools ?? []) {
        if (typeof tool.name === 'string' && tool.name.length > 0) names.push(tool.name)
      }
      const denied = listHardDenyToolNames(names)
      if (denied.length > 0) {
        await client.request('_goose/unstable/tools/permissions/set', {
          toolPermissions: denied.map(function (toolName) {
            return { toolName, permission: 'never_allow' }
          })
        })
      }
      hardenedSessions.add(sessionId)
    } catch (error) {
      console.warn(`[agent] 同步硬禁用失败（下一轮重试）：${String(error)}`)
    }
  }

  /** 把本轮的附加系统提示挂到会话上；失败不拦这一轮（软参数）。 */
  async function applySystemText(
    client: GooseAcpClient,
    sessionId: string,
    text: string
  ): Promise<void> {
    if (!text.trim()) return
    try {
      await client.request('_goose/unstable/session/system-prompt/set', {
        sessionId,
        mode: 'append',
        key: 'cogito',
        text: text.trim()
      })
    } catch (error) {
      console.warn(`[agent] 设置 system prompt 失败（本轮继续）：${String(error)}`)
    }
  }

  async function gooseNode(state: typeof OrchestrationState.State): Promise<TurnResult> {
    const client = supervisor.client()
    if (!client) {
      throw new Error('goose 未就绪（/health 的 goose 字段可查状态）')
    }
    bindIncoming(client)

    const fingerprint = fingerprintMcpServers(state.mcpServers)
    // 会话能复用，前提是**工具面配置没变**。桥地址是内核随机端口，app 重启就换一个；
    // 复用旧会话不会重挂 MCP，于是 `cogito-mcp` 仍去连旧端口 —— 表现是本地工具面整体
    // 消失（只有 `cogito_ping`），并且要等用户重启会话才恢复。指纹不同就重开一个会话。
    const serversChanged = Boolean(state.sessionId) && state.mcpFingerprint !== fingerprint

    if (state.sessionId && !serversChanged) {
      try {
        await applyMode(client, state.sessionId, state.mode)
        await ensureHardDeny(client, state.sessionId)
        // 复用会话也要重挂：同一 thread 的不同轮次可能带不同场景的系统提示
        await applySystemText(client, state.sessionId, state.systemText)
        return {
          reply: await runTurn(client, state.sessionId, state.prompt, state.threadID),
          sessionId: state.sessionId,
          mcpFingerprint: state.mcpFingerprint
        }
      } catch (error) {
        // goose 重启会让旧 session 消失：重开一次比把错误抛给用户更有用
        if (!isStaleSession(error)) throw error
      }
    }

    const session = await client.newSession({ cwd: state.cwd, mcpServers: state.mcpServers })
    sessionThreads.set(session.sessionId, state.threadID)
    await applyMode(client, session.sessionId, state.mode)
    await ensureHardDeny(client, session.sessionId)
    await applySystemText(client, session.sessionId, state.systemText)
    const reply = await runTurn(client, session.sessionId, state.prompt, state.threadID)
    return { reply, sessionId: session.sessionId, mcpFingerprint: fingerprint }
  }

  const builder = new StateGraph(OrchestrationState)
    .addNode('goose', gooseNode)
    .addEdge(START, 'goose')
    .addEdge('goose', END)

  // 没有 saver 时 `/threads/:id/state` 与 resume 都不可用，所以生产路径必须传
  return checkpointer ? builder.compile({ checkpointer }) : builder.compile()
}

export { OrchestrationState, collectText, createGooseGraph, isStaleSession }
export type { GooseGraphOptions }
