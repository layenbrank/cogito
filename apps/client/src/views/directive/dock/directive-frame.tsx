/**
 * Decorations 内容区内的主区 + 底栏：高度吃满 Caption 以下剩余空间，
 * 底栏展开不会把窗口操作栏顶出视口。
 * 整层铺 `bg-background` 实底：窗壳透明 + mica 时，工作区不透壁纸。
 */
import { useEffect, type ReactNode } from 'react'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@cogito/design/components/resizable'

import { useTerminalStore } from '@/stores/terminal'
import { DirectiveDock } from '@/views/directive/dock/directive-dock.tsx'
import { useTerminalCwd } from '@/views/directive/use-terminal-cwd.ts'

interface DirectiveFrameProps {
  children: ReactNode
}

function DirectiveFrame(props: DirectiveFrameProps) {
  const terminalOpen = useTerminalStore(function (state) {
    return state.open
  })
  const activity = useTerminalStore(function (state) {
    return state.activity
  })
  const { cwd, emptyCwdMessage } = useTerminalCwd()

  useEffect(
    function () {
      if (!terminalOpen || activity !== 'terminal' || !cwd) return
      const store = useTerminalStore.getState()
      if (store.tabs.length > 0) return
      store.newTab(cwd, { reveal: false })
    },
    [terminalOpen, activity, cwd]
  )

  return (
    <ResizablePanelGroup
      orientation="vertical"
      className="h-full min-h-0 w-full flex-1 overflow-hidden bg-background">
      <ResizablePanel
        defaultSize={terminalOpen ? '68%' : '100%'}
        minSize={180}
        className="min-h-0 overflow-hidden bg-background">
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
          {props.children}
        </div>
      </ResizablePanel>
      {terminalOpen ? (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize="32%"
            minSize={140}
            maxSize="55%"
            className="min-h-0 overflow-hidden border-t border-border bg-background">
            <DirectiveDock
              cwd={cwd}
              emptyCwdMessage={emptyCwdMessage}
            />
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  )
}

export { DirectiveFrame }
