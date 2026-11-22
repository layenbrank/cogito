/**
 * 代码窗的源码管理状态：分支、变更列表、差异内容。
 *
 * 与 `stores/code.ts` 分开 —— 这里的状态全部来自 git 命令，不参与窗口 shell 持久化。
 */
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import { bumpWorkspaceRevision } from '@/features/agent/workspace/revision.ts'

import {
  WorkspaceGit,
  type CommitHit,
  type DiffHunk,
  type DiffMode,
  type DiffRevs,
  type SearchField,
  type ShowFile,
  type StashEntry,
  type StatusEntry,
  type WorktreeEntry
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
  /** 提交对比：父 oid（空串 = 空树）；缺省 = 工作区 */
  oldOid?: string
  /** 提交对比：目标 oid */
  newOid?: string
}

/** 动作结果：失败时由调用方决定提示方式 */
interface GitOutcome {
  ok: boolean
  message: string
}

/** 工作区根的仓库探测结果：仓库选择器据此只列出真仓库 */
interface RepoCandidate {
  path: string
  isRepo: boolean
}

/**
 * 换仓库 / 清空工作区时的统一重置：所有「跟着某个仓库根走」的视图态归零。
 *
 * 数组每次新建 —— 直接复用同一个字面量对象会让 immer draft 拿到共享引用，
 * 后续 `push` 会写回模块级常量。
 */
function createEmptyRepoView() {
  return {
    entries: [] as StatusEntry[],
    ahead: 0,
    behind: 0,
    diff: null as GitDiff | null,
    searchHits: [] as CommitHit[],
    selectedOid: null as string | null,
    commitFiles: [] as ShowFile[],
    searchError: null as string | null,
    showError: null as string | null,
    recentHits: [] as CommitHit[],
    branches: [] as string[],
    remoteBranches: [] as string[],
    operation: null as string | null,
    stashes: [] as StashEntry[],
    conflicted: [] as string[],
    worktrees: [] as WorktreeEntry[]
  }
}

interface CodeGitState {
  repoRoot: string | null
  /** 各工作区根的仓库探测结果（`toSyncWorkspace` 写入，仓库选择器消费） */
  repoCandidates: RepoCandidate[]
  isRepo: boolean
  branch: string
  ahead: number
  behind: number
  entries: StatusEntry[]
  isLoading: boolean
  error: string | null
  diff: GitDiff | null

  searchQuery: string
  searchField: SearchField
  searchHits: CommitHit[]
  searchHasMore: boolean
  searchHitScanCap: boolean
  isSearchLoading: boolean
  searchError: string | null
  selectedOid: string | null
  commitFiles: ShowFile[]
  isShowLoading: boolean
  showError: string | null
  /** SCM 侧栏线性历史（与搜索态隔离） */
  recentHits: CommitHit[]
  isRecentLoading: boolean
  /** 本地分支列表（切换器用） */
  branches: string[]
  /** 远端分支（`origin/feat`，不含 `origin/HEAD`） */
  remoteBranches: string[]
  isBranchesLoading: boolean
  isCheckoutBusy: boolean

  /** 进行中的多步操作（rebase / merge / cherry-pick …）；空闲为 null */
  operation: string | null
  /** 储藏列表（stash@{n}，0 最新） */
  stashes: StashEntry[]
  /** 冲突未解的文件（相对仓库根） */
  conflicted: string[]
  isStateLoading: boolean
  /** 工作树列表（`--porcelain`） */
  worktrees: WorktreeEntry[]
  isWorktreesLoading: boolean

