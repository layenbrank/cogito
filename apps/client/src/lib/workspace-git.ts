/**
 * 工作区 Git IPC：探测仓库、列分支、切换分支
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

async function probe(path: string) {
  return invoke<ProbeResult>(CHANNELS.WORKSPACE_GIT.PROBE, { params: { path } })
}

async function fetchBranches(path: string) {
  return invoke<BranchesResult>(CHANNELS.WORKSPACE_GIT.BRANCHES, { params: { path } })
}

async function checkout(path: string, branch: string) {
  return invoke<CheckoutResult>(CHANNELS.WORKSPACE_GIT.CHECKOUT, { params: { path, branch } })
}

const WorkspaceGit = {
  probe,
  fetchBranches,
  checkout
}

export { WorkspaceGit }
export type { ProbeResult, BranchesResult, CheckoutResult }
