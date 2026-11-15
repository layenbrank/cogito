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

import type { GooseAcpClient } from './goose/client'
import type { GooseSupervisor } from './goose/supervisor'
import type { ApprovalHub } from './approvals'
import type { ElicitationHub } from './elicitations'
import type { EventHub } from './events'

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

/** 依赖多了就不该再堆位置参数（`createGooseGraph(a, b, c, d)` 可读性为零）。 */
interface GooseGraphOptions {
  supervisor: GooseSupervisor
  checkpointer?: BaseCheckpointSaver
  approvals?: ApprovalHub
  /** 结构化追问（`elicitation/create`）：与审批同构，但回执形状不同 */
  elicitations?: ElicitationHub
  /** 把 goose 的 `session/update` 原样送去 `/threads/:id/events` */
  events?: EventHub
}

function createGooseGraph(options: GooseGraphOptions) {
  const { supervisor, checkpointer, approvals, elicitations, events } = options
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
    const unsubscribe = client.onSessionUpdate(function (updatedSessionId, update) {
      if (updatedSessionId !== sessionId) return
      if (typeof update !== 'object' || update === null) return
      // 事件流是**原始形状**：前端的 ACP 解析器按 session/update 的字段读，不再抄一遍
      events?.emit(threadID, 'update', update)
      const record = update as Record<string, unknown>
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

    if (state.sessionId) {
      try {
        await applyMode(client, state.sessionId, state.mode)
        // 复用会话也要重挂：同一 thread 的不同轮次可能带不同场景的系统提示
        await applySystemText(client, state.sessionId, state.systemText)
        return {
          reply: await runTurn(client, state.sessionId, state.prompt, state.threadID),
          sessionId: state.sessionId
        }
      } catch (error) {
        // goose 重启会让旧 session 消失：重开一次比把错误抛给用户更有用
        if (!isStaleSession(error)) throw error
      }
    }

    const session = await client.newSession({ cwd: state.cwd, mcpServers: state.mcpServers })
    sessionThreads.set(session.sessionId, state.threadID)
    await applyMode(client, session.sessionId, state.mode)
    await applySystemText(client, session.sessionId, state.systemText)
    const reply = await runTurn(client, session.sessionId, state.prompt, state.threadID)
    return { reply, sessionId: session.sessionId }
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
