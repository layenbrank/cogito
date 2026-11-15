/**
 * agentd 自有库（`agentd.db`）：**只存编排元数据**。
 *
 * 聊天历史（`agent_message` / `agent_session`）仍由客户端 Rust SQLite 持有，这里不写。
 * 用 `node:sqlite`（Node 24 内置）而不是 better-sqlite3：没有原生模块，SEA 单文件才可行。
 *
 * 实测注意：BLOB 读回是 `Uint8Array`，checkpoint 序列化时要按这个类型处理。
 */

import { DatabaseSync } from 'node:sqlite'

type SqlParam = string | number | bigint | null | Uint8Array

interface AgentdDb {
  exec(sql: string): void
  get<T>(sql: string, ...params: SqlParam[]): T | undefined
  all<T>(sql: string, ...params: SqlParam[]): T[]
  run(sql: string, ...params: SqlParam[]): void
  close(): void
}

interface Migration {
  version: number
  sql: string
}

/**
 * 迁移表自带（不引外部工具）：版本号单调递增，已应用的跳过。
 * 表结构只在「agentd 自己要知道的东西」上建：线程映射与 run 事件游标。
 */
const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS thread_identity (
        thread_id TEXT PRIMARY KEY,
        acp_session_id TEXT NOT NULL,
        graph_thread_id TEXT NOT NULL,
        last_run_id TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS run_events (
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (run_id, seq)
      );
    `
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS lg_checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        type TEXT,
        checkpoint BLOB NOT NULL,
        metadata BLOB NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      );
      CREATE TABLE IF NOT EXISTS lg_writes (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        task_path TEXT NOT NULL DEFAULT '',
        idx INTEGER NOT NULL,
        channel TEXT NOT NULL,
        type TEXT,
        value BLOB NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
      );
    `
  }
]

function applyMigrations(db: DatabaseSync): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);'
  )
  const applied = new Set(
    db
      .prepare('SELECT version FROM _migrations')
      .all()
      .map(function (row) {
        return Number((row as { version: number }).version)
      })
  )
  const record = db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)')
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue
    db.exec(migration.sql)
    record.run(migration.version, new Date().toISOString())
  }
}

function openDb(path: string): AgentdDb {
  const db = new DatabaseSync(path)
  // WAL + 忙等：agentd 是唯一写者，但读（诊断 / 管理面）可能并发
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON;')
  applyMigrations(db)

  return {
    exec: function (sql: string): void {
      db.exec(sql)
    },
    get: function <T>(sql: string, ...params: SqlParam[]): T | undefined {
      const row = db.prepare(sql).get(...params)
      return row as T | undefined
    },
    all: function <T>(sql: string, ...params: SqlParam[]): T[] {
      const rows = db.prepare(sql).all(...params)
      return rows as T[]
    },
    run: function (sql: string, ...params: SqlParam[]): void {
      db.prepare(sql).run(...params)
    },
    close: function (): void {
      db.close()
    }
  }
}

export { MIGRATIONS, applyMigrations, openDb }
export type { AgentdDb, Migration, SqlParam }
