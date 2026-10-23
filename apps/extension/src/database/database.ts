import { Dexie, type EntityTable } from 'dexie'

/**
 * 本地库（Dexie）：只保留当前仍在用的表 —— 镜像与磁贴。
 *
 * 历史版本声明（v2 / v3）保持原样，否则已有用户的库无法按原路径升级；
 * v4 把随磁贴下线而废弃的表删掉（bookmark / markdown / Ai*）。
 * `backup` / `setting` / `user` 属于用户数据，先留着。
 */

interface DataBase extends Dexie {
  mirror: EntityTable<Mirror, 'id'>
  magneticTile: EntityTable<MagneticTile, 'id'>

  backup: EntityTable<Backup, 'id'>
  setting: EntityTable<Settings, 'id'>
  user: EntityTable<UserProfile, 'id'>
}

const DBNAME: Readonly<string> = 'cogito'

export const database = new Dexie(DBNAME) as DataBase

/** 历史版本里才会出现的表（接口已经不声明它们），声明时用宽松签名 */
interface VersionBuilder {
  stores: (schema: Record<string, string | null>) => void
}

const version = database.version.bind(database) as unknown as (number: number) => VersionBuilder

const MIRROR: readonly string[] = [
  '&id',
  'index',
  'mark',
  'size',
  'shape',
  'direction',
  'updatedAt',
  'createdAt'
]

const MAGNETIC_TILE: readonly string[] = [
  '&id',
  '[id+mirrorID]',
  '[id+collectionID]',
  '[mirrorID+collectionID]',
  'mirrorID',
  'collectionID',
  'index',
  'component',
  'downloadCount',
  'updatedAt',
  'createdAt'
]

const USERS: readonly string[] = ['++id', 'name']
const BACKUP: readonly string[] = ['&id', 'createdAt', 'updatedAt']
const SETTING: readonly string[] = ['&id', 'theme', 'language']

const BOOKMARK: readonly string[] = ['&id', 'index', 'dirID', 'createdAt', 'updatedAt']
const BOOKMARK_DIR: readonly string[] = ['&id', 'index', 'count', 'createdAt', 'updatedAt']
const MARKDOWN: readonly string[] = ['&id', 'index', 'createdAt', 'updatedAt']

const AISESSION: readonly string[] = ['&id', 'workspaceID', 'createdAt', 'updatedAt']
const AIMESSAGE: readonly string[] = ['&id', 'sessionID', 'identity', 'createdAt', 'updatedAt']
const AIWORKSPACE: readonly string[] = ['&id', 'pinned', 'archivedAt', 'createdAt', 'updatedAt']
const AIWORKSPACE_FOLDER: readonly string[] = [
  '&id',
  'workspaceID',
  'isPrimary',
  'sort',
  'createdAt',
  'updatedAt'
]

version(2).stores({
  mirror: MIRROR.join(','),
  magneticTile: MAGNETIC_TILE.join(','),

  backup: BACKUP.join(','),
  setting: SETTING.join(','),
  user: USERS.join(','),

  bookmark: BOOKMARK.join(','),
  bookmarkDir: BOOKMARK_DIR.join(','),

  markdown: MARKDOWN.join(','),

  AiSession: AISESSION.join(','),
  AiMessage: AIMESSAGE.join(','),
  AiCollection: '&id,createdAt,updatedAt'
})

version(3).stores({
  AiSession: AISESSION.join(','),
  AiWorkspace: AIWORKSPACE.join(','),
  AiWorkspaceFolder: AIWORKSPACE_FOLDER.join(','),
  AiCollection: null
})

/** 磁贴收窄为 navigation 后，这些表不再有任何代码使用 */
version(4).stores({
  bookmark: null,
  bookmarkDir: null,
  markdown: null,
  AiSession: null,
  AiMessage: null,
  AiWorkspace: null,
  AiWorkspaceFolder: null
})

database.on(
  'ready',
  function (db) {
    if (!import.meta.env.DEV) return
    console.log('数据库已准备就绪，当前版本:', db.verno)
    for (const table of db.tables) {
      void table.count().then(function (count) {
        log(`${table.name}表记录数:`, count.toString())
      })
    }
  },
  true
)

database.on('blocked', function (_e) {
  if (!import.meta.env.DEV) return
  console.error('数据库被阻塞，请关闭其他使用此数据库的标签页')
})

function log(label: string, msg: string) {
  if (!import.meta.env.DEV) return
  console.log(
    `%c ${label} ${msg}`,
    'background:#3B82FE; padding: 3px; padding-right: 8px; border-radius: 3px; color: #fff;'
  )
}

window.addEventListener('unhandledrejection', function (event: PromiseRejectionEvent) {
  if (!isClosedError(event.reason)) return
  alert('数据库异常关闭，请刷新页面')
})

/** Dexie 在库被关闭后抛的错误（`DataBaseClosedError`） */
function isClosedError(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  return (value as { name?: unknown }).name === 'DataBaseClosedError'
}
