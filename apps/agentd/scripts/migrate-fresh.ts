/**
 * 重置 agentd 自有库并重建：`pnpm --filter @cogito/agentd migrate:fresh`。
 *
 * 为什么需要它：agentd 的库只存**续跑所需**的东西（事件日志 / 票据 / checkpoint），
 * 开发期改表结构不必写「升级版本 + 兼容旧数据」—— 直接删库重建更省事，也不会留下
 * 「旧列还在、新列没写」的半吊子状态。客户端的 SQLite 同理，不跟着升 schema 版本。
 *
 * 用法：
 *
 *   pnpm --filter @cogito/agentd migrate:fresh
 *   pnpm --filter @cogito/agentd migrate:fresh -- --db D:\tmp\agentd.db
 *   pnpm --filter @cogito/agentd migrate:fresh -- --id com.cogito.client.dev
 *   pnpm --filter @cogito/agentd migrate:fresh -- --dry-run   # 只看会删哪个库
 *
 * 路径优先级：`--db` > `AGENTD_DB` > `<appLocalData>/<identifier>/agentd/agentd.db`。
 * `identifier` 默认 `com.cogito.client`（正式包），`--id` 可切到 `.dev` / `.devtest`。
 *
 * 注意：**agentd 正在跑时库文件被占用**，Windows 会直接拒绝删除 —— 先关掉应用
 * （或停掉 agentd）再跑。删完会立刻按 `MIGRATIONS` 重建并打印表清单与迁移版本。
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { openDb } from '../src/db.ts'

const DEFAULT_IDENTIFIER = 'com.cogito.client'
const DB_FILE = 'agentd.db'

function readArg(name: string): string {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0) return ''
  const value = process.argv[index + 1]
  return value === undefined || value.startsWith('--') ? '' : value
}

/** `appLocalData` 根：与 Tauri 的 `app_local_data_dir()` 同一套约定 */
function readAppLocalData(): string {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA?.trim()
    if (local) return local
    throw new Error('缺少 LOCALAPPDATA，无法推导默认库路径（可用 --db 显式指定）')
  }
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
  const xdg = process.env.XDG_DATA_HOME?.trim()
  return xdg ? xdg : join(homedir(), '.local', 'share')
}

function resolveDbPath(): string {
  const explicit = readArg('db')
  if (explicit) return explicit
  const fromEnv = process.env.AGENTD_DB?.trim()
  if (fromEnv) return fromEnv
  const identifier = readArg('id') || DEFAULT_IDENTIFIER
  return join(readAppLocalData(), identifier, 'agentd', DB_FILE)
}

const dbPath = resolveDbPath()
const dryRun = process.argv.includes('--dry-run')
const targets = ['', '-wal', '-shm'].map(function (suffix) {
  return `${dbPath}${suffix}`
})
if (dryRun) {
  console.log(`库：${dbPath}`)
  console.log(
    `将删除：${
      targets
        .filter(function (file) {
          return existsSync(file)
        })
        .join(', ') || '（不存在，只会新建）'
    }`
  )
  process.exit(0)
}

mkdirSync(dirname(dbPath), { recursive: true })

// WAL 模式会额外留下 `-wal` / `-shm`：三个都要删，否则旧日志会被新库读回去
const removed: string[] = []
for (const file of targets) {
  if (!existsSync(file)) continue
  try {
    rmSync(file)
    removed.push(file)
  } catch (error) {
    console.error(`无法删除 ${file}：${error instanceof Error ? error.message : String(error)}`)
    console.error('agentd（或桌面应用）可能还在跑：先关掉它，再重跑 migrate:fresh。')
    process.exit(1)
  }
}

const db = openDb(dbPath)
try {
  const version = db.get<{ version: number | null }>('SELECT MAX(version) AS version FROM _migrations')
  const tables = db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  )
  console.log(`库：${dbPath}`)
  console.log(`删除：${removed.length} 个文件${removed.length > 0 ? `（${removed.join(', ')}）` : ''}`)
  console.log(`迁移版本：${version?.version ?? 0}`)
  console.log(`表：${tables.map(function (row) { return row.name }).join(', ')}`)
} finally {
  db.close()
}
