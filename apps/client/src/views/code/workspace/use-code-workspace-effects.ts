import { exists, watch } from '@tauri-apps/plugin-fs'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { subscribeWorkspaceRevision } from '@/features/agent/workspace/revision.ts'
import { useCodeGitStore } from '@/stores/code-git'
import { useCodeStore } from '@/stores/code'
import { bootstrapTerminalSessions } from '@/features/terminal/agent-tabs'
import { useTerminalStore } from '@/stores/terminal'
import { readCodeFile } from '@/views/code/lib/fs.ts'
import { requestCloseTabs } from '@/views/code/lib/close-tabs.ts'
import { disposeAllModels, findModel } from '@/views/code/lib/monaco-models.ts'
import { resetWorkspaceTypescriptLibs } from '@/views/code/lib/monaco-types.ts'
import { clearViewStates } from '@/views/code/lib/monaco-view-state.ts'
import {
  openAbsolutePath,
  registerTabWithoutContent,
  reloadFromDisk
} from '@/views/code/lib/open-file.ts'
import { findRelativePath, isPathInsideRoot, isSamePath } from '@/views/code/lib/path.ts'

/** 依赖安装 / git 操作会制造海量事件，递归 watch 必须先过滤掉这些目录 */
const IGNORED_WATCH_SEGMENT = /[\\/](node_modules|\.git|dist|build|\.turbo)[\\/]/

/** 文件树刷新节流：树只做轻量重建，250ms 足够 */
const TREE_BUMP_DELAY_MS = 250
/** git status 是子进程 + 全仓扫描，比树贵一个量级，单独一条更慢的链 */
const GIT_REFRESH_DELAY_MS = 1200

