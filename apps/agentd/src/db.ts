/**
 * agentd 自有库（`agentd.db`）。
 *
 * 里面实际有四大类东西，写清楚免得再被当成「只有元数据」：
 * 1. **编排元数据**：`thread_identity`（线程 ↔ ACP 会话）、`_migrations`；
 * 2. **事件日志**：`run_events`（`(thread_id, epoch, seq)` 主键，正文增量/状态/审批都在 payload 里）；
 * 3. **人工闸门**：`gate_requests`（审批/追问票据与其终态）；
 * 4. **图 checkpoint**：`lg_checkpoints` / `lg_writes` —— LangGraph 的快照**包含每轮 prompt/reply
 *    的完整内容**（含 mcpServers 的 env 路径），保留最近 200 条。所以「这里不写聊天内容」是错的；
 *    对外承诺的应该是「界面用的是客户端 SQLite，agentd 只存续跑所需的最小副本」。
 *
 * 用 `node:sqlite`（Node 24 内置）而不是 better-sqlite3：没有原生模块，SEA 单文件才可行。
 * 但它是**同步 API**：单个语句很快，遇到大 BLOB 或慢盘时会阻塞事件循环 —— 这是已知取舍，
 * 不为了让路去引一个原生模块。
 *
 * 实测注意：BLOB 读回是 `Uint8Array`，checkpoint 序列化时要按这个类型处理。
 */

