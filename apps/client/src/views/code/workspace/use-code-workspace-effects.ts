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
import { openAbsolutePath, reloadFromDisk } from '@/views/code/lib/open-file.ts'
import { findRelativePath, isPathInsideRoot } from '@/views/code/lib/path.ts'

/** 依赖安装 / git 操作会制造海量事件，递归 watch 必须先过滤掉这些目录 */
const IGNORED_WATCH_SEGMENT = /[\\/](node_modules|\.git|dist|build|\.turbo)[\\/]/

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
      if (prefs.activePath && keep(prefs.activePath) && !paths.includes(prefs.activePath)) {
        paths.push(prefs.activePath)
      }
      await Promise.allSettled(
        paths.map(async function (path) {
          if (cancelled) return
          try {
            const ok = await exists(path)
            if (!ok) return
            await openAbsolutePath(path)
          } catch (error) {
            console.warn('[code] restore tab skipped', path, error)
          }
        })
      )
      if (cancelled) return
      if (cancelled || !prefs.activePath) return
      const next = useCodeStore.getState()
      const active = next.tabs.find(function (tab) {
        return tab.path === prefs.activePath
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

  // 多根 watch：每个根一个递归监听，事件合并去抖；忽略 node_modules / .git / dist
  useEffect(
    function () {
      if (roots.length === 0) return
      let disposed = false
      let debounceTimer = 0
      const unwatchers: (() => void)[] = []

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
        window.clearTimeout(debounceTimer)
        debounceTimer = window.setTimeout(function () {
          if (disposed) return
          toBumpTree()
          void useCodeGitStore.getState().toInvalidateAndRefresh()
        }, 350)
      }

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
        window.clearTimeout(debounceTimer)
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
