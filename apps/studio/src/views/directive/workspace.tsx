import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef
} from '@cogito/design/components/resizable'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { useCorexStore } from '@/stores/corex'
import DirectiveUtility from '@/views/directive/components/utility'
import Editor from '@/views/directive/editor/editor'
import DirectiveList from '@/views/directive/list/directive-list'
import { RunDockPanel } from '@/views/directive/run/run-dock'
import { useRunDock } from '@/views/directive/run/use-run-dock'
import {
  EDITOR_ID,
  EDITOR_MIN,
  LIST_ID,
  LIST_MAX,
  LIST_MIN,
  LIST_SIZE,
  PAGE_GROUP_ID,
  STACK_GROUP_ID,
  WORKSPACE_ID,
  WORKSPACE_MIN,
  alignRunLayout,
  findSplitterState,
  writeSplitterLayout,
  writeSplitterOpen
} from './splitter'

/**
 * 编排台 `/directive/:name`：左列表、右工作区，工作区内上编辑下运行。
 *
 * 指令参数直接当路由参数用，名字对不上目录里的任何一条就是「待保存的新指令」草稿
 * （判据在编辑器里，这里不重复判断）。保存后 corex 可能把名字规范化，所以打开动作是
 * `replace` 一条新路由，不是往历史里再压一条。
 *
 * 运行台挂在工作区那一层而不是编辑器里：任务可以跨指令（起 A 的运行，切到 B 去看），
 * 挂在编辑器里一换指令就得跟着销毁。
 */
export default function DirectiveWorkspace() {
  const dock = useRunDock()
  const directives = useCorexStore(function (state) {
    return state.directives
  })
  const navigate = useNavigate()
  const params = useParams()
  const name = params.name ?? ''

  const listRef = usePanelRef()
  const [initial] = useState(findSplitterState)
  const [isListOpen, updateListOpen] = useState(initial.isListOpen)

  // 挂载时也走这条：`expand` 摊回上次宽度，收起是库自己的事
  useEffect(
    function () {
      const panel = listRef.current
      if (!panel) return
      if (isListOpen) panel.expand()
      else panel.collapse()
    },
    [isListOpen, listRef]
  )

  /** 开合只走它：本地状态与存档一起改，下次进编排台才还是收起/摊开的样子 */
  const setListOpen = useCallback(function (next: boolean) {
    updateListOpen(next)
    writeSplitterOpen({ isListOpen: next })
  }, [])

  /**
   * 换一条指令只重写当前这条历史：编排台里的切换（左栏点击、保存后名字被规范化）不算「去了别处」，
   * 从卡片墙进来的那一下才是压栈，返回键才有地方可回。
   */
  const handleOpen = useCallback(
    function (next: string) {
      void navigate('/directive/' + encodeURIComponent(next), { replace: true })
    },
    [navigate]
  )

  const handleToggleList = useCallback(
    function () {
      setListOpen(!isListOpen)
    },
    [isListOpen, setListOpen]
  )

  function handleListResize() {
    const nextOpen = !(listRef.current?.isCollapsed() ?? false)
    if (nextOpen === isListOpen) return
    setListOpen(nextOpen)
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <DirectiveUtility
        onOpenLibrary={function () {
          dock.updateLibraryOpen(true)
        }}
        onBack={function () {
          void navigate('/directive')
        }}
      />

      <ResizablePanelGroup
        id={PAGE_GROUP_ID}
        orientation="horizontal"
        className="min-h-0 flex-1"
        defaultLayout={initial.layouts[PAGE_GROUP_ID]}
        onLayoutChanged={function (layout, meta) {
          if (!meta.isUserInteraction) return
          writeSplitterLayout(PAGE_GROUP_ID, layout)
        }}>
        <ResizablePanel
          id={LIST_ID}
          panelRef={listRef}
          defaultSize={LIST_SIZE}
          minSize={LIST_MIN}
          maxSize={LIST_MAX}
          collapsible
          collapsedSize={0}
          groupResizeBehavior="preserve-pixel-size"
          onResize={handleListResize}
          className="min-h-0 min-w-0">
          <DirectiveList
            activeName={name || (directives[0]?.name ?? '')}
            runs={dock.runs}
            stepCounts={dock.stepCounts}
            onOpen={handleOpen}
            onRun={dock.quickRun}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel
          id={WORKSPACE_ID}
          minSize={WORKSPACE_MIN}
          className="flex h-full min-h-0 min-w-0 flex-col">
          <ResizablePanelGroup
            id={STACK_GROUP_ID}
            orientation="vertical"
            className="min-h-0 h-full flex-1"
            defaultLayout={alignRunLayout(initial.layouts[STACK_GROUP_ID], dock.isRunOpen)}
            onLayoutChanged={function (layout, meta) {
              if (!meta.isUserInteraction) return
              dock.releaseRunSizePin()
              writeSplitterLayout(STACK_GROUP_ID, layout)
            }}>
            <ResizablePanel
              id={EDITOR_ID}
              minSize={EDITOR_MIN}
              className="min-h-0">
              <Editor
                name={name}
                isListOpen={isListOpen}
                onOpen={handleOpen}
                onToggleList={handleToggleList}
                onRun={dock.startRun}
              />
            </ResizablePanel>

            <ResizableHandle withHandle />

            <RunDockPanel dock={dock} />
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
