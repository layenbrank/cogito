import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import { auth } from '@schema'
import { type Context } from '@/host/framework/context'
import { type Plugin } from '@/host/framework/module'
import type { CHANNELS } from '@/shared/ipc/channels'
import { IpcError } from '@/shared/ipc/error'
import { type In, type Out } from '@/shared/ipc/specs'
import { findAppRoot } from '@/host/framework/paths'

type ReadR = Out<typeof CHANNELS.USER.READ>[number]
type WriteP = In<typeof CHANNELS.USER.WRITE>
type WriteR = Out<typeof CHANNELS.USER.WRITE>
type UpdateP = In<typeof CHANNELS.USER.UPDATE>
type UpdateR = Out<typeof CHANNELS.USER.UPDATE>
type RemoveP = In<typeof CHANNELS.USER.REMOVE>
type RemoveR = Out<typeof CHANNELS.USER.REMOVE>

type Sqlite = InstanceType<typeof Database>
type Conn = ReturnType<typeof drizzle>

let sqlite: Sqlite | null = null
let client: Conn | null = null
let logger: { info: (message: string) => void } | null = null

/** client（Tauri）的 bundle identifier，取自 apps/client/src-tauri/tauri.conf.json */
const CLIENT_IDENTIFIER = 'com.cogito.client'
/** 库文件名，取自 apps/client/src-tauri/crates/database/src/storage.rs 的 database_path() */
const DATABASE_FILE = 'cogito-client.db'

/**
 * 与 client 共用的本地数据根目录（`LocalAppData/com.cogito.client` 等）。
 * 库文件、textures、screenshots 都挂在这下面，两客户端互切可复用。
 */
function findSharedDataDir(): string {
  const home = homedir()
  const root =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA || join(home, 'AppData', 'Local')
      : process.platform === 'darwin'
        ? join(home, 'Library', 'Application Support')
        : process.env.XDG_DATA_HOME || join(home, '.local', 'share')

  return join(root, CLIENT_IDENTIFIER)
}

/**
 * 库文件路径：与 client（Tauri 版，另一架构的同实现）**保持同一位置与格式**，
 * 这样两版互切时数据可复用；但用户只装其一，建表由各自完成（本文件负责 studio）。
 * client 侧取 Tauri 的 `app_local_data_dir()/cogito-client.db`（见 src-tauri/src/app/bootstrap.rs），
 * 这里按平台复刻该目录 —— 不能用 Electron 的 userData，
 * Windows 下二者根目录不同（LocalAppData vs Roaming）。
 */
function findSharedDatabasePath(): string {
  return join(findSharedDataDir(), DATABASE_FILE)
}

/**
 * 打开库并应用迁移（studio 自己建表；Drizzle 官方 migrator，无需 CLI ——
 * Prisma 的 `migrate deploy` 在 Electron 内不可用，已实测）。
 * 连接级 pragma 与 Tauri 版 storage.rs 的 configure() 保持一致。
 *
 * 开发阶段只有一条迁移，其 DDL 全部写成 IF NOT EXISTS，
 * 因此「表已存在」（库是上一版建的、或手工建过）不是错误，迁移可安全重跑。
 */
function findClient(): Conn {
  if (client) return client

  const dbPath = findSharedDatabasePath()
  const dbDir = dirname(dbPath)
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })

  const file = new Database(dbPath)
  file.pragma('journal_mode = WAL')
  file.pragma('synchronous = NORMAL')
  file.pragma('busy_timeout = 5000')
  file.pragma('foreign_keys = ON')

  const migrationsFolder = join(findAppRoot(), 'drizzle', 'migrations')

  const db = drizzle({ client: file })
  migrate(db, { migrationsFolder })

  sqlite = file
  client = db
  logger?.info('数据库就绪（better-sqlite3 + Drizzle）')
  return client
}

function closeDatabase(): void {
  sqlite?.close()
  sqlite = null
  client = null
}

function toRecord(row: {
  id: string
  createdAt: Date
  updatedAt: Date
  name: string | null
  email: string | null
}): ReadR {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    name: row.name,
    email: row.email
  }
}

class Repository {
  async toRead(): Promise<ReadR[]> {
    const rows = await findClient().select().from(auth).orderBy(auth.id)
    return rows.map(toRecord)
  }

  async toWrite(input: WriteP): Promise<ReadR> {
    const now = new Date()
    const rows = await findClient()
      .insert(auth)
      .values({
        id: randomUUID(),
        name: input.name ?? null,
        email: input.email ? input.email : null,
        createdAt: now,
        updatedAt: now
      })
      .returning()
    return toRecord(rows[0])
  }

  async toUpdate(input: UpdateP): Promise<ReadR> {
    const rows = await findClient()
      .update(auth)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email ? input.email : null } : {}),
        // 旧实现靠 Prisma 的 @updatedAt 自动维护
        updatedAt: new Date()
      })
      .where(eq(auth.id, input.id))
      .returning()
    if (rows.length === 0) {
      throw new IpcError('USER_RECORD_NOT_FOUND', `记录不存在: ${input.id}`)
    }
    return toRecord(rows[0])
  }

  async toRemove(input: RemoveP): Promise<void> {
    // 旧实现用 Prisma delete，目标不存在时会报错；保持一致
    const rows = await findClient().delete(auth).where(eq(auth.id, input.id)).returning()
    if (rows.length === 0) {
      throw new IpcError('USER_RECORD_NOT_FOUND', `记录不存在: ${input.id}`)
    }
  }
}

/** 只负责生命周期：把 logger 接上（连接是惰性建立的），退出时关库 */
function buildPlugin(): Plugin {
  return {
    name: 'database',
    register(ctx: Context) {
      logger = ctx.logger.child('database')
    },
    async dispose() {
      closeDatabase()
    }
  }
}

export type { WriteP, UpdateP, RemoveP, ReadR, WriteR, UpdateR, RemoveR }
export { Repository, buildPlugin, findClient, findSharedDataDir }
// 临时 re-export：让既有测试与消费方不动，specs 批次收尾时移除
export { WriteSchema, UpdateSchema, RemoveSchema } from '@/shared/ipc/specs/user'
