/**
 * 代码窗的源码管理状态：分支、变更列表、差异内容。
 *
 * 与 `stores/code.ts` 分开 —— 这里的状态全部来自 git 命令，不参与窗口 shell 持久化。
 */
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import {
  WorkspaceGit,
  type DiffHunk,
  type DiffMode,
  type StatusEntry
} from '@/lib/workspace-git'

interface GitDiff {
  /** 相对仓库根的路径 */
  relative: string
  mode: DiffMode
  original: string
  modified: string
  isBinary: boolean
  isLarge: boolean
  isIdentical: boolean
  /** 壳已打开、内容还在路上（先出界面再等 IPC） */
  isLoading: boolean
  added: number
  deleted: number
  hunks: DiffHunk[]
  hunkTotal: number
  isHunksLoading: boolean
  hasMoreHunks: boolean
}

/** 动作结果：失败时由调用方决定提示方式 */
interface GitOutcome {
  ok: boolean
  message: string
}

interface CodeGitState {
  repoRoot: string | null
  isRepo: boolean
  branch: string
  ahead: number
  behind: number
  entries: StatusEntry[]
  isLoading: boolean
  error: string | null
  diff: GitDiff | null

  /** 工作区根变化时调用：probe 后按需读取状态 */
  toSync: (root: string | null) => Promise<void>
  /** watch 回调：先失效缓存再刷新 */
  toInvalidateAndRefresh: () => Promise<void>
  toRefresh: () => Promise<void>
  toStage: (paths: string[]) => Promise<GitOutcome>
  toUnstage: (paths: string[]) => Promise<GitOutcome>
  toDiscard: (paths: string[], isUntracked: boolean) => Promise<GitOutcome>
  toCommit: (message: string, isStageAll: boolean) => Promise<GitOutcome>
  toFetch: () => Promise<GitOutcome>
  toPull: () => Promise<GitOutcome>
  toOpenDiff: (relative: string) => Promise<GitOutcome>
  toLoadMoreHunks: () => Promise<void>
  toCloseDiff: () => void
}

const HUNK_PAGE = 40

function toMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error
  if (error instanceof Error && error.message) return error.message
  return fallback
}

/** 各写操作完成后的统一收尾：刷新状态由调用方决定，这里只给出结果 */
function success(summary: string): GitOutcome {
  return { ok: true, message: summary }
}

/** 失败出口：统一留痕 + 转成可直接提示的文案 */
function reportFailure(error: unknown, fallback: string): GitOutcome {
  console.error('[code] git action failed', fallback, error)
  return { ok: false, message: toMessage(error, fallback) }
}

