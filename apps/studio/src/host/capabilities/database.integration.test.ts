/**
 * 数据库集成校验：真实 better-sqlite3（Electron ABI）+ Drizzle 官方 migrator。
 *
 * 这边走真实引擎与真实迁移文件，覆盖启动路径上的三件事：
 *   1. 空库：建表 + 种子数据一次到位
 *   2. 幂等：重复 migrate() 不重复执行、不二次播种
 *   3. 可重跑：记账丢失（库是别的版本建的）时重跑，DDL 撞不到已存在的表
 *
 * 开发阶段只有 0000_init / 0001_chat_usage 两条迁移：整库 DDL 全是 IF NOT EXISTS、种子全是 INSERT OR IGNORE。
 * 所以「表已存在」是正常状态而不是错误 —— 迁移无论重跑几次都安全。
 * 但幂等不等于会迁移旧 schema：结构真改了请直接删掉本地 dev 库重建，别指望重跑能改表。
 *
 * better-sqlite3 是按 Electron ABI 编译的原生模块，普通 Node 加载会 ABI 不匹配，
 * 因此本文件被 vitest.config.ts 排除在 test:unit 之外，改用 Electron 运行时执行：
 *
 *   pnpm --filter @cogito/studio test:db
 */
import type { Database as SqliteHandle } from 'better-sqlite3'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

// 本文件在 src/host/capabilities/ 下，要上溯三层才到包根（apps/studio）
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const MIGRATIONS_FOLDER = join(PACKAGE_ROOT, 'drizzle', 'migrations')

/** 业务表数量（不含 Drizzle 记账表）：v1 的 8 张 + chat 域 4 张 + workspace/workspaceFolder 2 张 = 14 */
const BUSINESS_TABLE_COUNT = 14
/** 迁移文件数：0000_init（建表 + 种子）+ 0001_chat_usage（用量账本） */
const MIGRATION_COUNT = 2
/** 种子行数（139 条 INSERT OR IGNORE；client 已废弃，不再同步） */
const SEED_ROWS = { magneticTile: 137, mirror: 1, countdown: 1 }

const handles: SqliteHandle[] = []
const tempDirs: string[] = []

function openDb(): SqliteHandle {
  const dir = mkdtempSync(join(tmpdir(), 'studio-db-'))
  tempDirs.push(dir)
  const db = new Database(join(dir, 'cogito-client.db'))
  // 与 src/plugins/database.ts 的连接 pragma 保持一致
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  handles.push(db)
  return db
}

/** 与 database.ts 的启动顺序一致：直接跑官方 migrator（studio 自己建表） */
function bootstrap(db: SqliteHandle): void {
  migrate(drizzle({ client: db }), { migrationsFolder: MIGRATIONS_FOLDER })
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

function rows(db: SqliteHandle, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }
  return row.count
}

function seedRowCounts(db: SqliteHandle) {
  return {
    magneticTile: rows(db, 'magneticTile'),
    mirror: rows(db, 'mirror'),
    countdown: rows(db, 'countdown')
  }
}

function agentSeedCount(db: SqliteHandle): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM "magneticTile" WHERE "component" = ?')
    .get('agent') as { count: number }
  return row.count
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

describe('Drizzle 迁移（真实引擎 better-sqlite3）', function () {
  it('空库：建表 + 种子数据一次到位', function () {
    const db = openDb()

    bootstrap(db)

    expect(tableNames(db)).toHaveLength(BUSINESS_TABLE_COUNT)
    expect(rows(db, '__drizzle_migrations')).toBe(MIGRATION_COUNT)
    expect(seedRowCounts(db)).toEqual(SEED_ROWS)
  })

  it('种子里的 AI Hub 直接写 agent（无遗留旧组件名）', function () {
    const db = openDb()

    bootstrap(db)

    expect(agentSeedCount(db)).toBe(1)
  })

  it('重复启动：迁移与播种都幂等', function () {
    const db = openDb()
    bootstrap(db)
    const before = seedRowCounts(db)

    bootstrap(db)

    expect(tableNames(db)).toHaveLength(BUSINESS_TABLE_COUNT)
    expect(rows(db, '__drizzle_migrations')).toBe(MIGRATION_COUNT)
    expect(seedRowCounts(db)).toEqual(before)
  })

  it('可重跑：记账丢失后重跑，DDL 撞不到已存在的表', function () {
    const db = openDb()
    bootstrap(db)
    const before = seedRowCounts(db)
    // 模拟「库是别的版本建的」：表都在，但记账里没有这次迁移的记录
    db.prepare('DELETE FROM __drizzle_migrations').run()

    bootstrap(db)

    expect(tableNames(db)).toHaveLength(BUSINESS_TABLE_COUNT)
    expect(rows(db, '__drizzle_migrations')).toBe(MIGRATION_COUNT)
    expect(seedRowCounts(db)).toEqual(before)
  })
})
