/**
 * Chat 域集成校验：真实 better-sqlite3（Electron ABI）+ 真实迁移文件。
 *
 * 与 database.integration.test.ts 同一路径（普通 Node 跑不了 better-sqlite3）：
 *
 *   pnpm --filter @i-thinking/studio test:db
 *
 * 覆盖迁移落地后的 schema 语义：
 *   1. chat 三表齐备（旧 ai 域已不存在）
 *   2. 会话 → 消息级联；消息的分支自引用（parentID）级联
 *   3. provider 被删时会话保留、默认 provider 置空（on delete set null）
 *   4. 仓储写入自愈：会话行缺失、父消息属于别的会话时消息照样落库（见 `chat.ts`）
 */
import type { Database as SqliteHandle } from 'better-sqlite3'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { workspace, workspaceFolder } from '@schema'
import type { Plugin } from '@/host/framework/module'
import type { Repository } from './chat'
import type { findClient } from './database'

// 本文件在 src/host/capabilities/ 下，要上溯三层才到包根（apps/studio）
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const MIGRATIONS_FOLDER = join(PACKAGE_ROOT, 'drizzle', 'migrations')

const handles: SqliteHandle[] = []
const tempDirs: string[] = []

function openDb(): SqliteHandle {
  const dir = mkdtempSync(join(tmpdir(), 'studio-chat-db-'))
  tempDirs.push(dir)
  const db = new Database(join(dir, 'cogito-client.db'))
  // 与 src/plugins/database.ts 的连接 pragma 保持一致（外键必须显式打开）
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')

  migrate(drizzle({ client: db }), { migrationsFolder: MIGRATIONS_FOLDER })

  handles.push(db)
  return db
}

function tableNames(db: SqliteHandle): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map(function (row) {
      return (row as { name: string }).name
    })
    .filter(function (name) {
      return !name.startsWith('sqlite_') && !name.startsWith('__drizzle')
    })
}

function count(db: SqliteHandle, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }
  return row.count
}

