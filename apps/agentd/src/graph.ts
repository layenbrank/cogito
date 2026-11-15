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

function createGooseGraph(
  supervisor: GooseSupervisor,
  checkpointer?: BaseCheckpointSaver,
  approvals?: ApprovalHub
) {
  /** sessionId → threadID：审批请求只带 sessionId，得靠这张表回到线程。 */
  const sessionThreads = new Map<string, string>()

  /**
   * 每次拿到 client 都重新注册（goose 重启后 client 是新的）。
   * 同一个函数重复注册无副作用：它只读 `sessionThreads`。
   */
  function bindApprovals(client: GooseAcpClient): void {
    if (!approvals) return
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

  /** 在一个已知 session 上跑一轮；只收集本会话的 `agent_message_chunk`。 */
  async function runTurn(client: GooseAcpClient, sessionId: string, prompt: string): Promise<string> {
    const chunks: TextChunk[] = []
    const unsubscribe = client.onSessionUpdate(function (updatedSessionId, update) {
      if (updatedSessionId !== sessionId) return
      if (typeof update !== 'object' || update === null) return
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

  async function gooseNode(state: typeof OrchestrationState.State): Promise<TurnResult> {
    const client = supervisor.client()
    if (!client) {
      throw new Error('goose 未就绪（/health 的 goose 字段可查状态）')
    }
    bindApprovals(client)

    if (state.sessionId) {
      try {
        return {
          reply: await runTurn(client, state.sessionId, state.prompt),
          sessionId: state.sessionId
        }
      } catch (error) {
        // goose 重启会让旧 session 消失：重开一次比把错误抛给用户更有用
        if (!isStaleSession(error)) throw error
      }
    }

    const session = await client.newSession({ cwd: state.cwd })
    sessionThreads.set(session.sessionId, state.threadID)
    const reply = await runTurn(client, session.sessionId, state.prompt)
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
