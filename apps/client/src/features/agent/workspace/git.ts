/**
 * Agent 面板共享的 Git 快照与动作层。
 *
 * 审阅、提交历史、composer 分支区看的是同一个「当前文件夹」，所以读状态、
 * 切分支、暂存 / 提交、拉取 / 推送都收在这一个文件里：
 *
 * - `useWorkspaceGitSnapshot(rootPath)`：一次拿全（仓库探测 / 分支 / 变更 / 上游分歧 / 分支清单），
 *   并跟随 `useWorkspaceRevision` 自动重拉；
 * - 动作函数（fetchNow / pullNow / pushNow / checkoutNow / stageNow / commitNow …）
 *   成功后统一 `bumpWorkspaceRevision()`，让所有面板一起刷新，不必各自实现。
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import {
  bumpWorkspaceRevision,
  useWorkspaceRevision
} from '@/features/agent/workspace/revision.ts'
import {
  WorkspaceGit,
  type BranchesResult,
  type StatusEntry,
  type UpstreamResult
} from '@/lib/workspace-git'

interface WorkspaceGitSnapshot {
  rootPath: string | null
  isRepo: boolean
  branch: string
  /** 相对上游的领先 / 落后（`git status --branch` 口径） */
  ahead: number
  behind: number
  entries: StatusEntry[]
  /** 上游分歧详情；没有上游时为 null */
  upstream: UpstreamResult | null
  /** 本地 + 远端分支清单 */
  branches: BranchesResult | null
  isPending: boolean
  error: string | null
}

interface SnapshotData {
  isRepo: boolean
  branch: string
  ahead: number
  behind: number
  entries: StatusEntry[]
  upstream: UpstreamResult | null
  branches: BranchesResult | null
}

const EMPTY_DATA: SnapshotData = {
  isRepo: false,
  branch: '',
  ahead: 0,
  behind: 0,
  entries: [],
  upstream: null,
  branches: null
}

/** 同一 root + 版本 + 强制标记只发一轮 IPC：多个面板同时挂载时共享同一个 promise */
const inflight = new Map<string, Promise<SnapshotData>>()

async function loadSnapshot(rootPath: string): Promise<SnapshotData> {
  // 工作区改动不进状态指纹：读之前先失效，否则可能一直命中旧缓存
  try {
    await WorkspaceGit.invalidate(rootPath)
  } catch (cause) {
    console.warn('[agent/git] invalidate 失败:', cause)
  }
  const probe = await WorkspaceGit.probe(rootPath)
  if (!probe.isRepo) return EMPTY_DATA
  const [status, upstream, branches] = await Promise.all([
    WorkspaceGit.status(rootPath).catch(function () {
      return null
    }),
    WorkspaceGit.upstream(rootPath).catch(function () {
      return null
    }),
    WorkspaceGit.fetchBranches(rootPath).catch(function () {
      return null
    })
  ])
  return {
    isRepo: true,
    branch: status?.branch || probe.branch || '',
    ahead: status?.ahead ?? 0,
    behind: status?.behind ?? 0,
    entries: status?.entries ?? [],
    upstream,
    branches
  }
}

function useWorkspaceGitSnapshot(rootPath: string | null): WorkspaceGitSnapshot {
  const revision = useWorkspaceRevision()
  const [data, updateData] = useState<SnapshotData>(EMPTY_DATA)
  const [isPending, updatePending] = useState(Boolean(rootPath))
  const [error, updateError] = useState<string | null>(null)

  useEffect(
    function () {
      if (!rootPath) {
        updateData(EMPTY_DATA)
        updatePending(false)
        updateError(null)
        return
      }

      let cancelled = false
      const key = `${rootPath}\u0000${revision}`
      let task = inflight.get(key)
      if (!task) {
        task = loadSnapshot(rootPath)
        inflight.set(key, task)
        void task.finally(function () {
          inflight.delete(key)
        })
      }

      updatePending(true)
      updateError(null)
      task
        .then(function (next) {
          if (cancelled) return
          updateData(next)
        })
        .catch(function (cause: unknown) {
          if (cancelled) return
          console.warn('[agent/git] 读取快照失败:', cause)
          updateError(cause instanceof Error ? cause.message : '读取 Git 状态失败')
        })
        .finally(function () {
          if (!cancelled) updatePending(false)
        })

      return function () {
        cancelled = true
      }
    },
    [rootPath, revision]
  )

  return {
    rootPath,
    isRepo: rootPath ? data.isRepo : false,
    branch: rootPath ? data.branch : '',
    ahead: data.ahead,
    behind: data.behind,
    entries: rootPath ? data.entries : [],
    upstream: data.upstream,
    branches: data.branches,
    isPending,
    error
  }
}

