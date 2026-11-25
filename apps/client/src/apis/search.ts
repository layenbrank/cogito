/**
 * 搜索接口：引擎联想（Bing AS）+ 本机文件索引。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

/** Bing AS 的原始回包：`s` 是建议条目，`i` 是引擎信息；字段可能缺失，交给 `parseSuggestion` 收窄 */
interface EngineSuggestionWire {
  s?: Engine.Item[]
  i?: Engine.Info
}

function parseSuggestion(payload: EngineSuggestionWire): Engine.Suggestion {
  if (!Array.isArray(payload.s)) {
    throw new Error('search:suggest 缺少 s')
  }
  return { s: payload.s, i: payload.i ?? { ig: '' } }
}

async function GET_SEARCH_SUGGEST(qry: string): Promise<Engine.Suggestion> {
  const payload = await invoke<EngineSuggestionWire>(CHANNELS.SEARCH.SUGGEST, {
    body: { qry }
  })
  return parseSuggestion(payload)
}

// ------------------------------------------------------------ 文件索引

function GET_SEARCH_FILES<T>(params: { query: string; limit?: number }): Promise<T> {
  return invoke<T>(CHANNELS.SEARCH.FILES, { params })
}

/** 用系统默认程序打开索引命中的文件（Rust 侧先校验路径在索引里） */
function POST_SEARCH_OPEN_FILE(path: string): Promise<void> {
  return invoke(CHANNELS.SEARCH.OPEN_FILE, { params: { path } })
}

function POST_SEARCH_REVEAL_FILE(path: string): Promise<void> {
  return invoke(CHANNELS.SEARCH.REVEAL_FILE, { params: { path } })
}

/** 索引状态（与 Rust `FileIndexStatus` 同形） */
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

function GET_SEARCH_FILE_INDEX(): Promise<FileIndexStatus> {
  return invoke<FileIndexStatus>(CHANNELS.SEARCH.FILE_INDEX_STATUS)
}

/** 重建索引：清空后重新全盘扫描（后台跑，立即返回） */
function POST_SEARCH_FILE_INDEX_REBUILD(): Promise<void> {
  return invoke(CHANNELS.SEARCH.FILE_INDEX_REBUILD)
}

/** 停止正在进行的扫描：遍历线程一秒内退出，已写入的条目保留 */
function POST_SEARCH_FILE_INDEX_CANCEL(): Promise<void> {
  return invoke(CHANNELS.SEARCH.FILE_INDEX_CANCEL)
}

const EngineIpc = {
  GET_SEARCH_SUGGEST
}

export {
  EngineIpc,
  GET_SEARCH_FILE_INDEX,
  GET_SEARCH_FILES,
  GET_SEARCH_SUGGEST,
  POST_SEARCH_FILE_INDEX_CANCEL,
  POST_SEARCH_FILE_INDEX_REBUILD,
  POST_SEARCH_OPEN_FILE,
  POST_SEARCH_REVEAL_FILE
}
export type { FileIndexStatus }
