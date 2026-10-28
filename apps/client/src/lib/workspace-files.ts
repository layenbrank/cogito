/**
 * 工作区文件 IPC：按层列举 + 封顶搜索 + 内容检索 + 受 roots 约束的读文件
 */
import { invoke } from '@tauri-apps/api/core'

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
}

interface ReadFileResult {
  path: string
  content: string
}

interface ContentHit {
  /** 绝对路径 */
  path: string
  relative: string
  line: number
  column: number
  preview: string
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

async function listDir(root: string, relative = '') {
  return invoke<DirEntry[]>(CHANNELS.WORKSPACE_FILES.LIST_DIR, {
    params: { root, relative: relative || null }
  })
}

async function search(roots: string[], query: string, limit = 50) {
  return invoke<SearchHit[]>(CHANNELS.WORKSPACE_FILES.SEARCH, {
    params: { roots, query, limit }
  })
}

async function readFile(roots: string[], path: string) {
  return invoke<ReadFileResult>(CHANNELS.WORKSPACE_FILES.READ_FILE, {
    params: { roots, path }
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

const WorkspaceFiles = {
  listDir,
  search,
  content,
  readFile
}

export { WorkspaceFiles }
export type { DirEntry, ReadFileResult, SearchHit, ContentHit, ContentResult, ContentQuery }