/* ------------------------------- 动作层 ------------------------------- */

interface GitActionOutcome {
  ok: boolean
  message: string
}

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string' && cause.trim()) return cause
  return fallback
}

/**
 * 跑一个写操作：成功 → 广播 revision + 轻提示；失败 → 错误提示并原样返回。
 * 调用方通常不需要再写 try/catch。
 */
async function runGitAction(
  rootPath: string | null,
  label: string,
  task: (root: string) => Promise<{ summary: string }>
): Promise<GitActionOutcome> {
  if (!rootPath) return { ok: false, message: '当前文件夹不是 Git 仓库' }
  try {
    const result = await task(rootPath)
    bumpWorkspaceRevision()
    toast.success(result.summary || label + '成功')
    return { ok: true, message: result.summary || '' }
  } catch (cause) {
    const message = toMessage(cause, label + '失败')
    toast.error(message)
    return { ok: false, message }
  }
}

/** 强制刷新：先 invalidate 再广播，所有面板重读 */
async function refreshNow(rootPath: string | null): Promise<void> {
  if (!rootPath) return
  try {
    await WorkspaceGit.invalidate(rootPath)
  } catch (cause) {
    console.warn('[agent/git] invalidate 失败:', cause)
  }
  bumpWorkspaceRevision()
}

/** 抓取远程更新（只更新远端跟踪分支，不动工作区） */
function fetchNow(rootPath: string | null) {
  return runGitAction(rootPath, '获取远程更新', function (root) {
    return WorkspaceGit.fetchAll(root)
  })
}

/** 拉取：把上游提交快进 / 合并进当前分支 */
function pullNow(rootPath: string | null) {
  return runGitAction(rootPath, '拉取', function (root) {
    return WorkspaceGit.pull(root)
  })
}

/** 推送；`isSetUpstream` 用于本地分支首次推送（顺带建立跟踪关系） */
function pushNow(rootPath: string | null, branch: string, isSetUpstream = false) {
  return runGitAction(rootPath, '推送', function (root) {
    return WorkspaceGit.push(root, branch, isSetUpstream)
  })
}

/**
 * 切分支；`fromRemote` 是 `origin/feat` 这类远端引用，
 * 本地没有同名分支时后端会 `checkout -b … --track`。
 */
function checkoutNow(rootPath: string | null, branch: string, fromRemote?: string | null) {
  return runGitAction(rootPath, '切换分支', function (root) {
    return WorkspaceGit.checkout(root, branch, fromRemote).then(function (result) {
      return { summary: `已切换到 ${result.branch}` }
    })
  })
}

function stageNow(rootPath: string | null, paths: string[]) {
  return runGitAction(rootPath, '暂存', function (root) {
    return WorkspaceGit.stage(root, paths)
  })
}

function unstageNow(rootPath: string | null, paths: string[]) {
  return runGitAction(rootPath, '取消暂存', function (root) {
    return WorkspaceGit.unstage(root, paths)
  })
}

function discardNow(rootPath: string | null, paths: string[], isUntracked = false) {
  return runGitAction(rootPath, isUntracked ? '删除文件' : '撤销更改', function (root) {
    return WorkspaceGit.discard(root, paths, isUntracked)
  })
}

function commitNow(rootPath: string | null, message: string, isStageAll = false) {
  return runGitAction(rootPath, '提交', function (root) {
    return WorkspaceGit.commit(root, message, isStageAll)
  })
}

export {
  commitNow,
  checkoutNow,
  discardNow,
  fetchNow,
  pullNow,
  pushNow,
  refreshNow,
  stageNow,
  unstageNow,
  useWorkspaceGitSnapshot
}
export type { GitActionOutcome, WorkspaceGitSnapshot }