import { existsSync, renameSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { StatementSync } from 'node:sqlite'

type SqlParam = string | number | bigint | null | Uint8Array

interface AgentdDb {
  exec(sql: string): void
  get<T>(sql: string, ...params: SqlParam[]): T | undefined
  all<T>(sql: string, ...params: SqlParam[]): T[]
  run(sql: string, ...params: SqlParam[]): void
  /** 同 `run`，但返回影响行数（幂等 settle / prune 需要） */
  runChanges(sql: string, ...params: SqlParam[]): number
  close(): void
}

interface Migration {
  version: number
  sql: string
}

/**
 * 建库脚本：**只有一版**（当前形状）。
 *
 * 这里不写「升级迁移」—— 库里的东西要么是缓存（事件日志）、要么能重建（checkpoint/票据），
 * 为它们维护兼容升级只会留下「旧列还在、新列没写」的半吊子状态。改表就直接改这一份。
 *
 * 但「只有一版」有个副作用必须靠代码兜住：旧库的 `_migrations` 里**已经记了 version 1**，
 * 改过的 v1 脚本会被整份跳过，于是运行时才炸出 `no such table: gate_requests` ——
 * agentd 在就绪前退出，客户端只看到「agentd 启动失败」。打包用户没有 `pnpm migrate:fresh`，
 * 所以 `openDb` 会在打开后自检「脚本承诺的表 / 索引是否都在」，缺了就**隔离重建**。
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
      -- 事件日志：补发与游标都靠它；(thread_id, epoch, seq) 是唯一真相
      CREATE TABLE IF NOT EXISTS run_events (
        thread_id  TEXT    NOT NULL,
        epoch      TEXT    NOT NULL,
        seq        INTEGER NOT NULL,
        kind       TEXT    NOT NULL,
        payload    TEXT,
        run_id     TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (thread_id, epoch, seq)
      );
      CREATE INDEX IF NOT EXISTS run_events_by_thread
        ON run_events(thread_id, epoch, seq);
      CREATE INDEX IF NOT EXISTS run_events_by_time
        ON run_events(created_at);
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
      -- 审批 / 追问票据：进程重启后残留的 pending 一律标成 cancelled（goose 已随之退出）
      CREATE TABLE IF NOT EXISTS gate_requests (
        request_id TEXT PRIMARY KEY,
        kind       TEXT NOT NULL,
        thread_id  TEXT NOT NULL,
        session_id TEXT NOT NULL,
        payload    TEXT NOT NULL,
        state      TEXT NOT NULL,
        decision   TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        settled_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS gate_requests_by_thread
        ON gate_requests(thread_id, state);
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
    // DDL + 版本号必须原子：中途崩掉时会留下「表建了一半但版本已记」的库，之后很难救
    db.exec('BEGIN')
    try {
      db.exec(migration.sql)
      record.run(migration.version, new Date().toISOString())
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

function openDb(path: string): AgentdDb {
  const first = openOnce(path)
  if (first.missing.length === 0) return wrapDb(first.db)
  first.db.close()
  if (path === ':memory:') {
    throw new Error(`内存库缺对象：${first.missing.join(', ')}`)
  }
  // 旧脚本建的库：挪开留档（方便排查「到底是什么时候的库」），再按当前脚本重建
  const moved = quarantineDb(path)
  console.warn(
    `[agentd] 库与建库脚本不一致（缺 ${first.missing.join(', ')}），已隔离为 ${moved} 并重建`
  )
  const second = openOnce(path)
  if (second.missing.length > 0) {
    second.db.close()
    throw new Error(`重建后仍缺 ${second.missing.join(', ')}：建库脚本自身有问题`)
  }
  return wrapDb(second.db)
}

/**
 * 建库脚本承诺存在的对象名（表 + 索引）。
 *
 * 从 `MIGRATIONS` 的 SQL 里读，**不手抄第二份清单** —— 以后加表忘了同步，会被自检当场抓出来，
 * 而不是等用户在日志里看到 `no such table`。
 */
function findExpectedObjects(): string[] {
  const names = ['_migrations']
  const patterns = [
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi,
    /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi
  ]
  for (const migration of MIGRATIONS) {
    for (const pattern of patterns) {
      for (const match of migration.sql.matchAll(pattern)) names.push(match[1])
    }
  }
  return names
}

/** 库里实际有哪些表 / 索引（`sqlite_master` 是唯一真相） */
function findPresentObjects(db: DatabaseSync): Set<string> {
  const present = new Set<string>()
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')").all()
  for (const row of rows) {
    present.add(String((row as { name: unknown }).name))
  }
  return present
}

function findMissingObjects(db: DatabaseSync): string[] {
  const present = findPresentObjects(db)
  return findExpectedObjects().filter(function (name) {
    return !present.has(name)
  })
}

/** 打开 + 迁移 + 自检；把 `db` 交回调用方决定是留还是隔离 */
function openOnce(path: string): { db: DatabaseSync; missing: string[] } {
  const db = new DatabaseSync(path)
  // WAL + 忙等：agentd 是唯一写者，但读（诊断 / 管理面）可能并发
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON;')
  applyMigrations(db)
  return { db, missing: findMissingObjects(db) }
}

/**
 * 把旧库挪到同目录的 `<name>.stale-<时间戳>`（连 `-wal` / `-shm` 一起）。
 *
 * 不直接删：出问题时还能捞回来看看是哪个版本的库；也不跨目录，避免跨盘符 rename 失败。
 */
function quarantineDb(path: string): string {
  const target = `${path}.stale-${Date.now()}`
  const suffixes = ['', '-wal', '-shm']
  for (const suffix of suffixes) {
    const from = `${path}${suffix}`
    if (!existsSync(from)) continue
    renameSync(from, `${target}${suffix}`)
  }
  return target
}

function wrapDb(db: DatabaseSync): AgentdDb {
  /**
   * 语句缓存：`prepare` 每次调用都要编译 SQL。仓里所有 SQL 都是字面量（有限集合），
   * 所以缓存不会无限长大；热路径上的事件写入 / 游标读取因此少一道编译开销。
   */
  const statements = new Map<string, StatementSync>()
  function prepare(sql: string): StatementSync {
    const cached = statements.get(sql)
    if (cached) return cached
    const statement = db.prepare(sql)
    statements.set(sql, statement)
    return statement
  }

  return {
    exec: function (sql: string): void {
      db.exec(sql)
    },
    get: function <T>(sql: string, ...params: SqlParam[]): T | undefined {
      const row = prepare(sql).get(...params)
      return row as T | undefined
    },
    all: function <T>(sql: string, ...params: SqlParam[]): T[] {
      const rows = prepare(sql).all(...params)
      return rows as T[]
    },
    run: function (sql: string, ...params: SqlParam[]): void {
      prepare(sql).run(...params)
    },
    runChanges: function (sql: string, ...params: SqlParam[]): number {
      const result = prepare(sql).run(...params)
      return Number(result.changes)
    },
    close: function (): void {
      statements.clear()
      db.close()
    }
  }
}

export { MIGRATIONS, applyMigrations, openDb }
export type { AgentdDb, Migration, SqlParam }