function insertProvider(db: SqliteHandle, id: string) {
  const now = Date.now()
  db.prepare(
    'INSERT INTO "chatProvider" ("id","kind","name","baseUrl","models","model","enabled","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(id, 'openai', '本地 Ollama', null, '["qwen3:8b"]', 'qwen3:8b', 1, now, now)
}

function insertSession(db: SqliteHandle, id: string, providerID: string | null) {
  const now = Date.now()
  db.prepare(
    'INSERT INTO "chatSession" ("id","title","pinned","providerID","createdAt","updatedAt") VALUES (?,?,?,?,?,?)'
  ).run(id, '会话', 0, providerID, now, now)
}

function insertMessage(db: SqliteHandle, id: string, sessionID: string, parentID: string | null) {
  const now = Date.now()
  db.prepare(
    'INSERT INTO "chatMessage" ("id","sessionID","parentID","format","content","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)'
  ).run(id, sessionID, parentID, 'ai-sdk/v6', '{}', now, now)
}

function insertUsage(
  db: SqliteHandle,
  id: string,
  runID: string,
  sessionID: string | null,
  totalTokens: number,
  createdAt = Date.now()
) {
  db.prepare(
    'INSERT INTO "chatUsage" ("id","runID","sessionID","providerID","model","source","outcome","inputTokens","outputTokens","totalTokens","createdAt") VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).run(
    id,
    runID,
    sessionID,
    'provider-1',
    'deepseek-flash',
    'local',
    'finish',
    totalTokens - 1,
    1,
    totalTokens,
    createdAt
  )
}

afterEach(function () {
  // Windows 下句柄未释放会 EPERM，必须先关再删
  handles.splice(0).forEach(function (db) {
    db.close()
  })
  tempDirs.splice(0).forEach(function (dir) {
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('chat 域（真实引擎 better-sqlite3）', function () {
  it('迁移后 chat 三表齐备，旧 ai 域已移除', function () {
    const db = openDb()
    const tables = tableNames(db)

    expect(tables).toContain('chatProvider')
    expect(tables).toContain('chatSession')
    expect(tables).toContain('chatMessage')
    expect(tables).toContain('chatUsage')
    expect(
      tables.filter(function (name) {
        return name.startsWith('ai')
      })
    ).toEqual([])
  })

  it('会话级联删消息；分支自引用级联删后继', function () {
    const db = openDb()
    insertSession(db, 'session-1', null)
    insertMessage(db, 'message-1', 'session-1', null)
    insertMessage(db, 'message-2', 'session-1', 'message-1')
    insertMessage(db, 'message-3', 'session-1', 'message-2')
    expect(count(db, 'chatMessage')).toBe(3)

    // 删中间节点 → 后继分支一并删除，兄弟分支不受影响
    insertMessage(db, 'message-branch', 'session-1', 'message-1')
    db.prepare('DELETE FROM "chatMessage" WHERE "id" = ?').run('message-2')
    expect(count(db, 'chatMessage')).toBe(2)
    expect(
      db.prepare('SELECT "parentID" FROM "chatMessage" WHERE "id" = ?').get('message-branch')
    ).toEqual({ parentID: 'message-1' })

    // 删会话 → 余下消息级联清空
    db.prepare('DELETE FROM "chatSession" WHERE "id" = ?').run('session-1')
    expect(count(db, 'chatMessage')).toBe(0)
  })

  it('runtime 生成的 7 位 nanoid 消息 id 同样可落库并级联', function () {
    const db = openDb()
    // 会话 id 是主进程的 uuid；消息 id 来自 assistant-ui 的 generateId()（7 位 nanoid）
    insertSession(db, '2f8b0f2e-6d3c-4a51-9c2b-1c0f5a7d9e10', null)
    insertMessage(db, 'a1B2c3D', '2f8b0f2e-6d3c-4a51-9c2b-1c0f5a7d9e10', null)
    insertMessage(db, 'Zz9x8Y7', '2f8b0f2e-6d3c-4a51-9c2b-1c0f5a7d9e10', 'a1B2c3D')
    expect(count(db, 'chatMessage')).toBe(2)

    // 外键真实生效：助手消息的父指针必须已经落库（append 顺序由 runtime 保证）
    expect(function () {
      insertMessage(db, 'later', '2f8b0f2e-6d3c-4a51-9c2b-1c0f5a7d9e10', 'missing')
    }).toThrow(/FOREIGN KEY/)

    db.prepare('DELETE FROM "chatMessage" WHERE "id" = ?').run('a1B2c3D')
    expect(count(db, 'chatMessage')).toBe(0)
  })

  it('provider 被删：会话保留、默认 provider 置空', function () {
    const db = openDb()
    insertProvider(db, 'provider-1')
    insertSession(db, 'session-1', 'provider-1')

    db.prepare('DELETE FROM "chatProvider" WHERE "id" = ?').run('provider-1')

    expect(count(db, 'chatSession')).toBe(1)
    expect(
      db.prepare('SELECT "providerID" FROM "chatSession" WHERE "id" = ?').get('session-1')
    ).toEqual({ providerID: null })
  })

  it('用量账本：重复结算被 runID 唯一约束挡住', function () {
    const db = openDb()
    insertUsage(db, 'usage-1', 'run-1', null, 30)

    // 引擎先记账再发终态，终态可能被重放（重连 / 重试），第二次一律丢弃而不是重复计数
    expect(function () {
      insertUsage(db, 'usage-2', 'run-1', null, 30)
    }).toThrow(/UNIQUE/)

    expect(count(db, 'chatUsage')).toBe(1)
  })

  it('用量账本：会话没落库也记得下，会话被删也留得住', function () {
    const db = openDb()

    // 会话 id 来自渲染进程，历史适配器要等 `ensure()` 才落库；账本刻意不加外键，先记账不会失败
    insertUsage(db, 'usage-1', 'run-1', 'session-unknown', 30)

    insertSession(db, 'session-1', null)
    insertUsage(db, 'usage-2', 'run-2', 'session-1', 70)

    db.prepare('DELETE FROM "chatSession" WHERE "id" = ?').run('session-1')

    // 历史用量不随会话消失
    expect(count(db, 'chatUsage')).toBe(2)
    const row = db.prepare('SELECT SUM("totalTokens") AS total FROM "chatUsage"').get() as {
      total: number
    }
    expect(row.total).toBe(100)
  })
})

/**
 * 写入自愈：这一组跑**真实仓储**（不是裸 SQL）。
 *
 * 丢消息的现场正好落在仓储层那两个外键前提上 —— 会话行还没落库、父消息属于别的会话
 * （切会话的一瞬间渲染进程还带着上一条会话的父 id）；只测 SQL 测不到这段逻辑。
 *
 * `capabilities/database.ts` 的库路径由 `LOCALAPPDATA` 推导、迁移目录由 `APP_ROOT` 推导
 * （见 `framework/paths.ts`），两个都指到临时目录才不会碰用户正在用的那个库。
 */
describe('chat 仓储写入自愈（真实 Repository + 临时库）', function () {
  const savedEnv = { LOCALAPPDATA: process.env.LOCALAPPDATA, APP_ROOT: process.env.APP_ROOT }
  const repoDirs: string[] = []
  let repo: Repository | null = null
  let db: ReturnType<typeof findClient> | null = null
  let plugin: Plugin | null = null

  beforeAll(async function () {
    const dir = mkdtempSync(join(tmpdir(), 'studio-chat-repo-'))
    repoDirs.push(dir)
    process.env.LOCALAPPDATA = dir
    process.env.APP_ROOT = PACKAGE_ROOT

    const database = await import('./database')
    db = database.findClient()
    repo = new (await import('./chat')).Repository()
    plugin = database.buildPlugin()
  })

  afterAll(async function () {
    await plugin?.dispose?.()
    repo = null
    db = null
    for (const key of Object.keys(savedEnv) as (keyof typeof savedEnv)[]) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
    repoDirs.splice(0).forEach(function (dir) {
      rmSync(dir, { recursive: true, force: true })
    })
  })

  function useRepo(): Repository {
    if (!repo) throw new Error('仓储未初始化')
    return repo
  }

  function useDb(): ReturnType<typeof findClient> {
    if (!db) throw new Error('库未初始化')
    return db
  }

  /** 渲染进程落一条消息的样子：format 由历史适配器给，主进程不解析 content */
  function append(chat: Repository, sessionID: string, parentID: string | null) {
    return chat.appendMessage({
      sessionID,
      parentID,
      format: 'ith/thread-message-like',
      content: JSON.stringify({ role: 'user', content: '你好' })
    })
  }

  it('会话行不在库时按消息带来的 id 补建会话，消息不丢', async function () {
    const chat = useRepo()
    // 渲染进程已经生成会话 id、历史适配器的 `ensure()` 还在路上的窗口期
    const sessionID = randomUUID()

    const message = await append(chat, sessionID, null)

    expect(message.sessionID).toBe(sessionID)
    expect(
      (await chat.findSessions()).map(function (session) {
        return session.id
      })
    ).toContain(sessionID)
    expect(
      (await chat.findMessages({ sessionID })).map(function (row) {
        return row.id
      })
    ).toEqual([message.id])
  })

  it('父消息不在本会话时改挂本会话最新一条，合法父保持原样', async function () {
    const chat = useRepo()
    const sessionID = randomUUID()
    // 另一条会话里的消息（切会话时被带过来的父指针）
    const foreign = await append(chat, randomUUID(), null)

    // 本会话还没有消息：没有可改挂的，落成新的根
    expect((await append(chat, sessionID, 'ZZZZZZZ')).parentID).toBeNull()

    const first = await append(chat, sessionID, null)
    const second = await append(chat, sessionID, foreign.id)
    const third = await append(chat, sessionID, foreign.id)
    expect(second.parentID).toBe(first.id)
    // createdAt 只到毫秒，这几条多半在同一毫秒里 —— 改挂的是「最后写进去的那条」
    expect(third.parentID).toBe(second.id)

    // 合法父原样保留：自愈不能把分支拍平
    expect((await append(chat, sessionID, first.id)).parentID).toBe(first.id)
  })

  it('会话落库：悬空 / 缺失的 workspaceID 解析到权威工作区，有效值原样保留', async function () {
    const chat = useRepo()
    const client = useDb()
    const now = new Date()
    const root = mkdtempSync(join(tmpdir(), 'studio-chat-ws-'))
    repoDirs.push(root)

    // 一个工作区都没有（首次启动）：会话照落，指针为空
    expect((await chat.writeSession({ title: '无工作区' })).workspaceID).toBeNull()

    // 根的路径不校验存在性 —— 那件事由 engine 侧的 `resolveWorkspaceTarget` 做
    await client.insert(workspace).values([
      { id: 'ws-main', title: '主工作区', sort: 0, createdAt: now, updatedAt: now },
      { id: 'ws-second', title: '副工作区', sort: 1, createdAt: now, updatedAt: now },
      { id: 'ws-gone', title: '已归档', sort: -1, archivedAt: now, createdAt: now, updatedAt: now }
    ])
    await client.insert(workspaceFolder).values([
      {
        id: 'folder-main',
        workspaceID: 'ws-main',
        path: join(root, 'main'),
        isPrimary: true,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'folder-second',
        workspaceID: 'ws-second',
        path: join(root, 'second'),
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'folder-gone',
        workspaceID: 'ws-gone',
        path: join(root, 'gone'),
        createdAt: now,
        updatedAt: now
      }
    ])

    // store 还没水合完（null）
    expect((await chat.writeSession({ title: '水合前' })).workspaceID).toBe('ws-main')
    // 工作区被删后指针悬空
    const dangling = await chat.writeSession({ title: '悬空指针', workspaceID: randomUUID() })
    expect(dangling.workspaceID).toBe('ws-main')
    // 已归档的工作区当不了落点：会话列表里根本看不到它
    expect(
      (await chat.writeSession({ title: '归档指针', workspaceID: 'ws-gone' })).workspaceID
    ).toBe('ws-main')
    // 有效指针原样保留（不能一律改写）
    expect(
      (await chat.writeSession({ title: '显式指定', workspaceID: 'ws-second' })).workspaceID
    ).toBe('ws-second')
    // 只改标题时不碰工作区指针
    expect((await chat.updateSession({ id: dangling.id, title: '改标题' })).workspaceID).toBe(
      'ws-main'
    )
    expect(
      (await chat.updateSession({ id: dangling.id, workspaceID: randomUUID() })).workspaceID
    ).toBe('ws-main')
  })
})
