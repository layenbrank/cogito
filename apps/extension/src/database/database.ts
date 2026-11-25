import { Dexie, type EntityTable, type Table } from 'dexie'

/**
 * 本地库（Dexie）：镜像与磁贴，加上 agent 会话数据。
 *
 * 历史版本声明（v2 / v3 / v4）保持原样，否则已有用户的库无法按原路径升级。
 */

interface DataBase extends Dexie {
  mirror: EntityTable<Mirror, 'id'>
  magneticTile: EntityTable<MagneticTile, 'id'>

  backup: EntityTable<Backup, 'id'>
  setting: EntityTable<Settings, 'id'>
  user: EntityTable<UserProfile, 'id'>

  bookmark: EntityTable<Bookmark.Entry, 'id'>
  calendarEvent: EntityTable<CalendarEventRow, 'id'>
  reminder: EntityTable<ReminderRow, 'id'>
  clockPref: EntityTable<ClockPrefRow, 'id'>
  galleryAsset: EntityTable<GalleryAssetRow, 'id'>

  agentThread: EntityTable<AgentThreadRow, 'id'>
  /** 主键是自增 `seq`：消息没有时间字段，线程内顺序靠插入顺序 */
  agentMessage: Table<AgentMessageRow, number>
  agentProvider: EntityTable<AgentProviderRow, 'id'>
}

/** 一条会话（对齐 `@cogito/chat/ports` 的 `ChatThread`，外加续跑所需的游标） */
interface AgentThreadRow {
  id: string
  title: string
  pinned: boolean
  providerID: string | null
  workspaceID: string | null
  /**
   * agentd 事件流游标。
   *
   * 不存它的话，刷新页面后再订阅会从 `after=0` 开始，agentd 重放上一轮的
   * `settled` / `error`，新一轮会被当场判成结束（client 上也踩过同一个坑）。
   */
  lastSeq: number
  /**
   * `lastSeq` 所属的 agentd 进程。agentd 重启后 `seq` 从 0 重来，带着它订阅可以让服务端
   * 直接判定要不要 reset，而不是靠客户端猜「这次的数字变小了」。旧行没这个字段 = null。
   */
  lastEpoch?: string | null
  /** agentd 里的会话 id（首轮跑完才拿得到；压缩上下文等操作需要它） */
  acpSessionID: string | null
  createdAt: number
  updatedAt: number
}

/** 一条消息（列名是 assistant-ui 的存储契约，不可改名） */
interface AgentMessageRow {
  /** 自增插入序号；查询时按它升序 */
  seq?: number
  id: string
  threadID: string
  parentID: string | null
  format: string
  content: string
}

/** 一个模型接入（组织模型 / 自带 Key） */
interface AgentProviderRow {
  id: string
  /** `cogito_gateway` = 登录即用的组织模型，其余是用户自建接入 */
  kind: string
  name: string
  baseURL: string | null
  models: string[]
  model: string | null
  enabled: boolean
  createdAt: number
  updatedAt: number
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

const AGENT_THREAD: readonly string[] = [
  '&id',
  'pinned',
  'updatedAt',
  'workspaceID',
  'providerID'
]
/** `++seq` 是自增主键；`&id` 是调用方给的稳定 id（assistant-ui 用它做消息身份） */
const AGENT_MESSAGE: readonly string[] = [
  '++seq',
  '&id',
  'threadID',
  '[threadID+seq]',
  'parentID'
]
const AGENT_PROVIDER: readonly string[] = ['&id', 'kind', 'updatedAt']

version(5).stores({
  agentThread: AGENT_THREAD.join(','),
  agentMessage: AGENT_MESSAGE.join(','),
  agentProvider: AGENT_PROVIDER.join(',')
})

const BOOKMARK_LIBRARY: readonly string[] = [
  '&id',
  'mirrorID',
  'parentID',
  'url',
  '[mirrorID+url]',
  'index',
  'updatedAt',
  'createdAt'
]

version(6).stores({
  bookmark: BOOKMARK_LIBRARY.join(',')
})

const CALENDAR_EVENT: readonly string[] = [
  '&id',
  'startAt',
  'endAt',
  'reminderID',
  'archivedAt',
  'updatedAt'
]
const REMINDER: readonly string[] = ['&id', 'dueAt', 'fireTime', 'enabled', 'archivedAt', 'updatedAt']
const CLOCK_PREF: readonly string[] = ['&id', 'updatedAt']

version(7).stores({
  calendarEvent: CALENDAR_EVENT.join(','),
  reminder: REMINDER.join(','),
  clockPref: CLOCK_PREF.join(',')
})

version(8).stores({
  galleryAsset: '&id, kind, hidden, createdAt'
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

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', function (event: PromiseRejectionEvent) {
    if (!isClosedError(event.reason)) return
    alert('数据库异常关闭，请刷新页面')
  })
}

/** Dexie 在库被关闭后抛的错误（`DataBaseClosedError`） */
function isClosedError(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  return (value as { name?: unknown }).name === 'DataBaseClosedError'
}

interface CalendarEventRow {
  id: string
  title: string
  notes: string
  startAt: number
  endAt: number
  entireDay: boolean
  color: string | null
  reminderID: string | null
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

interface ReminderRow {
  id: string
  title: string
  notes: string
  dueAt: number | null
  endAt: number | null
  fireTime: string | null
  weekDays: string
  entireDay: boolean
  enabled: boolean
  snoozeUntil: number | null
  lastFiredAt: number | null
  priority: number
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

interface GalleryAssetRow {
  id: string
  name: string
  mime: string
  kind: 'photo' | 'video'
  blob: Blob
  hidden: boolean
  createdAt: number
}

interface ClockPrefRow {
  id: string
  clockStyle: 'digital' | 'analog' | 'flip'
  workStart: string
  workEnd: string
  workDays: string
  monthlySalary: number
  payDay: number
  updatedAt: number
}

export type {
  AgentMessageRow,
  AgentProviderRow,
  AgentThreadRow,
  CalendarEventRow,
  ClockPrefRow,
  DataBase,
  GalleryAssetRow,
  ReminderRow
}
