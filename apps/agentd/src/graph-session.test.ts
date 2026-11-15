/**
 * 会话复用：第二轮必须打在上一次的 session 上。
 *
 * 这里用假 supervisor（不发真 ACP）验证三件事：
 * 1. 首轮 `session/new` 一次，`sessionId` 写回 state（因此进 checkpoint）；
 * 2. 第二轮**不再** `session/new`，prompt 打到同一个 session；
 * 3. goose 重启导致旧 session 失效时，自动重开一次而不是把错误抛给用户。
 */

import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { describe, expect, it } from 'vitest'

import { createGooseGraph, isStaleSession } from './graph'
import type { GooseAcpClient } from './goose/client'
import type { GooseSupervisor } from './goose/supervisor'

interface FakeTurn {
  /** 本次 prompt 要吐的正文 */
  reply: string
  /** 非空表示这次 prompt 抛错（模拟会话失效） */
  failWith?: string
}

/**
 * 假 goose：按 script 顺序回应 prompt。
 * `failOnce` 用来模拟「goose 重启后旧 session 不存在」。
 */
function buildFakeGoose(script: FakeTurn[]): {
  supervisor: GooseSupervisor
  newSessions: string[]
  prompts: { sessionId: string; text: string }[]
} {
  const newSessions: string[] = []
  const prompts: { sessionId: string; text: string }[] = []
  const listeners = new Set<(sessionId: string, update: unknown) => void>()
  let sessionSeq = 0
  let turnIndex = 0
  let stale: string | null = null

  const client = {
    pid: 1,
    initialize: function () {
      return Promise.resolve({ protocolVersion: 1, agentCapabilities: {} })
    },
    newSession: function () {
      sessionSeq += 1
      const sessionId = `session-${sessionSeq}`
      newSessions.push(sessionId)
      return Promise.resolve({ sessionId })
    },
    prompt: function (sessionId: string, text: string) {
      prompts.push({ sessionId, text })
      if (stale === sessionId) {
        return Promise.reject(new Error('session not found: -32002'))
      }
      const turn = script[turnIndex] ?? { reply: '' }
      turnIndex += 1
      if (turn.failWith) {
        // 让这个 session 之后一直失效，模拟 goose 重启
        stale = sessionId
        return Promise.reject(new Error(turn.failWith))
      }
      for (const listener of listeners) {
        listener(sessionId, {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: turn.reply }
        })
      }
      return Promise.resolve({ stopReason: 'end_turn' })
    },
    cancel: function () {
      return Promise.resolve()
    },
    request: function () {
      return Promise.resolve({})
    },
    onSessionUpdate: function (listener: (sessionId: string, update: unknown) => void) {
      listeners.add(listener)
      return function () {
        listeners.delete(listener)
      }
    },
    close: function () {}
  } as unknown as GooseAcpClient

  const supervisor = {
    start: function () {
      return Promise.resolve()
    },
    stop: function () {
      return Promise.resolve()
    },
    restart: function () {
      return Promise.resolve()
    },
    client: function () {
      return client
    },
    snapshot: function () {
      return { state: 'ready' as const, restarts: 0 }
    }
  } satisfies GooseSupervisor

  return { supervisor, newSessions, prompts }
}

describe('goose 图的会话复用', function () {
  it('第二轮复用第一轮的 session，不再 session/new', async function () {
    const fake = buildFakeGoose([{ reply: '第一轮' }, { reply: '第二轮' }])
    const graph = createGooseGraph({ supervisor: fake.supervisor, checkpointer: new MemorySaver() })
    const config = { configurable: { thread_id: 'thread-a' } }

    const first = await graph.invoke({ prompt: '你好', cwd: '/w' }, config)
    expect(first.reply).toBe('第一轮')
    expect(first.sessionId).toBe('session-1')

    const second = await graph.invoke({ prompt: '接着说', cwd: '/w' }, config)
    expect(second.reply).toBe('第二轮')
    expect(second.sessionId).toBe('session-1')

    expect(fake.newSessions).toEqual(['session-1'])
    expect(fake.prompts).toEqual([
      { sessionId: 'session-1', text: '你好' },
      { sessionId: 'session-1', text: '接着说' }
    ])
  })

  it('旧 session 失效时重开一次并把新 sessionId 写回', async function () {
    const fake = buildFakeGoose([
      { reply: '第一轮' },
      { reply: '', failWith: 'session not found: -32002' },
      { reply: '重开后' }
    ])
    const graph = createGooseGraph({ supervisor: fake.supervisor, checkpointer: new MemorySaver() })
    const config = { configurable: { thread_id: 'thread-b' } }

    await graph.invoke({ prompt: 'first', cwd: '/w' }, config)
    const second = await graph.invoke({ prompt: 'second', cwd: '/w' }, config)

    expect(second.reply).toBe('重开后')
    expect(second.sessionId).toBe('session-2')
    expect(fake.newSessions).toEqual(['session-1', 'session-2'])
  })

  it('只认「会话类」错误：普通失败仍要抛出', function () {
    expect(isStaleSession(new Error('session not found: -32002'))).toBe(true)
    expect(isStaleSession(new Error('session closed'))).toBe(true)
    expect(isStaleSession(new Error('ACP session/prompt 超时'))).toBe(false)
    expect(isStaleSession(new Error('network down'))).toBe(false)
  })
})
