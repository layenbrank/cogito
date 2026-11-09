/**
 * 工作区文件 IPC：按层列举 + 封顶搜索 + 内容检索 / 替换 + 受 roots 约束的读文件
 * + 目录监听（Rust 侧递归 + 过滤，只回受影响的相对目录）
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import { CHANNELS } from '@/shared/ipc/channels'

interface DirEntry {
  name: string
  /** 已知 `file` / `dir`，后端可能加档，故为开放字符串 */
  kind: string
  path: string
  relative: string
}

interface SearchHit {
  name: string
  relative: string
  path: string
  /** 后端一定会给：`file` | `dir` */
  kind: 'file' | 'dir'
}

interface SearchResult {
  hits: SearchHit[]
  isTruncated: boolean
}

interface ReadFileResult {
  path: string
  content: string
}

interface PackTypesFile {
  path: string
  content: string
}

interface PackTypesResult {
  files: PackTypesFile[]
  isTruncated: boolean
  /** 候选文件总数（`@types` 目录里的 .d.ts 数量） */
  total: number
  /** 下一块的 offset；等于 total 表示取完了 */
  nextOffset: number
}

interface ContentHit {
  /** 绝对路径 */
  path: string
  relative: string
  line: number
  column: number
  preview: string
  /** 命中在 preview 内的 Unicode 标量起点（含） */
  matchStart: number
  /** 命中在 preview 内的 Unicode 标量终点（不含） */
  matchEnd: number
}

interface ContentResult {
  hits: ContentHit[]
  fileCount: number
  isTruncated: boolean
}

interface ContentQuery {
  root: string
  query: string
  isRegex?: boolean
  isCaseSensitive?: boolean
  isWholeWord?: boolean
  /** 逗号分隔 glob；空 = 不限 */
  includes?: string
  /** 逗号分隔 glob */
  excludes?: string
  limit?: number
}

interface ReplaceQuery {
  root: string
  paths: string[]
  query: string
  isRegex?: boolean
  isCaseSensitive?: boolean
  isWholeWord?: boolean
  replacement: string
  isPreserveCase?: boolean
}

interface ReplaceChanged {
  path: string
  count: number
  content: string
}

interface ReplaceFailed {
  path: string
  message: string
}

interface ReplaceResult {
  changed: ReplaceChanged[]
  failed: ReplaceFailed[]
}

/** 监听事件里的「受影响的目录」：`rootIndex` 对应 roots 下标，`relative` 是相对目录（根层为空串） */
interface WatchDir {
  rootIndex: number
  relative: string
}

interface WorkspaceFilesChangedEvent {
  dirs: WatchDir[]
  /** 目录点名被截断 / 变化无法定位：前端可回退整树刷新 */
  isCoarse: boolean
}

async function listDir(root: string, relative = '') {
  return invoke<DirEntry[]>(CHANNELS.WORKSPACE_FILES.LIST_DIR, {
    params: { root, relative: relative || null }
  })
}

async function search(roots: string[], query: string, limit = 50) {
  return invoke<SearchResult>(CHANNELS.WORKSPACE_FILES.SEARCH, {
    params: { roots, query, limit }
  })
}

async function readFile(roots: string[], path: string) {
  return invoke<ReadFileResult>(CHANNELS.WORKSPACE_FILES.READ_FILE, {
    params: { roots, path }
  })
}

async function packTypes(root: string, offset = 0, limit?: number) {
  return invoke<PackTypesResult>(CHANNELS.WORKSPACE_FILES.PACK_TYPES, {
    params: { root, offset, limit: limit ?? null }
  })
}

/**
 * 开始（或换一组根）监听：Rust 侧递归监听 + 就地丢弃 node_modules/.git/dist 等噪音，
 * 合批后通过 `workspaceFiles:changed` 推送受影响的相对目录。
 */
async function watch(roots: string[], delayMs?: number) {
  return invoke<void>(CHANNELS.WORKSPACE_FILES.WATCH, {
    params: { roots, delayMs: delayMs ?? null }
  })
}

async function unwatch() {
  return invoke<void>(CHANNELS.WORKSPACE_FILES.UNWATCH)
}

async function listenChanged(
  handler: (event: WorkspaceFilesChangedEvent) => void
): Promise<UnlistenFn> {
  return listen<WorkspaceFilesChangedEvent>(CHANNELS.WORKSPACE_FILES.CHANGED, function (event) {
    handler(event.payload)
  })
}

async function content(query: ContentQuery) {
  return invoke<ContentResult>(CHANNELS.WORKSPACE_FILES.CONTENT, {
    params: {
      root: query.root,
      query: query.query,
      isRegex: query.isRegex ?? false,
      isCaseSensitive: query.isCaseSensitive ?? false,
      isWholeWord: query.isWholeWord ?? false,
      includes: query.includes?.trim() || null,
      excludes: query.excludes?.trim() || null,
      limit: query.limit
    }
  })
}

async function replace(query: ReplaceQuery) {
  return invoke<ReplaceResult>(CHANNELS.WORKSPACE_FILES.REPLACE, {
    params: {
      root: query.root,
      paths: query.paths,
      query: query.query,
      isRegex: query.isRegex ?? false,
      isCaseSensitive: query.isCaseSensitive ?? false,
      isWholeWord: query.isWholeWord ?? false,
      replacement: query.replacement,
      isPreserveCase: query.isPreserveCase ?? false
    }
  })
}

const WorkspaceFiles = {
  listDir,
  search,
  content,
  replace,
  readFile,
  packTypes,
  watch,
  unwatch,
  listenChanged
}

export { WorkspaceFiles }
export type {
  DirEntry,
  ReadFileResult,
  SearchHit,
  SearchResult,
  PackTypesFile,
  PackTypesResult,
  ContentHit,
  ContentResult,
  ContentQuery,
  ReplaceQuery,
  ReplaceChanged,
  ReplaceFailed,
  ReplaceResult,
  WatchDir,
  WorkspaceFilesChangedEvent
}