const useCodeGitStore = create<CodeGitState>()(
  immer(function (set, get) {
    return {
      repoRoot: null,
      isRepo: false,
      branch: '',
      ahead: 0,
      behind: 0,
      entries: [],
      isLoading: false,
      error: null,
      diff: null,

      async toSync(root) {
        if (!root) {
          set(function (state) {
            state.repoRoot = null
            state.isRepo = false
            state.branch = ''
            state.ahead = 0
            state.behind = 0
            state.entries = []
            state.error = null
            state.diff = null
          })
          return
        }
        try {
          const probeResult = await WorkspaceGit.probe(root)
          set(function (state) {
            state.repoRoot = probeResult.isRepo ? root : null
            state.isRepo = probeResult.isRepo
            state.branch = probeResult.branch ?? ''
            state.error = null
            if (!probeResult.isRepo) {
              state.entries = []
              state.ahead = 0
              state.behind = 0
              state.diff = null
            }
          })
          if (!probeResult.isRepo) return
          await get().toRefresh()
        } catch (error) {
          console.error('[code] git sync failed', error)
          set(function (state) {
            state.repoRoot = null
            state.isRepo = false
            state.branch = ''
            state.entries = []
            state.ahead = 0
            state.behind = 0
            state.diff = null
            state.error = toMessage(error, '无法读取仓库信息')
          })
        }
      },

      async toInvalidateAndRefresh() {
        const root = get().repoRoot
        if (!root) return
        try {
          await WorkspaceGit.invalidate(root)
        } catch (error) {
          console.error('[code] git invalidate failed', error)
        }
        await get().toRefresh()
      },

      async toRefresh() {
        const root = get().repoRoot
        if (!root) return
        set(function (state) {
          state.isLoading = true
          state.error = null
        })
        try {
          const result = await WorkspaceGit.status(root)
          set(function (state) {
            state.branch = result.branch
            state.ahead = result.ahead
            state.behind = result.behind
            // unchanged：指纹/载荷未变，跳过替换避免 SCM 列表闪烁
            if (!result.unchanged) {
              state.entries = result.entries
            }
            state.isLoading = false
          })
        } catch (error) {
          console.error('[code] git status failed', error)
          set(function (state) {
            state.isLoading = false
            state.error = toMessage(error, '读取 Git 状态失败')
          })
        }
      },

      async toStage(paths) {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        try {
          const result = await WorkspaceGit.stage(root, paths)
          await get().toRefresh()
          return success(result.summary)
        } catch (error) {
          return reportFailure(error, '暂存失败')
        }
      },

      async toUnstage(paths) {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        try {
          const result = await WorkspaceGit.unstage(root, paths)
          await get().toRefresh()
          return success(result.summary)
        } catch (error) {
          return reportFailure(error, '取消暂存失败')
        }
      },

      async toDiscard(paths, isUntracked) {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        try {
          const result = await WorkspaceGit.discard(root, paths, isUntracked)
          await get().toRefresh()
          return success(result.summary)
        } catch (error) {
          return reportFailure(error, '撤销更改失败')
        }
      },

      async toCommit(message, isStageAll) {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        try {
          const result = await WorkspaceGit.commit(root, message, isStageAll)
          await get().toRefresh()
          return success(result.summary)
        } catch (error) {
          return reportFailure(error, '提交失败')
        }
      },

      async toFetch() {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        try {
          const result = await WorkspaceGit.fetchAll(root)
          await get().toRefresh()
          return success(result.summary)
        } catch (error) {
          return reportFailure(error, '获取远程更新失败')
        }
      },

      async toPull() {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        try {
          const result = await WorkspaceGit.pull(root)
          await get().toRefresh()
          return success(result.summary)
        } catch (error) {
          return reportFailure(error, '拉取失败')
        }
      },

      async toOpenDiff(relative) {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        set(function (state) {
          state.diff = {
            relative,
            mode: 'sideBySide',
            original: '',
            modified: '',
            isBinary: false,
            isLarge: false,
            isIdentical: false,
            isLoading: true,
            added: 0,
            deleted: 0,
            hunks: [],
            hunkTotal: 0,
            isHunksLoading: false,
            hasMoreHunks: false
          }
        })
        try {
          const meta = await WorkspaceGit.diffMeta(root, relative)
          if (get().diff?.relative !== relative) {
            return success('已切换到其他差异')
          }

          if (meta.isBinary || meta.isIdentical) {
            set(function (state) {
              state.diff = {
                relative,
                mode: meta.mode,
                original: '',
                modified: '',
                isBinary: meta.isBinary,
                isLarge: meta.isLarge,
                isIdentical: meta.isIdentical,
                isLoading: false,
                added: meta.added,
                deleted: meta.deleted,
                hunks: [],
                hunkTotal: 0,
                isHunksLoading: false,
                hasMoreHunks: false
              }
            })
            return success('已打开差异')
          }

          if (meta.mode === 'hunks') {
            set(function (state) {
              state.diff = {
                relative,
                mode: 'hunks',
                original: '',
                modified: '',
                isBinary: false,
                isLarge: true,
                isIdentical: false,
                isLoading: false,
                added: meta.added,
                deleted: meta.deleted,
                hunks: [],
                hunkTotal: meta.hunkCount,
                isHunksLoading: true,
                hasMoreHunks: true
              }
            })
            const page = await WorkspaceGit.diffHunks(root, relative, 0, HUNK_PAGE)
            if (get().diff?.relative !== relative) {
              return success('已切换到其他差异')
            }
            set(function (state) {
              if (!state.diff || state.diff.relative !== relative) return
              state.diff.hunks = page.hunks
              state.diff.hunkTotal = page.total
              state.diff.isHunksLoading = false
              state.diff.hasMoreHunks = page.hunks.length < page.total
            })
            return success('已打开差异')
          }

          const result = await WorkspaceGit.diff(root, relative)
          if (get().diff?.relative !== relative) {
            return success('已切换到其他差异')
          }
          set(function (state) {
            state.diff = {
              relative,
              mode: result.mode,
              original: result.original,
              modified: result.modified,
              isBinary: result.isBinary,
              isLarge: result.isLarge,
              isIdentical: result.isIdentical,
              isLoading: false,
              added: result.added,
              deleted: result.deleted,
              hunks: [],
              hunkTotal: 0,
              isHunksLoading: false,
              hasMoreHunks: false
            }
          })
          return success('已打开差异')
        } catch (error) {
          if (get().diff?.relative === relative) {
            set(function (state) {
              state.diff = null
            })
          }
          return reportFailure(error, '读取差异失败')
        }
      },

      async toLoadMoreHunks() {
        const root = get().repoRoot
        const diff = get().diff
        if (!root || !diff || diff.mode !== 'hunks' || !diff.hasMoreHunks || diff.isHunksLoading) {
          return
        }
        const relative = diff.relative
        const offset = diff.hunks.length
        set(function (state) {
          if (state.diff) state.diff.isHunksLoading = true
        })
        try {
          const page = await WorkspaceGit.diffHunks(root, relative, offset, HUNK_PAGE)
          if (get().diff?.relative !== relative) return
          set(function (state) {
            if (!state.diff || state.diff.relative !== relative) return
            state.diff.hunks = state.diff.hunks.concat(page.hunks)
            state.diff.hunkTotal = page.total
            state.diff.isHunksLoading = false
            state.diff.hasMoreHunks = state.diff.hunks.length < page.total
          })
        } catch (error) {
          console.error('[code] git diffHunks failed', error)
          set(function (state) {
            if (state.diff) state.diff.isHunksLoading = false
          })
        }
      },

      toCloseDiff() {
        set(function (state) {
          state.diff = null
        })
      }
    }
  })
)

export { useCodeGitStore }
export type { CodeGitState, GitDiff, GitOutcome }
