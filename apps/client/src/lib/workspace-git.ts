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
}

interface DiffResult {
  original: string
  modified: string
  isBinary: boolean
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

async function diff(path: string, filePath: string) {
  return invoke<DiffResult>(CHANNELS.WORKSPACE_GIT.DIFF, { params: { path, filePath } })
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
  diff,
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
  DiffResult,
  ActionResult
}
