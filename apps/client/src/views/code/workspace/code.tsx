import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@cogito/design/components/resizable'
import { exists, watch } from '@tauri-apps/plugin-fs'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { useCommands } from '@/keyboard/react'
import { useCodeGitStore } from '@/stores/code-git'
import { useCodeStore } from '@/stores/code'
import { useSettingsStore } from '@/stores/setting'
import { useTerminalStore } from '@/stores/terminal'
import { hint } from '@/views/code/lib/bindings.ts'
import { CODE_COMMANDS } from '@/views/code/lib/commands.ts'
import { readCodeFile } from '@/views/code/lib/fs.ts'
import { disposeAllModels, findModel, findOrCreateModel } from '@/views/code/lib/monaco-models.ts'
import { openAbsolutePath } from '@/views/code/lib/open-file.ts'
import { ActivityBar } from '@/views/code/workspace/activity-bar.tsx'
import { Breadcrumbs } from '@/views/code/workspace/breadcrumbs.tsx'
import { CloseConfirmDialog } from '@/views/code/workspace/close-confirm.tsx'
import { CommandPalette } from '@/views/code/workspace/command-palette.tsx'
import { DiffHost } from '@/views/code/workspace/diff-host.tsx'
import { EditorTabs } from '@/views/code/workspace/editor-tabs.tsx'
import { MonacoHost } from '@/views/code/workspace/monaco-host.tsx'
import { BottomSurface } from '@/views/code/workspace/surface.tsx'
import { Sidebar } from '@/views/code/workspace/sidebar.tsx'

import styles from '@/views/code/workspace/code.module.scss'

export default function Code() {
  const isSidebarOpen = useCodeStore(function (state) {
    return state.isSidebarOpen
  })
  const isSurfaceOpen = useCodeStore(function (state) {
    return state.isSurfaceOpen
  })
  const workspaceRoot = useCodeStore(function (state) {
    return state.workspaceRoot
  })
  const toBumpTree = useCodeStore(function (state) {
    return state.toBumpTree
  })
  const activeTabId = useCodeStore(function (state) {
    return state.activeTabId
  })
  const tabs = useCodeStore(function (state) {
    return state.tabs
  })
  const activeTab = tabs.find(function (tab) {
    return tab.id === activeTabId
  })
  const diff = useCodeGitStore(function (state) {
    return state.diff
  })
  const isDiffOpen = Boolean(diff)
  // DiffEditor 创建/销毁很贵；第一次打开后常驻，关掉时只 hidden
  const [isDiffHostReady, setDiffHostReady] = useState(false)

  // 只为订阅覆盖值：用户改了键位，下面的空态提示要跟着变
  useSettingsStore(function (state) {
    return state.settings.shortcuts.bindings
  })

  useEffect(
    function () {
      if (isDiffOpen) setDiffHostReady(true)
    },
    [isDiffOpen]
  )

  useEffect(function () {
    return function () {
      disposeAllModels()
    }
  }, [])

  // 从 tiles.json 恢复工作区与上次打开的文件
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
      for (const path of paths) {
        if (cancelled) return
        try {
          const ok = await exists(path)
          if (!ok) continue
          await openAbsolutePath(path)
        } catch (error) {
          console.warn('[code] restore tab skipped', path, error)
        }
      }
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

  // 外部文件变更：脏则提示，否则静默重载（内容未变则跳过，避免自身保存触发跳动）
  useEffect(
    function () {
      if (!activeTab?.path) return
      let disposed = false
      let unwatch: (() => void) | undefined
      const watchedPath = activeTab.path
      void watch(
        watchedPath,
        function () {
          if (disposed) return
          const store = useCodeStore.getState()
          const tab = store.tabs.find(function (item) {
            return item.path === watchedPath
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
    [activeTab?.path]
  )

  // 工作区目录递归监听：资源管理器随磁盘创建/删除/重命名刷新
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
            // watch 只作失效信号：invalidate → refresh；unchanged 时前端不抖列表
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

  // 与资源管理器同一 workspaceRoot：打开/切换工作区即探测 Git（角标不依赖 SCM 面板挂载）
  useEffect(
    function () {
      void useCodeGitStore.getState().toSync(workspaceRoot)
    },
    [workspaceRoot]
  )

  // 键位与命令的对应关系全在 `keyboard/definitions.ts`；没挂载这里时，
  // 这些命令不会出现在命令面板里，对应键位也不会被派发器认领。
  useCommands(CODE_COMMANDS)

  // 打开终端面板时若无 tab，自动新建
  useEffect(
    function () {
      if (!isSurfaceOpen) return
      const store = useCodeStore.getState()
      if (store.surfaceTab !== 'terminal') return
      const root = store.workspaceRoot
      if (!root) return
      if (useTerminalStore.getState().tabs.length === 0) {
        useTerminalStore.getState().newTab(root)
      }
    },
    [isSurfaceOpen]
  )

  return (
    <div className={clsx([styles.code, styles.root])}>
      <CommandPalette />
      <CloseConfirmDialog />

      <ResizablePanelGroup
        orientation="vertical"
        className="min-h-0 flex-1">
        <ResizablePanel
          defaultSize={isSurfaceOpen ? '72%' : '100%'}
          minSize="30%"
          className="min-h-0 overflow-hidden">
          <div className="flex h-full min-h-0">
            <ActivityBar />
            <ResizablePanelGroup
              orientation="horizontal"
              className="min-h-0 min-w-0 flex-1">
              {isSidebarOpen ? (
                <>
                  <ResizablePanel
                    defaultSize="18%"
                    minSize="12%"
                    maxSize="40%"
                    className="min-h-0 min-w-0 overflow-hidden">
                    <Sidebar />
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                </>
              ) : null}
              <ResizablePanel className="min-h-0 min-w-0 overflow-hidden bg-background/92">
                <div className="flex h-full min-h-0 flex-col">
                  <EditorTabs />
                  <Breadcrumbs />
                  <div className="relative min-h-0 flex-1">
                    {tabs.length === 0 ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 px-6 text-center text-sm text-muted-foreground backdrop-blur-sm">
                        <p className="text-foreground/80">
                          从左侧打开文件，或按 {hint('CODE_PALETTE_FILES', '转到文件')} /{' '}
                          {hint('CODE_PALETTE_COMMANDS', '命令面板')}
                        </p>
                        <p className="text-xs opacity-80">
                          {hint('CODE_TOGGLE_SIDEBAR', '侧栏')} ·{' '}
                          {hint('CODE_OPEN_FOLDER', '打开文件夹')} · {hint('CODE_TERMINAL', '终端')}
                        </p>
                      </div>
                    ) : null}
                    {/*
                      差异层盖在编辑器上时，必须把底层 Monaco 从布局里拿掉。
                      否则底层小地图仍可被点到，两边 automaticLayout 互相挤，顶栏边框会闪。
                    */}
                    <MonacoHost
                      className={isDiffOpen ? 'hidden' : undefined}
                      isActive={!isDiffOpen}
                    />
                    {isDiffHostReady ? <DiffHost isOpen={isDiffOpen} /> : null}
                  </div>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </ResizablePanel>

        {isSurfaceOpen ? (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel
              defaultSize="28%"
              minSize="15%"
              maxSize="60%"
              className="min-h-0 overflow-hidden">
              <BottomSurface />
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
    </div>
  )
}
