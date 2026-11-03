import {
  Splitter,
  SplitterHandle,
  SplitterPane
} from '@cogito/design/components/splitter'
import { clsx } from 'clsx'
import { useState } from 'react'

import { useCommands } from '@/keyboard/react'
import { useCodeStore } from '@/stores/code'
import { useSettingsStore } from '@/stores/setting'
import { hint } from '@/views/code/lib/bindings.ts'
import { CODE_COMMANDS } from '@/views/code/lib/commands.ts'
import { ActivityBar } from '@/views/code/workspace/activity-bar.tsx'
import { Breadcrumbs } from '@/views/code/workspace/breadcrumbs.tsx'
import { CloseConfirmDialog } from '@/views/code/workspace/close-confirm.tsx'
import { CommandPalette } from '@/views/code/workspace/command-palette.tsx'
import { DiffHost } from '@/views/code/workspace/diff-host.tsx'
import { EditorTabs } from '@/views/code/workspace/editor-tabs.tsx'
import { GitSearch } from '@/views/code/workspace/git-search.tsx'
import { MonacoHost } from '@/views/code/workspace/monaco-host.tsx'
import { BottomSurface } from '@/views/code/workspace/surface.tsx'
import { Sidebar } from '@/views/code/workspace/sidebar.tsx'
import { useCodeWorkspaceEffects } from '@/views/code/workspace/use-code-workspace-effects.ts'

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
  const roots = useCodeStore(function (state) {
    return state.roots
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
  const isDiffOpen = activeTab?.kind === 'diff'
  const isCommitsOpen = activeTab?.kind === 'commits'
  const isEditorHidden = isDiffOpen || isCommitsOpen
  const [isDiffHostReady, setDiffHostReady] = useState(false)
  if (isDiffOpen && !isDiffHostReady) {
    setDiffHostReady(true)
  }

  useSettingsStore(function (state) {
    return state.settings.shortcuts.bindings
  })

  useCodeWorkspaceEffects({
    workspaceRoot,
    roots,
    activeTab,
    isDiffOpen,
    isSurfaceOpen,
    toBumpTree
  })

  useCommands(CODE_COMMANDS)

  return (
    <div className={clsx([styles.code, styles.root])}>
      <CommandPalette />
      <CloseConfirmDialog />

      <Splitter
        id="code-workspace"
        orientation="vertical"
        className="min-h-0 flex-1">
        <SplitterPane
          id="code-workspace-main"
          defaultSize={isSurfaceOpen ? '72%' : '100%'}
          min="30%"
          className="min-h-0 overflow-hidden">
          <div className="flex h-full min-h-0">
            <ActivityBar />
            <Splitter
              id="code-editor-row"
              orientation="horizontal"
              className="min-h-0 min-w-0 flex-1">
              {isSidebarOpen ? (
                <>
                  <SplitterPane
                    id="code-sidebar"
                    defaultSize="18%"
                    min="12%"
                    max="40%"
                    className="min-h-0 min-w-0 overflow-hidden">
                    <Sidebar />
                  </SplitterPane>
                  <SplitterHandle withHandle />
                </>
              ) : null}
              <SplitterPane
                id="code-editor"
                className="min-h-0 min-w-0 overflow-hidden bg-background/92">
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
                    <MonacoHost
                      className={isEditorHidden ? 'hidden' : undefined}
                      isActive={!isEditorHidden}
                    />
                    {isDiffHostReady ? (
                      <DiffHost isOpen={isDiffOpen && !isCommitsOpen} />
                    ) : null}
                    {isCommitsOpen ? (
                      <div className="absolute inset-0 z-10 bg-background">
                        <GitSearch />
                      </div>
                    ) : null}
                  </div>
                </div>
              </SplitterPane>
            </Splitter>
          </div>
        </SplitterPane>

        {isSurfaceOpen ? (
          <>
            <SplitterHandle withHandle />
            <SplitterPane
              id="code-bottom-surface"
              defaultSize="28%"
              min="15%"
              max="60%"
              className="min-h-0 overflow-hidden">
              <BottomSurface />
            </SplitterPane>
          </>
        ) : null}
      </Splitter>
    </div>
  )
}
