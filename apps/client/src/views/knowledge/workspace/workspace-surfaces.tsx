import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@cogito/design/components/resizable'
import type { Editor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'

import type { useKnowledgeStore } from '@/stores/knowledge'
import { FindBar } from '@/views/knowledge/workspace/find-bar.tsx'
import { Overlay } from '@/views/knowledge/workspace/overlay/index.ts'
import { SourceEditor } from '@/views/knowledge/workspace/source-editor.tsx'

type WorkspaceState = ReturnType<typeof useKnowledgeStore.getState>

function WorkspaceBootstrapSkeleton() {
  return (
    <div className="flex h-full min-h-0 animate-pulse flex-col gap-3 bg-background/92 p-6">
      <div className="h-4 w-40 rounded bg-muted" />
      <div className="h-3 w-full max-w-xl rounded bg-muted/80" />
      <div className="h-3 w-full max-w-lg rounded bg-muted/70" />
      <div className="mt-4 h-3 w-full max-w-2xl rounded bg-muted/60" />
      <div className="h-3 w-full max-w-md rounded bg-muted/50" />
    </div>
  )
}

interface WorkspaceSurfacesProps {
  activePath: string | null
  isFindOpen: boolean
  isFocusMode: boolean
  isDocLoading: boolean
  findPreferReplace: boolean
  viewMode: WorkspaceState['viewMode']
  composer: Editor | null
  markdown: string
  fontSize: number
  isDark: boolean
  onSourceChange: (value: string) => void
}

/** 中栏编辑区：源码 / 实时 / 内部分屏；左右栏在窗壳三列里 */
function WorkspaceSurfaces(props: WorkspaceSurfacesProps) {
  const liveScrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollRatio, setScrollRatio] = useState(0)
  const [scrollDocKey, setScrollDocKey] = useState(props.activePath)
  const [wasDocLoading, setWasDocLoading] = useState(props.isDocLoading)

  if (props.activePath !== scrollDocKey) {
    setScrollDocKey(props.activePath)
    if (scrollRatio !== 0) setScrollRatio(0)
  }
  if (props.isDocLoading !== wasDocLoading) {
    setWasDocLoading(props.isDocLoading)
    if (!props.isDocLoading && scrollRatio !== 0) setScrollRatio(0)
  }

  useEffect(
    function () {
      if (props.isDocLoading) return
      function resetLiveScroll() {
        const host = liveScrollRef.current
        if (host) host.scrollTop = 0
      }
      resetLiveScroll()
      const frame = window.requestAnimationFrame(resetLiveScroll)
      return function () {
        window.cancelAnimationFrame(frame)
      }
    },
    [props.activePath, props.isDocLoading]
  )

  function onLiveScroll(ratio: number) {
    setScrollRatio(ratio)
  }

  function onSourceScroll(ratio: number) {
    setScrollRatio(ratio)
    const host = liveScrollRef.current
    if (!host) return
    const max = host.scrollHeight - host.clientHeight
    if (max > 0) host.scrollTop = max * ratio
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-background/92">
      {props.isFindOpen ? (
        <FindBar
          editor={props.composer}
          preferReplace={props.findPreferReplace}
          clearToolbar={props.viewMode === 'live' && !props.isFocusMode}
        />
      ) : null}
      {props.isDocLoading ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/60">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      ) : null}
      {props.viewMode === 'source' ? (
        <SourceEditor
          value={props.markdown}
          fontSize={props.fontSize}
          isDark={props.isDark}
          onChange={props.onSourceChange}
          onScrollRatio={onSourceScroll}
          scrollRatio={scrollRatio}
          documentKey={props.activePath}
        />
      ) : null}

      {props.viewMode === 'live' ? (
        <Overlay.Section
          composer={props.composer}
          scrollHostRef={liveScrollRef}
          onScrollRatio={onLiveScroll}
        />
      ) : null}

      {props.viewMode === 'split' ? (
        <ResizablePanelGroup
          orientation="horizontal"
          className="h-full min-h-0">
          <ResizablePanel
            defaultSize="50%"
            className="min-h-0 min-w-0 overflow-hidden">
            <SourceEditor
              value={props.markdown}
              fontSize={props.fontSize}
              isDark={props.isDark}
              onChange={props.onSourceChange}
              onScrollRatio={onSourceScroll}
              scrollRatio={scrollRatio}
              documentKey={props.activePath}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel className="min-h-0 min-w-0 overflow-hidden">
            <Overlay.Section
              composer={props.composer}
              isToolbarHidden
              scrollHostRef={liveScrollRef}
              onScrollRatio={onLiveScroll}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : null}
    </div>
  )
}

export { WorkspaceBootstrapSkeleton, WorkspaceSurfaces }
