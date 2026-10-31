/**
 * Code 工作区 · 侧栏文件树：右键菜单对齐 VS Code Explorer 常用项。
 */
import { Button } from '@cogito/design/components/button'
import { useMemo } from 'react'
import { toast } from 'sonner'

import { useCodeStore } from '@/stores/code'
import { hint } from '@/views/code/lib/bindings.ts'
import { pickRootDirectory } from '@/views/code/lib/fs.ts'
import { findRelativePath } from '@/views/code/lib/path.ts'
import { ExplorerTree } from '@/views/code/workspace/overlay/explorer-tree.tsx'

function Navigation() {
  const workspaceRoot = useCodeStore(function (state) {
    return state.workspaceRoot
  })
  const tabs = useCodeStore(function (state) {
    return state.tabs
  })
  const activeTabId = useCodeStore(function (state) {
    return state.activeTabId
  })

  const activeKey = useMemo(
    function () {
      const activeTab = tabs.find(function (tab) {
        return tab.id === activeTabId
      })
      if (!activeTab || !workspaceRoot) return null
      return findRelativePath(workspaceRoot, activeTab.path) || null
    },
    [tabs, activeTabId, workspaceRoot]
  )

  if (!workspaceRoot) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-xs">
        <p>尚未打开文件夹</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={function () {
            void (async function () {
              const root = await pickRootDirectory()
              if (!root) return
              useCodeStore.getState().toSetWorkspaceRoot(root)
              useCodeStore.getState().toBumpTree()
              useCodeStore.getState().toSetSidebarView('explorer')
              toast.success('已打开文件夹')
            })()
          }}>
          打开文件夹
        </Button>
        <p className="opacity-70">{hint('CODE_OPEN_FOLDER', '打开文件夹')}</p>
      </div>
    )
  }

  return (
    <ExplorerTree
      workspaceRoot={workspaceRoot}
      activeKey={activeKey}
    />
  )
}

export default Navigation
