/**
 * 最小编排图：`START → goose → END`。
 *
 * 刻意**不含任何模型调用**：推理与工具都在 goose 里发生（唯一出网点仍是 gateway）。
 * 后续 P6 会在此扩成 `plan → worker → review → humanGate`，但每个节点仍然只是
 * 「开一个 goose 会话跑一轮」，不会自己连 LLM。
 */

import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import type { BaseCheckpointSaver } from '@langchain/langgraph'

import type { GooseSupervisor } from './goose/supervisor'

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
  })
})

interface TextChunk {
  type?: string
  text?: string
}

function collectText(chunks: TextChunk[]): string {
  return chunks
    .map(function (chunk) {
      return chunk.type === 'text' && typeof chunk.text === 'string' ? chunk.text : ''
    })
    .join('')
}

function createGooseGraph(supervisor: GooseSupervisor, checkpointer?: BaseCheckpointSaver) {
  async function gooseNode(state: typeof OrchestrationState.State): Promise<{ reply: string }> {
    const client = supervisor.client()
    if (!client) {
      throw new Error('goose 未就绪（/health 的 goose 字段可查状态）')
    }

    const session = await client.newSession({ cwd: state.cwd })
    const chunks: TextChunk[] = []
    const unsubscribe = client.onSessionUpdate(function (sessionId, update) {
      if (sessionId !== session.sessionId) return
      if (typeof update !== 'object' || update === null) return
      const record = update as Record<string, unknown>
      if (record.sessionUpdate !== 'agent_message_chunk') return
      const content = record.content
      if (typeof content === 'object' && content !== null) {
        chunks.push(content as TextChunk)
      }
    })

    try {
      await client.prompt(session.sessionId, state.prompt)
    } finally {
      unsubscribe()
    }

    return { reply: collectText(chunks) }
  }

  const builder = new StateGraph(OrchestrationState)
    .addNode('goose', gooseNode)
    .addEdge(START, 'goose')
    .addEdge('goose', END)

  // 没有 saver 时 `/threads/:id/state` 与 resume 都不可用，所以生产路径必须传
  return checkpointer ? builder.compile({ checkpointer }) : builder.compile()
}

export { OrchestrationState, collectText, createGooseGraph }
