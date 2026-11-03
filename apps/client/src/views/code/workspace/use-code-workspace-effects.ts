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
import { disposeAllModels, findModel, findOrCreateModel } from '@/views/code/lib/monaco-models.ts'
import { resetWorkspaceTypescriptLibs } from '@/views/code/lib/monaco-types.ts'
import { clearViewStates } from '@/views/code/lib/monaco-view-state.ts'
import { openAbsolutePath } from '@/views/code/lib/open-file.ts'
import { findRelativePath } from '@/views/code/lib/path.ts'

function useCodeWorkspaceEffects(input: {
  workspaceRoot: string | null
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
  const { workspaceRoot, activeTab, isDiffOpen, isSurfaceOpen, toBumpTree } = input

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
      const paths = prefs.tabPaths.slice()
      if (prefs.activePath && !paths.includes(prefs.activePath)) {
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
                      void readCodeFile(tab.path).then(function (next) {
                        findOrCreateModel(tab.path, next)
                        store.toMarkDirty(tab.id, false)
                      })
                    }
                  }
                })
                return
              }
              findOrCreateModel(tab.path, content)
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

  useEffect(
    function () {
      if (!workspaceRoot) return
      let disposed = false
      let unwatch: (() => void) | undefined
      let debounceTimer = 0
      void watch(
        workspaceRoot,
        function () {
          if (disposed) return
          window.clearTimeout(debounceTimer)
          debounceTimer = window.setTimeout(function () {
            if (disposed) return
            toBumpTree()
            void useCodeGitStore.getState().toInvalidateAndRefresh()
          }, 350)
        },
        { recursive: true, delayMs: 500 }
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
        window.clearTimeout(debounceTimer)
        unwatch?.()
      }
    },
    [workspaceRoot, toBumpTree]
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
