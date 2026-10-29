/**
 * 工作区 Git IPC：探测仓库、分支、变更状态、差异与常见操作。
 *
 * 这里是前端唯一的 Git 调用出口；视图层只消费这里导出的类型与函数。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

interface ProbeResult {
  isRepo: boolean
  branch: string | null
}

interface BranchesResult {
  current: string
  branches: string[]
}

interface CheckoutResult {
  branch: string
}

interface StatusEntry {
  path: string
  /** 暂存区状态字符（`git status` 的 X） */
  indexStatus: string
  /** 工作区状态字符（Y） */
  worktreeStatus: string
}

interface StatusResult {
  branch: string
  ahead: number
  behind: number
  entries: StatusEntry[]
  /** Rust 指纹缓存命中 */
  cacheHit?: boolean
  /** 载荷与上次相同，前端可跳过替换 entries */
  unchanged?: boolean
}

type DiffMode = 'sideBySide' | 'hunks'

interface DiffMeta {
  mode: DiffMode
  isBinary: boolean
  isLarge: boolean
  isIdentical: boolean
  originalLines: number
  modifiedLines: number
  hunkCount: number
  added: number
  deleted: number
  fileBytes: number
}

interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  header: string
  lines: string[]
}

interface DiffHunksResult {
  hunks: DiffHunk[]
  total: number
  offset: number
}

interface DiffResult {
  /** sideBySide：Monaco DiffEditor；hunks：结构化块列表（大重写） */
  mode: DiffMode
  original: string
  modified: string
  /** @deprecated 整包 unified 已收掉；保留空串兼容旧调用方 */
  patch: string
  isBinary: boolean
  isLarge: boolean
  isIdentical: boolean
  originalLines: number
  modifiedLines: number
  hunkCount: number
  added: number
  deleted: number
}

interface ActionResult {
  summary: string
}

async function probe(path: string) {
  return invoke<ProbeResult>(CHANNELS.WORKSPACE_GIT.PROBE, { params: { path } })
}

async function fetchBranches(path: string) {
  return invoke<BranchesResult>(CHANNELS.WORKSPACE_GIT.BRANCHES, { params: { path } })
}

async function checkout(path: string, branch: string) {
  return invoke<CheckoutResult>(CHANNELS.WORKSPACE_GIT.CHECKOUT, { params: { path, branch } })
}

async function status(path: string) {
  return invoke<StatusResult>(CHANNELS.WORKSPACE_GIT.STATUS, { params: { path } })
}

async function invalidate(path: string) {
  return invoke<ActionResult>(CHANNELS.WORKSPACE_GIT.INVALIDATE, { params: { path } })
}

async function diff(path: string, filePath: string) {
  return invoke<DiffResult>(CHANNELS.WORKSPACE_GIT.DIFF, { params: { path, filePath } })
}

async function diffMeta(path: string, filePath: string) {
  return invoke<DiffMeta>(CHANNELS.WORKSPACE_GIT.DIFF_META, { params: { path, filePath } })
}

async function diffHunks(path: string, filePath: string, offset = 0, limit = 40) {
  return invoke<DiffHunksResult>(CHANNELS.WORKSPACE_GIT.DIFF_HUNKS, {
    params: { path, filePath, offset, limit }
  })
}

async function stage(path: string, paths: string[]) {
  return invoke<ActionResult>(CHANNELS.WORKSPACE_GIT.STAGE, { params: { path, paths } })
}

async function unstage(path: string, paths: string[]) {
  return invoke<ActionResult>(CHANNELS.WORKSPACE_GIT.UNSTAGE, { params: { path, paths } })
}

async function discard(path: string, paths: string[], isUntracked = false) {
  return invoke<ActionResult>(CHANNELS.WORKSPACE_GIT.DISCARD, {
    params: { path, paths, isUntracked }
  })
}

async function commit(path: string, message: string, isStageAll: boolean) {
  return invoke<ActionResult>(CHANNELS.WORKSPACE_GIT.COMMIT, {
    params: { path, message, isStageAll }
  })
}

async function fetchAll(path: string) {
  return invoke<ActionResult>(CHANNELS.WORKSPACE_GIT.FETCH, { params: { path } })
}

async function pull(path: string) {
  return invoke<ActionResult>(CHANNELS.WORKSPACE_GIT.PULL, { params: { path } })
}

const WorkspaceGit = {
  probe,
  fetchBranches,
  checkout,
  status,
  invalidate,
  diff,
  diffMeta,
  diffHunks,
  stage,
  unstage,
  discard,
  commit,
  fetchAll,
  pull
}

export { WorkspaceGit }
export type {
  ProbeResult,
  BranchesResult,
  CheckoutResult,
  StatusEntry,
  StatusResult,
  DiffMode,
  DiffMeta,
  DiffHunk,
  DiffHunksResult,
  DiffResult,
  ActionResult
}
