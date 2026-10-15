import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@i-thinking/design/components/resizable'
import { watch } from '@tauri-apps/plugin-fs'
import { clsx } from 'clsx'
import { useEffect } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { toast } from 'sonner'

import { useCodeStore } from '@/stores/code'
import { useTerminalStore } from '@/stores/terminal'
import {
  closeActiveTab,
  openFolderDialog,
  saveActiveTab,
  toggleTerminal
} from '@/views/code/lib/commands.ts'
import { readCodeFile } from '@/views/code/lib/fs.ts'
import { disposeAllModels, findOrCreateModel } from '@/views/code/lib/monaco-models.ts'
import { ActivityBar } from '@/views/code/workspace/activity-bar.tsx'
import { CommandPalette } from '@/views/code/workspace/command-palette.tsx'
import { Breadcrumbs } from '@/views/code/workspace/breadcrumbs.tsx'
import { EditorTabs } from '@/views/code/workspace/editor-tabs.tsx'
import { MonacoHost } from '@/views/code/workspace/monaco-host.tsx'
import { Panel } from '@/views/code/workspace/panel.tsx'
import { Sidebar } from '@/views/code/workspace/sidebar.tsx'

import styles from '@/views/code/workspace/code.module.scss'

export default function Code() {
  const isSidebarOpen = useCodeStore(function (state) {
    return state.isSidebarOpen
  })
  const isPanelOpen = useCodeStore(function (state) {
    return state.isPanelOpen
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

  useEffect(function () {
    return function () {
      disposeAllModels()
    }
  }, [])

  // 外部文件变更：脏则提示，否则静默重载
  useEffect(
    function () {
      if (!activeTab?.path) return
      let disposed = false
      let unwatch: (() => void) | undefined
      void watch(
        activeTab.path,
        function () {
          if (disposed) return
          const store = useCodeStore.getState()
          const tab = store.tabs.find(function (item) {
            return item.path === activeTab.path
          })
          if (!tab) return
          if (tab.isDirty) {
            toast.message('磁盘上的文件已更改', {
              description: tab.title,
              action: {
                label: '重新加载',
                onClick: function () {
                  void readCodeFile(tab.path).then(function (content) {
                    findOrCreateModel(tab.path, content)
                    store.toMarkDirty(tab.id, false)
                  })
                }
              }
            })
            return
          }
          void readCodeFile(tab.path).then(function (content) {
            findOrCreateModel(tab.path, content)
          })
        },
        { delayMs: 400 }
      ).then(function (fn) {
        unwatch = fn
      })
      return function () {
        disposed = true
        unwatch?.()
      }
    },
    [activeTab?.path]
  )

  useHotkeys(
    'mod+shift+p',
    function (event) {
      event.preventDefault()
      useCodeStore.getState().toSetPaletteMode('command')
    },
    { enableOnFormTags: true }
  )

  useHotkeys(
    'mod+p',
    function (event) {
      event.preventDefault()
      useCodeStore.getState().toSetPaletteMode('file')
    },
    { enableOnFormTags: true }
  )

  useHotkeys(
    'mod+s',
    function (event) {
      event.preventDefault()
      void saveActiveTab()
    },
    { enableOnFormTags: true }
  )

  useHotkeys(
    'mod+`',
    function (event) {
      event.preventDefault()
      toggleTerminal()
    },
    { enableOnFormTags: true }
  )

  useHotkeys(
    'mod+w',
    function (event) {
      event.preventDefault()
      closeActiveTab()
    },
    { enableOnFormTags: true }
  )

  useHotkeys(
    'mod+o',
    function (event) {
      event.preventDefault()
      void openFolderDialog()
    },
    { enableOnFormTags: true }
  )

  useHotkeys(
    'mod+b',
    function (event) {
      event.preventDefault()
      useCodeStore.getState().toToggleSidebar()
    },
    { enableOnFormTags: true }
  )

  // 打开终端面板时若无 tab，自动新建
  useEffect(
    function () {
      if (!isPanelOpen) return
      const store = useCodeStore.getState()
      if (store.panelTab !== 'terminal') return
      const root = store.workspaceRoot
      if (!root) return
      if (useTerminalStore.getState().tabs.length === 0) {
        useTerminalStore.getState().newTab(root)
      }
    },
    [isPanelOpen]
  )

  return (
    <div className={clsx([styles.code, styles.root])}>
      <CommandPalette />

      <ResizablePanelGroup
        orientation="vertical"
        className="min-h-0 flex-1">
        <ResizablePanel
          defaultSize={isPanelOpen ? '72%' : '100%'}
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
                        <p className="text-foreground/80">从左侧打开文件，或按 Ctrl+P / Ctrl+Shift+P</p>
                        <p className="text-xs opacity-80">
                          Ctrl+B 侧栏 · Ctrl+O 打开文件夹 · Ctrl+` 终端
                        </p>
                      </div>
                    ) : null}
                    <MonacoHost />
                  </div>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </ResizablePanel>

        {isPanelOpen ? (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel
              defaultSize="28%"
              minSize="15%"
              maxSize="60%"
              className="min-h-0 overflow-hidden">
              <Panel />
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
    </div>
  )
}