function useCodeWorkspaceEffects(input: {
  workspaceRoot: string | null
  roots: string[]
  activeTab:
    | {
        id: string
        kind: string
        path?: string
        baseOid?: string
        headOid?: string
      }
    | undefined
  isDiffOpen: boolean
  isSurfaceOpen: boolean
  toBumpTree: () => void
}) {
  const { workspaceRoot, roots, activeTab, isDiffOpen, isSurfaceOpen, toBumpTree } = input
  const rootsKey = roots.join('|')

  useEffect(function () {
    return function () {
      disposeAllModels()
      clearViewStates()
      resetWorkspaceTypescriptLibs()
    }
  }, [])

  useEffect(function () {
    let cancelled = false
    void (async function () {
      const store = useCodeStore.getState()
      if (store.tabs.length > 0 || store.workspaceRoot) return
      const prefs = await store.hydrateFromStore()
      if (cancelled) return
      // 只恢复仍落在某个工作区根下的标签：切过项目后不要把旧项目的文件拉回来
      const rootList = prefs.workspaceRoots
      function keep(path: string): boolean {
        return (
          rootList.length === 0 ||
          rootList.some(function (root) {
            return isPathInsideRoot(root, path)
          })
        )
      }
      const paths = prefs.tabPaths.filter(keep)
      const activePath = prefs.activePath && keep(prefs.activePath) ? prefs.activePath : null
      if (activePath && !paths.includes(activePath)) paths.push(activePath)

      // 首屏只读 active tab 的全文：其余只登记标签，正文等激活时惰性读
      for (const path of paths) {
        if (cancelled) return
        if (activePath !== null && isSamePath(path, activePath)) continue
        try {
          if (!(await exists(path))) continue
          registerTabWithoutContent(path)
        } catch (error) {
          console.warn('[code] restore tab skipped', path, error)
        }
      }
      if (cancelled) return
      if (activePath === null) return
      try {
        if (await exists(activePath)) await openAbsolutePath(activePath)
      } catch (error) {
        console.warn('[code] restore active tab skipped', activePath, error)
      }
      if (cancelled) return
      const next = useCodeStore.getState()
      const active = next.tabs.find(function (tab) {
        return tab.path === activePath
      })
      if (active) next.toActivateTab(active.id)
    })()
    return function () {
      cancelled = true
    }
  }, [])

  useEffect(
    function () {
      if (!activeTab?.path || activeTab.kind !== 'file') return
      let disposed = false
      let unwatch: (() => void) | undefined
      const watchedPath = activeTab.path
      void watch(
        watchedPath,
        function () {
          if (disposed) return
          const store = useCodeStore.getState()
          const tab = store.tabs.find(function (item) {
            return item.kind === 'file' && item.path === watchedPath
          })
          if (!tab) return
          void readCodeFile(tab.path)
            .then(function (content) {
              if (disposed) return
              if (tab.isDirty) {
                const existing = findModel(tab.path)
                if (existing && existing.getValue() === content) return
                toast.message('磁盘上的文件已更改', {
                  description: tab.title,
                  action: {
                    label: '重新加载',
                    onClick: function () {
                      void reloadFromDisk(tab.path).catch(function (error: unknown) {
                        console.error('[code] reload failed', error)
                      })
                    }
                  }
                })
                return
              }
              void reloadFromDisk(tab.path).catch(function () {
                /* 文件可能已被删除；树 watch 会刷新 */
              })
            })
            .catch(function () {
              /* 文件可能已被删除；树 watch 会刷新 */
            })
        },
        { delayMs: 400 }
      )
        .then(function (fn) {
          if (disposed) {
            fn()
            return
          }
          unwatch = fn
        })
        .catch(function () {
          /* Command watch not found — 当前壳未启用 fs watch */
        })
      return function () {
        disposed = true
        unwatch?.()
      }
    },
    [activeTab?.kind, activeTab?.path]
  )

  /**
   * 多根递归 watch。
   *
   * 树刷新与 git 刷新是**两条独立节流链**：一次保存只重建一次文件树（250ms），
   * 而 `git status` 是子进程 + 全仓扫描，慢一档（1200ms）且窗口不可见时只置脏标记，
   * 回前台补一次 —— 否则「保存一次 → 两枪全量工作」会把主线程钉住。
   */
  useEffect(
    function () {
      if (roots.length === 0) return
      let disposed = false
      let treeTimer = 0
      let gitTimer = 0
      let isTreePending = false
      let isGitPending = false
      let isGitDirty = false
      const unwatchers: (() => void)[] = []

      function flushGit() {
        gitTimer = 0
        isGitPending = false
        if (disposed) return
        if (document.hidden) {
          // 不可见时不做全仓扫描，等 visibilitychange 补
          isGitDirty = true
          return
        }
        isGitDirty = false
        void useCodeGitStore.getState().toInvalidateAndRefresh()
      }

      /** 树 bump 幂等合流：窗口期内的后续事件不再排队，只等这一次落地 */
      function scheduleTreeBump() {
        if (isTreePending) return
        isTreePending = true
        treeTimer = window.setTimeout(function () {
          treeTimer = 0
          isTreePending = false
          if (disposed) return
          toBumpTree()
        }, TREE_BUMP_DELAY_MS)
      }

      function scheduleGitRefresh() {
        if (isGitPending) return
        isGitPending = true
        gitTimer = window.setTimeout(flushGit, GIT_REFRESH_DELAY_MS)
      }

      function onFsEvent(event: { paths?: string[] }) {
        if (disposed) return
        const paths = event.paths ?? []
        if (
          paths.length > 0 &&
          paths.every(function (path) {
            return IGNORED_WATCH_SEGMENT.test(path)
          })
        ) {
          return
        }
        scheduleTreeBump()
        scheduleGitRefresh()
      }

      function onVisibilityChange() {
        if (document.hidden || !isGitDirty) return
        isGitDirty = false
        void useCodeGitStore.getState().toInvalidateAndRefresh()
      }

      document.addEventListener('visibilitychange', onVisibilityChange)

      for (const root of roots) {
        void watch(root, onFsEvent, { recursive: true, delayMs: 500 })
          .then(function (fn) {
            if (disposed) {
              fn()
              return
            }
            unwatchers.push(fn)
          })
          .catch(function () {
            /* Command watch not found — 当前壳未启用 fs watch */
          })
      }

      return function () {
        disposed = true
        window.clearTimeout(treeTimer)
        window.clearTimeout(gitTimer)
        document.removeEventListener('visibilitychange', onVisibilityChange)
        for (const unwatch of unwatchers) unwatch()
      }
    },
    // rootsKey 做稳定依赖；roots 一并列出，避免闭包读到旧的根集合
    [roots, rootsKey, toBumpTree]
  )

  useEffect(
    function () {
      void useCodeGitStore.getState().toSync(workspaceRoot)
    },
    [workspaceRoot]
  )

  // Agent 面板里切分支 / 拉取 / 提交后也广播 revision：代码窗跟着重读，
  // 否则左右两边会各看各的分支快照。
  useEffect(
    function () {
      if (!workspaceRoot) return
      return subscribeWorkspaceRevision(function () {
        void useCodeGitStore.getState().toInvalidateAndRefresh()
      })
    },
    [workspaceRoot]
  )

  useEffect(
    function () {
      if (!isDiffOpen || !activeTab || !workspaceRoot) {
        if (!isDiffOpen) {
          useCodeGitStore.getState().toCloseDiff()
        }
        return
      }
      const relative = findRelativePath(workspaceRoot, activeTab.path!)
      const revs =
        typeof activeTab.headOid === 'string' && activeTab.headOid.length > 0
          ? {
              oldOid: activeTab.baseOid ?? '',
              newOid: activeTab.headOid
            }
          : undefined
      const current = useCodeGitStore.getState().diff
      const sameRev =
        current &&
        current.relative === relative &&
        current.oldOid === revs?.oldOid &&
        current.newOid === revs?.newOid
      if (sameRev && !current.isLoading) return
      void useCodeGitStore
        .getState()
        .toOpenDiff(relative, revs)
        .then(function (outcome) {
          if (!outcome.ok) toast.error(outcome.message)
        })
    },
    // 依赖整个 activeTab：effect 里判空需要对象本身；内部有 sameRev 短路，重跑代价很小
    [isDiffOpen, activeTab, workspaceRoot]
  )

  useEffect(
    function () {
      if (!isDiffOpen || !activeTab) return
      const tabId = activeTab.id
      function onKeyDown(event: KeyboardEvent) {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.preventDefault()
        requestCloseTabs([tabId])
      }
      window.addEventListener('keydown', onKeyDown)
      return function () {
        window.removeEventListener('keydown', onKeyDown)
      }
    },
    [isDiffOpen, activeTab]
  )

  useEffect(
    function () {
      if (!isSurfaceOpen) return
      const store = useCodeStore.getState()
      if (store.surfaceTab !== 'terminal') return
      const root = store.workspaceRoot
      if (!root) return
      void (async function () {
        await bootstrapTerminalSessions()
        const terminal = useTerminalStore.getState()
        if (terminal.tabs.length > 0) {
          if (!terminal.activeId) terminal.writeActive(terminal.tabs[0].id)
          return
        }
        terminal.newTab(root)
      })()
    },
    [isSurfaceOpen]
  )
}

export { useCodeWorkspaceEffects }
