/**
 * Code 工作区 · 侧栏文件树入口（多根）。
 */
import { Button } from '@cogito/design/components/button'
import { useMemo } from 'react'
import { toast } from 'sonner'

import { useCodeStore } from '@/stores/code'
import { hint } from '@/views/code/lib/bindings.ts'
import { pickRootDirectory } from '@/views/code/lib/fs.ts'
import { findRelativePath, isPathInsideRoot } from '@/views/code/lib/path.ts'
import { switchWorkspace } from '@/views/code/lib/workspace-switch.ts'
import { ExplorerTree } from '@/views/code/workspace/overlay/explorer-tree.tsx'
import { makeTreeKey } from '@/views/code/workspace/overlay/explorer-tree-lib.ts'

function Navigation(props: { isVisible?: boolean }) {
  const roots = useCodeStore(function (state) {
    return state.roots
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
      if (!activeTab || roots.length === 0) return null
      const rootIndex = roots.findIndex(function (root) {
        return isPathInsideRoot(root, activeTab.path)
      })
      if (rootIndex < 0) return null
      const relative = findRelativePath(roots[rootIndex], activeTab.path)
      return relative ? makeTreeKey(rootIndex, relative) : makeTreeKey(rootIndex, '')
    },
    [tabs, activeTabId, roots]
  )

  if (roots.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-xs">
        <p>尚未打开文件夹</p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={function () {
              void (async function () {
                const root = await pickRootDirectory()
                if (!root) return
                switchWorkspace([root])
                useCodeStore.getState().toSetSidebarView('explorer')
                toast.success('已打开文件夹')
              })()
            }}>
            打开文件夹
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={function () {
              useCodeStore.getState().toSetWorkspaceSwitcherOpen(true)
            }}>
            切换工作区
          </Button>
        </div>
        <p className="opacity-70">{hint('CODE_OPEN_FOLDER', '打开文件夹')}</p>
      </div>
    )
  }

  return (
    <ExplorerTree
      roots={roots}
      activeKey={activeKey}
      isVisible={props.isVisible !== false}
    />
  )
}

export default Navigation
