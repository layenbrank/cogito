/**
 * 硬禁用同步：**每个 goose 会话都必须写一次 `never_allow`**。
 *
 * 这条是安全前提，不是优化：goose 的 `auto` 档直接 Allow、根本不看审批，黑盒 shell
 * 在那一档下只有 `permission.yaml` 的 `user.never_allow` 能拦住。旧实现把写入挂在
 * 客户端「切审批档 / 切模式 / Goal 启停」上，全新会话在用户碰过那三处之前一条
 * `never_allow` 都没有 —— 这里锁住「会话建立即同步」「同会话不重复写」「goose 重启
 * 换会话后重新同步」三件事。
 */

import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { describe, expect, it } from 'vitest'

import { createGooseGraph } from './graph'
import type { GooseAcpClient } from './goose/client'
import type { GooseSupervisor } from './goose/supervisor'

/** goose 会话里实际挂着的工具（含该禁的和不该禁的） */
const SESSION_TOOLS = [
  { name: 'shell' },
  { name: 'write' },
  { name: 'edit' },
  { name: 'local__cogito_workspace_write' },
  { name: 'todo__todo_write' },
  { name: 'cogito_workspace_read' }
]

interface Call {
  method: string
  params: Record<string, unknown>
}

function buildFakeGoose(options?: { staleSecondSession?: boolean }): {
  supervisor: GooseSupervisor
  calls: Call[]
} {
  const calls: Call[] = []
  let sessionSeq = 0
  const stale = new Set<string>()

  const client = {
    pid: 1,
    initialize: function () {
      return Promise.resolve({ protocolVersion: 1, agentCapabilities: {} })
    },
    newSession: function () {
      sessionSeq += 1
      return Promise.resolve({ sessionId: `session-${sessionSeq}` })
    },
    prompt: function (sessionId: string) {
      if (stale.has(sessionId)) return Promise.reject(new Error('session not found: -32002'))
      if (options?.staleSecondSession && sessionId === 'session-2') {
        stale.add(sessionId)
        return Promise.reject(new Error('session not found: -32002'))
      }
      return Promise.resolve({ stopReason: 'end_turn' })
    },
    cancel: function () {
      return Promise.resolve()
    },
    request: function (method: string, params: Record<string, unknown>) {
      calls.push({ method, params })
      if (method === '_goose/unstable/tools/list') {
        return Promise.resolve({ tools: SESSION_TOOLS })
      }
      return Promise.resolve({})
    },
    onSessionUpdate: function () {
      return function () {}
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

  return { supervisor, calls }
}

function permissionSets(calls: Call[]) {
  return calls
    .filter(function (call) {
      return call.method === '_goose/unstable/tools/permissions/set'
    })
    .map(function (call) {
      return (call.params.toolPermissions as Array<{ toolName: string; permission: string }>).map(
        function (entry) {
          return `${entry.toolName}=${entry.permission}`
        }
      )
    })
}

describe('会话建立时的硬禁用同步', function () {
  it('新会话写一次 never_allow，只包含黑盒 shell 与原厂写工具', async function () {
    const fake = buildFakeGoose()
    const graph = createGooseGraph({ supervisor: fake.supervisor, checkpointer: new MemorySaver() })

    await graph.invoke({ prompt: 'hi', cwd: '/w', mode: 'auto' }, { configurable: { thread_id: 't1' } })

    expect(permissionSets(fake.calls)).toEqual([
      ['shell=never_allow', 'write=never_allow', 'edit=never_allow']
    ])
  })

  it('同一会话第二轮不重复写（goose 侧已是幂等，但没必要每次都问一遍工具面）', async function () {
    const fake = buildFakeGoose()
    const graph = createGooseGraph({ supervisor: fake.supervisor, checkpointer: new MemorySaver() })
    const config = { configurable: { thread_id: 't2' } }

    await graph.invoke({ prompt: 'first', cwd: '/w', mode: 'auto' }, config)
    await graph.invoke({ prompt: 'second', cwd: '/w', mode: 'auto' }, config)

    expect(permissionSets(fake.calls)).toHaveLength(1)
  })

  it('旧会话失效后重开的新会话会重新同步', async function () {
    const fake = buildFakeGoose()
    const graph = createGooseGraph({ supervisor: fake.supervisor, checkpointer: new MemorySaver() })
    const config = { configurable: { thread_id: 't3' } }

    await graph.invoke({ prompt: 'first', cwd: '/w', mode: 'auto' }, config)

    // 第一轮之后让 session-1 失效，第二轮会 session/new 出 session-2
    const client = fake.supervisor.client() as unknown as {
      prompt: (sessionId: string) => Promise<unknown>
    }
    const original = client.prompt
    client.prompt = function (sessionId: string) {
      if (sessionId === 'session-1') return Promise.reject(new Error('session not found: -32002'))
      return original(sessionId)
    }

    await graph.invoke({ prompt: 'second', cwd: '/w', mode: 'auto' }, config)

    // 两个会话各写一次：session-1 与重开后的 session-2
    expect(permissionSets(fake.calls)).toHaveLength(2)
  })
})
