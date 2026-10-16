import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@i-thinking/design/components/resizable'
import { clsx } from 'clsx'
import { useEffect } from 'react'

import { useClipchampStore } from '@/stores/clipchamp.ts'
import { Inspector } from '@/views/clipchamp/workspace/inspector.tsx'
import { MediaPanel } from '@/views/clipchamp/workspace/media-panel.tsx'
import { MediaRail } from '@/views/clipchamp/workspace/media-rail.tsx'
import { Preview } from '@/views/clipchamp/workspace/preview.tsx'
import { Timeline } from '@/views/clipchamp/workspace/timeline/timeline.tsx'
import { useClipchampCommands } from '@/views/clipchamp/lib/commands.ts'

function Workspace() {
  const isFullscreen = useClipchampStore(function (s) {
    return s.isFullscreen
  })
  const tick = useClipchampStore(function (s) {
    return s.tick
  })
  const isPlaying = useClipchampStore(function (s) {
    return s.isPlaying
  })
  const restoreProject = useClipchampStore(function (s) {
    return s.restoreProject
  })

  useClipchampCommands()

  useEffect(
    function () {
      // soft restore on mount if saved
      try {
        if (localStorage.getItem('clipchamp.project.v1')) {
          // don't auto toast — silent attempt only when empty
          const assets = useClipchampStore.getState().assets
          const duration = useClipchampStore.getState().project.durationMs
          if (assets.length === 0 && duration === 0) {
            restoreProject({ silent: true })
          }
        }
      } catch (error) {
        console.debug('[clipchamp] silent restore skipped', error)
      }
    },
    [restoreProject]
  )

  useEffect(
    function () {
      if (!isPlaying) return
      let frame = 0
      let last = performance.now()
      function loop(now: number) {
        const delta = now - last
        last = now
        tick(delta)
        frame = requestAnimationFrame(loop)
      }
      frame = requestAnimationFrame(loop)
      return function () {
        cancelAnimationFrame(frame)
      }
    },
    [isPlaying, tick]
  )

  if (isFullscreen) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col bg-black">
        <Preview isFullscreen />
      </div>
    )
  }

  return (
    <div className={clsx('flex min-h-0 flex-1 flex-col overflow-hidden bg-background')}>
      <ResizablePanelGroup
        orientation="vertical"
        className="min-h-0 flex-1">
        <ResizablePanel
          defaultSize="62%"
          minSize="35%"
          className="min-h-0 overflow-hidden">
          <ResizablePanelGroup
            orientation="horizontal"
            className="h-full min-h-0">
            <ResizablePanel
              defaultSize="22%"
              minSize={240}
              maxSize="34%"
              className="min-h-0 overflow-hidden">
              <div className="flex h-full min-h-0 border-r border-border/60">
                <MediaRail />
                <MediaPanel />
              </div>
            </ResizablePanel>
            <ResizableHandle className="w-1 bg-transparent transition-colors hover:bg-primary/20" />
            <ResizablePanel className="flex min-h-0 flex-col overflow-hidden">
              <Preview />
            </ResizablePanel>
            <ResizableHandle className="w-1 bg-transparent transition-colors hover:bg-primary/20" />
            <ResizablePanel
              defaultSize="22%"
              minSize={220}
              maxSize="34%"
              className="min-h-0 overflow-hidden">
              <Inspector />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle className="h-1 bg-transparent transition-colors hover:bg-primary/20" />
        <ResizablePanel
          defaultSize="38%"
          minSize={180}
          className="min-h-0 overflow-hidden">
          <Timeline />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

export default Workspace
