/**
 * 磁盘文件名搜索（Everything 式）。
 *
 * 不走本地 provider 注册表：那份契约要求**同步**返回，而文件搜索必然是一次 IPC。
 * 因此由 `use-command-search` 的异步 lane 直接调用这里，和 Bing 建议走同一条防抖 + 取消。
 */
import { invoke } from '@tauri-apps/api/core'

import { OMNIBAR_UI } from '@/features/command-bar/constants'
import type { Hit } from '@/features/command-bar/types'
import { CHANNELS } from '@/shared/ipc/channels'

/** 一条索引命中（与 Rust `FileHitR` 同形） */
interface FileHit {
  path: string
  name: string
  /** 所在目录（展示用） */
  dir: string
  /** 小写扩展名，无扩展名是空串 */
  ext: string
  isDir: boolean
  size: number
  modifiedAt: number
}

interface FileIndexStatus {
  /** idle = 还没建过；scanning = 正在扫；ready = 可查；error = 上次失败 */
  state: 'idle' | 'scanning' | 'ready' | 'error'
  /** 已收录条目数 */
  indexed: number
  /** 本轮扫描已遍历条目数 */
  scanned: number
  startedAt: number | null
  message: string | null
}

/** 扩展名 → 图标；没列到的按普通文件 */
const FILE_ICONS: Record<string, string> = {
  ts: 'lucide:file-code',
  tsx: 'lucide:file-code',
  js: 'lucide:file-code',
  jsx: 'lucide:file-code',
  mjs: 'lucide:file-code',
  cjs: 'lucide:file-code',
  css: 'lucide:file-code',
  scss: 'lucide:file-code',
  less: 'lucide:file-code',
  html: 'lucide:file-code',
  vue: 'lucide:file-code',
  py: 'lucide:file-code',
  rs: 'lucide:file-code',
  go: 'lucide:file-code',
  java: 'lucide:file-code',
  json: 'lucide:file-json',
  jsonc: 'lucide:file-json',
  md: 'lucide:file-text',
  mdx: 'lucide:file-text',
  txt: 'lucide:file-text',
  log: 'lucide:file-text',
  pdf: 'lucide:file-text',
  png: 'lucide:file-image',
  jpg: 'lucide:file-image',
  jpeg: 'lucide:file-image',
  gif: 'lucide:file-image',
  webp: 'lucide:file-image',
  svg: 'lucide:file-image',
  ico: 'lucide:file-image',
  zip: 'lucide:file-archive',
  rar: 'lucide:file-archive',
  '7z': 'lucide:file-archive',
  tar: 'lucide:file-archive',
  gz: 'lucide:file-archive',
  mp4: 'lucide:file-video',
  mkv: 'lucide:file-video',
  mov: 'lucide:file-video',
  webm: 'lucide:file-video',
  mp3: 'lucide:file-audio',
  wav: 'lucide:file-audio',
  flac: 'lucide:file-audio'
}

/** 短查询不查盘：`a` 这类会命中几十万行，且用户意图不明确 */
const MIN_QUERY_LENGTH = 2

async function searchFiles(query: string, signal: AbortSignal): Promise<Hit[]> {
  const trimmed = query.trim()
  if (trimmed.length < MIN_QUERY_LENGTH || signal.aborted) return []

  try {
    const items = await invoke<FileHit[]>(CHANNELS.SEARCH.FILES, {
      params: { query: trimmed, limit: OMNIBAR_UI.FILE_LIMIT }
    })
    if (signal.aborted) return []

    return items.map(function (item, index): Hit {
      return {
        domain: 'file',
        id: item.path,
        title: item.name,
        subtitle: item.dir,
        // 排在本地内容之后、Web 即时行之前
        score: 0.85 - index * 0.01,
        icon: item.isDir ? 'lucide:folder' : (FILE_ICONS[item.ext] ?? 'lucide:file'),
        async run() {
          // 走 Rust 命令：opener 插件的前端 scope 只放行固定目录，全盘命中会被拒
          await invoke(CHANNELS.SEARCH.OPEN_FILE, { params: { path: item.path } })
        },
        async reveal() {
          await invoke(CHANNELS.SEARCH.REVEAL_FILE, { params: { path: item.path } })
        }
      }
    })
  } catch (error) {
    if (!signal.aborted) console.warn('[command-bar] 文件搜索失败:', error)
    return []
  }
}

/** 索引状态（设置页展示 + 手动重建） */
async function GET_SEARCH_FILE_INDEX(): Promise<FileIndexStatus> {
  return invoke<FileIndexStatus>(CHANNELS.SEARCH.FILE_INDEX_STATUS)
}

/** 重建索引：清空后重新全盘扫描（后台跑，立即返回） */
async function POST_SEARCH_FILE_INDEX_REBUILD(): Promise<void> {
  await invoke(CHANNELS.SEARCH.FILE_INDEX_REBUILD)
}

export { POST_SEARCH_FILE_INDEX_REBUILD, GET_SEARCH_FILE_INDEX, searchFiles }
export type { FileHit, FileIndexStatus }