  /** 工作区根集合变化时调用：探测每个根选出一个仓库，再按需读取状态 */
  toSyncWorkspace: (roots: readonly string[]) => Promise<void>
  /** 指向单个仓库根（仓库选择器 / 工作区同步共用）：切换时清空上一个仓库的视图态 */
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
  toOpenDiff: (relative: string, revs?: DiffRevs) => Promise<GitOutcome>
  toLoadMoreHunks: () => Promise<void>
  toCloseDiff: () => void
  toSetSearchQuery: (query: string) => void
  toSetSearchField: (field: SearchField) => void
  toSearchCommits: () => Promise<void>
  toLoadMoreSearch: () => Promise<void>
  toSelectCommit: (oid: string | null) => Promise<void>
  /** 侧栏最近提交列表 */
  toLoadRecentCommits: () => Promise<void>
  /** 聚焦某提交：清空筛选 → 最近列表 → 选中（必要时按 hash 回落） */
  toFocusCommit: (oid: string) => Promise<void>
  /** 拉取本地分支列表 */
  toLoadBranches: () => Promise<void>
  /** 切换分支：成功后刷新 status / 最近提交 / 搜索；`fromRemote` 用于从远端分支建跟踪分支 */
  toCheckoutBranch: (branch: string, fromRemote?: string | null) => Promise<GitOutcome>
  /** 读取多步操作态 + 储藏列表（面板挂载与每次写操作后调用） */
  toLoadState: () => Promise<void>
  toStashPush: (options: { message?: string; isIncludeUntracked?: boolean }) => Promise<GitOutcome>
  /** `isPop` 默认 true（应用后丢弃）；false = 只应用 */
  toStashApply: (index: number, isPop?: boolean) => Promise<GitOutcome>
  toStashDrop: (index: number) => Promise<GitOutcome>
  /** `upstream` 缺省 = 当前分支的上游 */
  toRebase: (upstream?: string | null) => Promise<GitOutcome>
  toRebaseContinue: () => Promise<GitOutcome>
  toRebaseAbort: () => Promise<GitOutcome>
  toLoadWorktrees: () => Promise<void>
  toAddWorktree: (options: {
    targetPath: string
    branch?: string
    isNewBranch?: boolean
  }) => Promise<GitOutcome>
  toRemoveWorktree: (targetPath: string, isForce?: boolean) => Promise<GitOutcome>
}

const RECENT_LIMIT = 25

function sameRevs(
  diff: GitDiff | null,
  relative: string,
  revs?: DiffRevs
): boolean {
  if (!diff || diff.relative !== relative) return false
  const oldOid = revs?.oldOid ?? undefined
  const newOid = revs?.newOid ?? undefined
  return diff.oldOid === oldOid && diff.newOid === newOid
}

