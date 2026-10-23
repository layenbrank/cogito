import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@cogito/design/components/resizable'
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import DirectiveUtility from '@/views/directive/components/utility'
import DirectiveWall from '@/views/directive/list/directive-wall'
import { RunDockPanel } from '@/views/directive/run/run-dock'
import { useRunDock } from '@/views/directive/run/use-run-dock'
import {
  WALL_GROUP_ID,
  WALL_ID,
  WALL_MIN,
  alignRunLayout,
  findSplitterState,
  writeSplitterLayout
} from './splitter'

/**
 * 指令页的正脸：卡片墙 + 底部运行台。进来先看到所有指令与它们最近跑成什么样，
 * 点某张卡片才去编排台（`/directive/:name`）改它。
 *
 * 运行台挂在页面这一层而不是卡片墙上：卡片墙只负责「挑一条」，起完运行还是呆在原地看结果；
 * 换页面时它跟着卸载，运行本身在宿主进程里继续跑。
 */
export default function Directive() {
  const dock = useRunDock()
  const navigate = useNavigate()
  const [initial] = useState(findSplitterState)

  const handleOpen = useCallback(
    function (name: string) {
      void navigate('/directive/' + encodeURIComponent(name))
    },
    [navigate]
  )

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <DirectiveUtility
        onOpenLibrary={function () {
          dock.updateLibraryOpen(true)
        }}
      />

      <ResizablePanelGroup
        id={WALL_GROUP_ID}
        orientation="vertical"
        className="min-h-0 flex-1"
        defaultLayout={alignRunLayout(initial.layouts[WALL_GROUP_ID], dock.isRunOpen)}
        onLayoutChanged={function (layout, meta) {
          // 程序化 expand/collapse 也会改 layout；只在用户拖拽时落盘，避免开合同步打 localStorage
          if (!meta.isUserInteraction) return
          dock.releaseRunSizePin()
          writeSplitterLayout(WALL_GROUP_ID, layout)
        }}>
        <ResizablePanel
          id={WALL_ID}
          minSize={WALL_MIN}
          className="min-h-0 overflow-hidden [contain:layout]">
          <DirectiveWall
            stepCounts={dock.stepCounts}
            onOpen={handleOpen}
            onRun={dock.quickRun}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <RunDockPanel dock={dock} />
      </ResizablePanelGroup>
    </div>
  )
}
