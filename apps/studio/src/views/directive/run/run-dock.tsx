import { ResizablePanel } from '@cogito/design/components/resizable'

import ActionLibraryDialog from '@/views/directive/action-library'

import { RUN_COLLAPSED, RUN_ID, RUN_MAX, RUN_MIN } from '@/views/directive/splitter'
import RunPanel from './run-panel'
import type { RunDock } from './use-run-dock'

/**
 * 底部的运行台分栏：卡片墙与编排台共用形状与 UI 态（见 `run-dock-store`）。
 *
 * 尺寸档位、放下时的 48px、拖分栏后的状态对齐只写这一处；
 * 开合 / 选中 tab 也跨路由共享，避免墙 ↔ 编排台各记各的。
 *
 * 动作库弹框跟这块走：它由运行台那侧的按钮打开，本体是 portal，摆在面板里不影响分栏布局。
 * 默认收缩；展开到 `RUN_MAX`（百分比上限），窗口缩放时重新套回该占比。
 */

interface Props {
  dock: RunDock
}

function RunDockPanel(props: Props) {
  const { dock } = props

  return (
    <ResizablePanel
      id={RUN_ID}
      panelRef={dock.runRef}
      defaultSize={dock.isRunOpen ? RUN_MAX : RUN_COLLAPSED}
      minSize={RUN_MIN}
      maxSize={RUN_MAX}
      collapsible
      collapsedSize={RUN_COLLAPSED}
      onResize={dock.onRunResize}
      className="min-h-0 overflow-hidden">
      <RunPanel
        runs={dock.runs}
        stepCounts={dock.stepCounts}
        {...dock.runPanel}
      />
      <ActionLibraryDialog
        open={dock.isLibraryOpen}
        onOpenChange={dock.updateLibraryOpen}
      />
    </ResizablePanel>
  )
}

export { RunDockPanel }