function toDiffKey(revs?: DiffRevs): { oldOid?: string; newOid?: string } {
  if (!revs) return {}
  const result: { oldOid?: string; newOid?: string } = {}
  if (revs.oldOid !== undefined && revs.oldOid !== null) {
    result.oldOid = revs.oldOid
  }
  if (revs.newOid !== undefined && revs.newOid !== null) {
    result.newOid = revs.newOid
  }
  return result
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
      repoCandidates: [],
      isRepo: false,
      branch: '',
      ahead: 0,
      behind: 0,
      entries: [],
      isLoading: false,
      error: null,
      diff: null,
      searchQuery: '',
      searchField: 'all',
      searchHits: [],
      searchHasMore: false,
      searchHitScanCap: false,
      isSearchLoading: false,
      searchError: null,
      selectedOid: null,
      commitFiles: [],
      isShowLoading: false,
      showError: null,
      recentHits: [],
      isRecentLoading: false,
      branches: [],
      remoteBranches: [],
      isBranchesLoading: false,
      isCheckoutBusy: false,
      operation: null,
      stashes: [],
      conflicted: [],
      isStateLoading: false,
      worktrees: [],
      isWorktreesLoading: false,

      async toSyncWorkspace(roots) {
        const list = roots.filter(function (root) {
          return Boolean(root)
        })
        if (list.length === 0) {
          set(function (state) {
            state.repoCandidates = []
          })
          await get().toSync(null)
          return
        }

        // 逐根 probe（只读 `.git` 标记，很便宜）：SCM 只认真正是仓库的根
        const probes = await Promise.all(
          list.map(async function (path): Promise<RepoCandidate> {
            try {
              const result = await WorkspaceGit.GET_GIT_PROBE(path)
              return { path, isRepo: result.isRepo }
            } catch (error) {
              console.warn('[code] git probe failed', path, error)
              return { path, isRepo: false }
            }
          })
        )

        set(function (state) {
          state.repoCandidates = probes
        })

        const current = get().repoRoot
        const keepsCurrent = probes.some(function (item) {
          return item.path === current && item.isRepo
        })
        if (keepsCurrent) return

        const next = probes.find(function (item) {
          return item.isRepo
        })
        await get().toSync(next?.path ?? null)
      },

      async toSync(root) {
        if (!root) {
          set(function (state) {
            Object.assign(state, createEmptyRepoView())
            state.repoRoot = null
            state.isRepo = false
            state.branch = ''
            state.error = null
          })
          return
        }
        try {
          const probeResult = await WorkspaceGit.GET_GIT_PROBE(root)
          set(function (state) {
            const nextRoot = probeResult.isRepo ? root : null
            // 换仓库：上一个仓库的变更 / 提交 / 文件列表一律作废，否则会串味
            if (state.repoRoot !== nextRoot) Object.assign(state, createEmptyRepoView())
            state.repoRoot = nextRoot
            state.isRepo = probeResult.isRepo
            state.branch = probeResult.branch ?? ''
            state.error = null
          })
          if (!probeResult.isRepo) return
          await get().toRefresh()
          void get().toLoadRecentCommits()
          void get().toLoadBranches()
        } catch (error) {
          console.error('[code] git sync failed', error)
          set(function (state) {
            Object.assign(state, createEmptyRepoView())
            state.repoRoot = null
            state.isRepo = false
            state.branch = ''
            state.error = toMessage(error, '无法读取仓库信息')
          })
        }
      },

      async toInvalidateAndRefresh() {
        const root = get().repoRoot
        if (!root) return
        try {
          await WorkspaceGit.POST_GIT_INVALIDATE(root)
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
          const result = await WorkspaceGit.GET_GIT_STATUS(root)
          set(function (state) {
            state.branch = result.branch
            state.ahead = result.ahead
            state.behind = result.behind
            // unchanged：指纹/载荷未变时可跳过，避免 watch 抖动；但前端若已空/长度不一致仍须灌回
            // （HMR、重挂载、仅命中缓存时常见：result 有变更而 state.entries 仍是 []）
            const shouldReplace =
              !result.unchanged ||
              state.entries.length !== result.entries.length ||
              (state.entries.length === 0 && result.entries.length > 0)
            if (shouldReplace) {
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
          const result = await WorkspaceGit.PUT_GIT_STAGE(root, paths)
          await get().toRefresh()
          bumpWorkspaceRevision()
          return success(result.summary)
        } catch (error) {
          return reportFailure(error, '暂存失败')
        }
      },

      async toUnstage(paths) {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        try {
          const result = await WorkspaceGit.PUT_GIT_UNSTAGE(root, paths)
          await get().toRefresh()
          bumpWorkspaceRevision()
          return success(result.summary)
        } catch (error) {
          return reportFailure(error, '取消暂存失败')
        }
      },

      async toDiscard(paths, isUntracked) {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        try {
          const result = await WorkspaceGit.DELETE_GIT_CHANGES(root, paths, isUntracked)
          await get().toRefresh()
          bumpWorkspaceRevision()
          return success(result.summary)
        } catch (error) {
          return reportFailure(error, '撤销更改失败')
        }
      },

      async toCommit(message, isStageAll) {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        try {
          const result = await WorkspaceGit.POST_GIT_COMMIT(root, message, isStageAll)
          await get().toRefresh()
          void get().toLoadRecentCommits()
          bumpWorkspaceRevision()
          return success(result.summary)
        } catch (error) {
          return reportFailure(error, '提交失败')
        }
      },

      async toFetch() {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        try {
          const result = await WorkspaceGit.POST_GIT_FETCH(root)
          await get().toRefresh()
          bumpWorkspaceRevision()
          return success(result.summary)
        } catch (error) {
          return reportFailure(error, '获取远程更新失败')
        }
      },

      async toPull() {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        try {
          const result = await WorkspaceGit.POST_GIT_PULL(root)
          await get().toRefresh()
          void get().toLoadRecentCommits()
          bumpWorkspaceRevision()
          return success(result.summary)
        } catch (error) {
          return reportFailure(error, '拉取失败')
        }
      },

      async toOpenDiff(relative, revs) {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        const revKey = toDiffKey(revs)
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
            hasMoreHunks: false,
            ...revKey
          }
        })
        function stillActive() {
          return sameRevs(get().diff, relative, revs)
        }
        try {
          const meta = await WorkspaceGit.GET_GIT_DIFF_META(root, relative, revs)
          if (!stillActive()) {
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
                hasMoreHunks: false,
                ...revKey
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
                hasMoreHunks: true,
                ...revKey
              }
            })
            const page = await WorkspaceGit.GET_GIT_DIFF_HUNKS(root, relative, 0, HUNK_PAGE, revs)
            if (!stillActive()) {
              return success('已切换到其他差异')
            }
            set(function (state) {
              if (!sameRevs(state.diff, relative, revs)) return
              if (!state.diff) return
              state.diff.hunks = page.hunks
              state.diff.hunkTotal = page.total
              state.diff.isHunksLoading = false
              state.diff.hasMoreHunks = page.hunks.length < page.total
            })
            return success('已打开差异')
          }

          const result = await WorkspaceGit.GET_GIT_DIFF(root, relative, revs)
          if (!stillActive()) {
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
              hasMoreHunks: false,
              ...revKey
            }
          })
          return success('已打开差异')
        } catch (error) {
          if (stillActive()) {
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
        const revs: DiffRevs | undefined =
          diff.oldOid !== undefined || diff.newOid !== undefined
            ? { oldOid: diff.oldOid, newOid: diff.newOid }
            : undefined
        const offset = diff.hunks.length
        set(function (state) {
          if (state.diff) state.diff.isHunksLoading = true
        })
        try {
          const page = await WorkspaceGit.GET_GIT_DIFF_HUNKS(root, relative, offset, HUNK_PAGE, revs)
          if (!sameRevs(get().diff, relative, revs)) return
          set(function (state) {
            if (!sameRevs(state.diff, relative, revs) || !state.diff) return
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
      },

      toSetSearchQuery(query) {
        set(function (state) {
          state.searchQuery = query
        })
      },

      toSetSearchField(field) {
        set(function (state) {
          state.searchField = field
        })
      },

      async toSearchCommits() {
        const root = get().repoRoot
        if (!root) {
          set(function (state) {
            state.searchHits = []
            state.searchError = '当前工作区不是 Git 仓库'
            state.selectedOid = null
            state.commitFiles = []
          })
          return
        }
        const query = get().searchQuery
        const field = get().searchField
        set(function (state) {
          state.isSearchLoading = true
          state.searchError = null
        })
        try {
          const result = await WorkspaceGit.GET_GIT_SEARCH(root, { query, field, limit: 50 })
          set(function (state) {
            state.searchHits = result.commits
            state.searchHasMore = result.hasMore
            state.searchHitScanCap = result.hitScanCap
            state.isSearchLoading = false
            const stillSelected = result.commits.some(function (hit) {
              return hit.oid === state.selectedOid
            })
            if (!stillSelected) {
              state.selectedOid = null
              state.commitFiles = []
              state.showError = null
            }
          })
          const first = get().searchHits[0]
          if (first && !get().selectedOid) {
            await get().toSelectCommit(first.oid)
          }
        } catch (error) {
          console.error('[code] git search failed', error)
          set(function (state) {
            state.isSearchLoading = false
            state.searchError = toMessage(error, '搜索提交失败')
          })
        }
      },

      async toLoadMoreSearch() {
        const root = get().repoRoot
        const hits = get().searchHits
        if (!root || !get().searchHasMore || get().isSearchLoading || hits.length === 0) {
          return
        }
        const cursor = hits[hits.length - 1]?.oid
        if (!cursor) return
        set(function (state) {
          state.isSearchLoading = true
        })
        try {
          const result = await WorkspaceGit.GET_GIT_SEARCH(root, {
            query: get().searchQuery,
            field: get().searchField,
            limit: 50,
            cursor
          })
          set(function (state) {
            state.searchHits = state.searchHits.concat(result.commits)
            state.searchHasMore = result.hasMore
            state.searchHitScanCap = result.hitScanCap
            state.isSearchLoading = false
          })
        } catch (error) {
          console.error('[code] git search more failed', error)
          set(function (state) {
            state.isSearchLoading = false
            state.searchError = toMessage(error, '加载更多提交失败')
          })
        }
      },

      async toSelectCommit(oid) {
        if (!oid) {
          set(function (state) {
            state.selectedOid = null
            state.commitFiles = []
            state.showError = null
            state.isShowLoading = false
          })
          return
        }
        const root = get().repoRoot
        if (!root) return
        set(function (state) {
          state.selectedOid = oid
          state.isShowLoading = true
          state.showError = null
        })
        try {
          const result = await WorkspaceGit.GET_GIT_SHOW(root, oid)
          if (get().selectedOid !== oid) return
          set(function (state) {
            state.commitFiles = result.files
            state.isShowLoading = false
            // 补齐 parent：搜索命中里可能已有；show 为准
            const hit = state.searchHits.find(function (item) {
              return item.oid === oid
            })
            if (hit) {
              hit.parentOid = result.parentOid
            }
            const recent = state.recentHits.find(function (item) {
              return item.oid === oid
            })
            if (recent) {
              recent.parentOid = result.parentOid
            }
          })
        } catch (error) {
          console.error('[code] git show failed', error)
          if (get().selectedOid !== oid) return
          set(function (state) {
            state.commitFiles = []
            state.isShowLoading = false
            state.showError = toMessage(error, '读取提交变更失败')
          })
        }
      },

      async toLoadRecentCommits() {
        const root = get().repoRoot
        if (!root) {
          set(function (state) {
            state.recentHits = []
          })
          return
        }
        set(function (state) {
          state.isRecentLoading = true
        })
        try {
          const result = await WorkspaceGit.GET_GIT_SEARCH(root, {
            query: '',
            field: 'all',
            limit: RECENT_LIMIT
          })
          set(function (state) {
            state.recentHits = result.commits
            state.isRecentLoading = false
          })
        } catch (error) {
          console.error('[code] git recent commits failed', error)
          set(function (state) {
            state.isRecentLoading = false
          })
        }
      },

      async toFocusCommit(oid) {
        if (!oid) return
        // 先占位选中，避免 toSearchCommits 自动点到第一条抢焦点
        set(function (state) {
          state.searchQuery = ''
          state.searchField = 'all'
          state.selectedOid = oid
        })
        await get().toSearchCommits()
        const inList = get().searchHits.some(function (hit) {
          return hit.oid === oid
        })
        if (inList) {
          if (get().selectedOid !== oid || get().commitFiles.length === 0) {
            await get().toSelectCommit(oid)
          }
          return
        }
        set(function (state) {
          state.searchQuery = oid.slice(0, 12)
          state.searchField = 'hash'
          state.selectedOid = oid
        })
        await get().toSearchCommits()
        await get().toSelectCommit(oid)
      },

      async toLoadBranches() {
        const root = get().repoRoot
        if (!root) {
          set(function (state) {
            state.branches = []
            state.remoteBranches = []
            state.remoteBranches = []
          })
          return
        }
        set(function (state) {
          state.isBranchesLoading = true
        })
        try {
          const result = await WorkspaceGit.GET_GIT_BRANCHES(root)
          set(function (state) {
            state.branches = result.branches
            state.remoteBranches = result.remotes
            if (result.current) state.branch = result.current
            state.isBranchesLoading = false
          })
        } catch (error) {
          console.error('[code] git branches failed', error)
          set(function (state) {
            state.isBranchesLoading = false
          })
        }
      },

      async toCheckoutBranch(branchName, fromRemote) {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        if (!branchName.trim()) return { ok: false, message: '分支名无效' }
        if (!fromRemote && branchName === get().branch) {
          return success(`已在分支 ${branchName}`)
        }
        set(function (state) {
          state.isCheckoutBusy = true
        })
        try {
          const result = await WorkspaceGit.PUT_GIT_BRANCH(root, branchName, fromRemote)
          set(function (state) {
            state.branch = result.branch
            state.isCheckoutBusy = false
          })
          await get().toRefresh()
          void get().toLoadRecentCommits()
          void get().toLoadBranches()
          void get().toSearchCommits()
          bumpWorkspaceRevision()
          return success(`已切换到 ${result.branch}`)
        } catch (error) {
          set(function (state) {
            state.isCheckoutBusy = false
          })
          return reportFailure(error, `切换到分支 ${branchName} 失败`)
        }
      },

      async toLoadState() {
        const root = get().repoRoot
        if (!root) {
          set(function (state) {
            state.operation = null
            state.stashes = []
            state.conflicted = []
            state.isStateLoading = false
          })
          return
        }
        set(function (state) {
          state.isStateLoading = true
        })
        try {
          const result = await WorkspaceGit.GET_GIT_STATE(root)
          set(function (state) {
            state.operation = result.operation
            state.stashes = result.stashes
            state.conflicted = result.conflicted
            state.isStateLoading = false
          })
        } catch (error) {
          // 储藏列表读失败不该挡住面板：留痕后按空处理
          console.warn('[code] git state failed', error)
          set(function (state) {
            state.isStateLoading = false
          })
        }
      },

      async toStashPush(options) {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        try {
          const result = await WorkspaceGit.POST_GIT_STASH(root, options)
          await get().toInvalidateAndRefresh()
          void get().toLoadState()
          bumpWorkspaceRevision()
          return success(result.summary)
        } catch (error) {
          return reportFailure(error, '储藏失败')
        }
      },

      async toStashApply(index, isPop = true) {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        try {
          const result = await WorkspaceGit.PUT_GIT_STASH(root, index, isPop)
          await get().toInvalidateAndRefresh()
          void get().toLoadState()
          bumpWorkspaceRevision()
          return success(result.summary)
        } catch (error) {
          return reportFailure(error, isPop ? '弹出储藏失败' : '应用储藏失败')
        }
      },

      async toStashDrop(index) {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        try {
          const result = await WorkspaceGit.DELETE_GIT_STASH(root, index)
          void get().toLoadState()
          return success(result.summary)
        } catch (error) {
          return reportFailure(error, '删除储藏失败')
        }
      },

      async toRebase(upstream) {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        try {
          const result = await WorkspaceGit.POST_GIT_REBASE(root, upstream)
          await get().toInvalidateAndRefresh()
          void get().toLoadState()
          void get().toLoadRecentCommits()
          bumpWorkspaceRevision()
          return success(result.summary)
        } catch (error) {
          // 冲突时 git 的 stderr 已写明怎么继续，原样透出
          void get().toLoadState()
          return reportFailure(error, '变基失败')
        }
      },

      async toRebaseContinue() {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        try {
          const result = await WorkspaceGit.POST_GIT_REBASE_CONTINUE(root)
          await get().toInvalidateAndRefresh()
          void get().toLoadState()
          void get().toLoadRecentCommits()
          void get().toLoadBranches()
          bumpWorkspaceRevision()
          return success(result.summary)
        } catch (error) {
          void get().toLoadState()
          return reportFailure(error, '继续变基失败')
        }
      },

      async toRebaseAbort() {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        try {
          const result = await WorkspaceGit.DELETE_GIT_REBASE(root)
          await get().toInvalidateAndRefresh()
          void get().toLoadState()
          void get().toLoadRecentCommits()
          void get().toLoadBranches()
          bumpWorkspaceRevision()
          return success(result.summary)
        } catch (error) {
          void get().toLoadState()
          return reportFailure(error, '中止变基失败')
        }
      },

      async toLoadWorktrees() {
        const root = get().repoRoot
        if (!root) {
          set(function (state) {
            state.worktrees = []
            state.isWorktreesLoading = false
          })
          return
        }
        set(function (state) {
          state.isWorktreesLoading = true
        })
        try {
          const worktrees = await WorkspaceGit.GET_GIT_WORKTREES(root)
          set(function (state) {
            state.worktrees = worktrees
            state.isWorktreesLoading = false
          })
        } catch (error) {
          console.warn('[code] git worktree list failed', error)
          set(function (state) {
            state.isWorktreesLoading = false
          })
        }
      },

      async toAddWorktree(options) {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        try {
          const result = await WorkspaceGit.POST_GIT_WORKTREE(root, options)
          void get().toLoadWorktrees()
          return success(result.summary)
        } catch (error) {
          return reportFailure(error, '新建工作树失败')
        }
      },

      async toRemoveWorktree(targetPath, isForce = false) {
        const root = get().repoRoot
        if (!root) return { ok: false, message: '当前工作区不是 Git 仓库' }
        try {
          const result = await WorkspaceGit.DELETE_GIT_WORKTREE(root, targetPath, isForce)
          void get().toLoadWorktrees()
          return success(result.summary)
        } catch (error) {
          return reportFailure(error, '删除工作树失败')
        }
      }
    }
  })
)

export { useCodeGitStore }
export type { CodeGitState, GitDiff, GitOutcome }
