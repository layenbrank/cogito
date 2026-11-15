/**
 * sqlite checkpointer：中断/恢复 + **跨连接持久化**（重开库还能读到 checkpoint）。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Annotation, END, START, StateGraph, interrupt } from '@langchain/langgraph'
import { Client } from '@langchain/langgraph-sdk'
import { afterEach, describe, expect, it } from 'vitest'

import { createAgentServer } from './agent-server'
import { createSqliteSaver } from './checkpointer'
import { openDb } from './db'
import { SERVICE_NAME, createApp } from './server'
import type { AgentdStatus } from './server'

const TOKEN = 'test-token-0123456789'
const running: Server[] = []
const tempDirs: string[] = []

const GateState = Annotation.Root({
  question: Annotation<string>({
    reducer: function (_prev, next) {
      return next
    },
    default: function () {
      return ''
    }
  }),
  answer: Annotation<string>({
    reducer: function (_prev, next) {
      return next
    },
    default: function () {
      return ''
    }
  })
})

function buildGateGraph(checkpointer: ReturnType<typeof createSqliteSaver>) {
  async function gateNode(state: typeof GateState.State) {
    const reply = await interrupt({ question: state.question })
    return { answer: String(reply) }
  }
  return new StateGraph(GateState)
    .addNode('gate', gateNode)
    .addEdge(START, 'gate')
    .addEdge('gate', END)
    .compile({ checkpointer })
}

function buildStatus(): AgentdStatus {
  return {
    service: SERVICE_NAME,
    version: 'test',
    uptimeMs: 1,
    pid: process.pid,
    graphs: ['agent'],
    goose: 'disabled',
    restarts: 0
  }
}

function startServer(graph: unknown): Promise<{ base: string }> {
  const agentServer = createAgentServer({ graph: graph as never })
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

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentd-ckpt-'))
  tempDirs.push(dir)
  return join(dir, 'agentd.db')
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
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) continue
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows 上 sqlite 的 -wal 可能还没释放；测试目录由 OS 临时目录兜底
    }
  }
})

describe('SqliteSaver + interrupt/resume', function () {
  it('run 停在 interrupt，resume 后跑完，且状态写进了 sqlite', async function () {
    const dbPath = tempDbPath()
    const db = openDb(dbPath)
    const saver = createSqliteSaver(db)
    const { base } = await startServer(buildGateGraph(saver))
    const client = new Client({
      apiUrl: base,
      defaultHeaders: { authorization: `Bearer ${TOKEN}` }
    })

    const thread = await client.threads.create()
    const first: { event: string; data: unknown }[] = []
    for await (const chunk of client.runs.stream(thread.thread_id, 'agent', {
      input: { question: 'approve?' },
      streamMode: ['values', 'updates']
    })) {
      first.push({ event: chunk.event, data: chunk.data })
    }
    expect(JSON.stringify(first)).toContain('__interrupt__')
    expect(first.at(-1)?.event).toBe('end')

    const second: { event: string; data: unknown }[] = []
    for await (const chunk of client.runs.stream(thread.thread_id, 'agent', {
      command: { resume: 'yes' },
      streamMode: ['values']
    })) {
      second.push({ event: chunk.event, data: chunk.data })
    }
    expect(JSON.stringify(second)).toContain('"answer":"yes"')

    // 跨「连接」持久化：换一个 db 句柄 + saver 读同一文件
    db.close()
    const db2 = openDb(dbPath)
    const saver2 = createSqliteSaver(db2)
    const tuple = await saver2.getTuple({ configurable: { thread_id: thread.thread_id } })
    const values = (tuple?.checkpoint.channel_values ?? {}) as Record<string, unknown>
    expect(values.answer).toBe('yes')
    db2.close()
  })

  /**
   * LangGraph 的 saver 只 INSERT 不 DELETE：不裁的话 `lg_checkpoints` 会随使用线性膨胀，
   * 而历史除了 `list()` 没人读。这里直接压 300 条，断言旧行与它们的 writes 都被清掉、
   * 最新的仍可读。
   */
  it('超出保留上限的旧 checkpoint 会被裁掉（连带 writes）', async function () {
    const db = openDb(tempDbPath())
    const saver = createSqliteSaver(db)
    const threadID = 'prune-thread'
    const config = { configurable: { thread_id: threadID, checkpoint_ns: '' } }

    // 每条都带一条 write，验证孤儿清理
    for (let index = 0; index < 300; index += 1) {
      const checkpointId = `cp-${String(index).padStart(4, '0')}`
      await saver.put(
        config,
        {
          v: 1,
          id: checkpointId,
          ts: new Date().toISOString(),
          channel_values: { n: index },
          channel_versions: {},
          versions_seen: {}
        },
        { source: 'loop', step: index, parents: {} },
        {}
      )
      await saver.putWrites(
        { configurable: { thread_id: threadID, checkpoint_ns: '', checkpoint_id: checkpointId } },
        [['answer', index]],
        `task-${index}`
      )
    }

    const count = db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM lg_checkpoints WHERE thread_id = ?',
      threadID
    )
    // 200 保留 + 32 冗余窗口：裁到不高于这个水位
    expect(count?.n ?? 0).toBeLessThanOrEqual(232)
    // 裁过之后不该一条没留
    expect(count?.n ?? 0).toBeGreaterThan(0)

    // 最新那条必须仍在（`getTuple` 精确查，不依赖链）
    const latest = await saver.getTuple({
      configurable: { thread_id: threadID, checkpoint_ns: '', checkpoint_id: 'cp-0299' }
    })
    expect(latest?.checkpoint.channel_values).toEqual({ n: 299 })

    // 孤儿 writes 必须跟着走：留下的 writes 数量不能超过留下的 checkpoint 数量
    const writes = db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM lg_writes WHERE thread_id = ?',
      threadID
    )
    expect(writes?.n ?? 0).toBeLessThanOrEqual(count?.n ?? 0)
    db.close()
  })
})
