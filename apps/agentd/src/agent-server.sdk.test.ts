/**
 * 用**官方 SDK** 反向验证自写端点：能跑通才算兼容，不靠"形状看起来像"。
 */

import type { Server } from 'node:http'

import { Annotation, END, MemorySaver, START, StateGraph } from '@langchain/langgraph'
import { Client } from '@langchain/langgraph-sdk'
import { afterEach, describe, expect, it } from 'vitest'

import { createAgentServer } from './agent-server'
import { SERVICE_NAME, createApp } from './server'
import type { AgentdStatus } from './server'

const TOKEN = 'test-token-0123456789'
const running: Server[] = []

const EchoState = Annotation.Root({
  prompt: Annotation<string>({
    reducer: function (_prev, next) {
      return next
    },
    default: function () {
      return ''
    }
  }),
  reply: Annotation<string>({
    reducer: function (_prev, next) {
      return next
    },
    default: function () {
      return ''
    }
  })
})

function buildEchoGraph() {
  return new StateGraph(EchoState)
    .addNode('echo', function (state: typeof EchoState.State) {
      return { reply: `echo:${state.prompt}` }
    })
    .addEdge(START, 'echo')
    .addEdge('echo', END)
    // 有 checkpointer 才能跨请求读回 state（真实运行时换 node:sqlite saver）
    .compile({ checkpointer: new MemorySaver() })
}

function buildStatus(): AgentdStatus {
  return {
    service: SERVICE_NAME,
    version: '1.2.3-test',
    uptimeMs: 1,
    pid: process.pid,
    graphs: ['agent'],
    goose: 'disabled',
    restarts: 0
  }
}

async function start(): Promise<{ base: string }> {
  const agentServer = createAgentServer({ graph: buildEchoGraph() })
  const app = createApp({
    token: TOKEN,
    status: buildStatus,
    onShutdown: function () {},
    mount: function (target) {
      agentServer.mount(target)
    }
  })
  return new Promise(function (resolve, reject) {
    const server = app.listen(0, '127.0.0.1', function () {
      running.push(server)
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ base: `http://127.0.0.1:${port}` })
    })
    server.on('error', reject)
  })
}

afterEach(async function () {
  const pending = running.splice(0)
  await Promise.all(
    pending.map(function (server) {
      return new Promise<void>(function (resolve) {
        server.close(function () {
          resolve()
        })
      })
    })
  )
})

describe('Agent Protocol 与 @langchain/langgraph-sdk 的兼容性', function () {
  it('threads.create → runs.stream → threads.getState 全链路', async function () {
    const { base } = await start()
    const client = new Client({
      apiUrl: base,
      defaultHeaders: { authorization: `Bearer ${TOKEN}` }
    })

    const thread = await client.threads.create()
    expect(typeof thread.thread_id).toBe('string')

    const events: { event: string; data: unknown }[] = []
    const stream = client.runs.stream(thread.thread_id, 'agent', {
      input: { prompt: 'hi' },
      streamMode: ['values', 'updates']
    })
    for await (const chunk of stream) {
      events.push({ event: chunk.event, data: chunk.data })
    }

    const names = events.map(function (item) {
      return item.event
    })
    expect(names).toContain('metadata')
    expect(names).toContain('values')
    expect(names.at(-1)).toBe('end')

    // 第一个 values 是输入态（reply 为空），节点跑完后还有一次 values
    const valuesEvents = events.filter(function (item) {
      return item.event === 'values'
    })
    expect(
      valuesEvents.some(function (item) {
        return JSON.stringify(item.data).includes('echo:hi')
      })
    ).toBe(true)

    const state = await client.threads.getState(thread.thread_id)
    expect(JSON.stringify(state.values)).toContain('echo:hi')
  })

  it('未知 thread 的 run 返回 404（SDK 侧抛错）', async function () {
    const { base } = await start()
    const client = new Client({
      apiUrl: base,
      defaultHeaders: { authorization: `Bearer ${TOKEN}` }
    })
    await expect(
      (async function () {
        const stream = client.runs.stream('not-a-thread', 'agent', { input: { prompt: 'x' } })
        for await (const _chunk of stream) {
          // 消费到底
        }
      })()
    ).rejects.toBeTruthy()
  })
})
