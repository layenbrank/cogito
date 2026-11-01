import {
  Splitter,
  SplitterHandle,
  SplitterPane
} from '@cogito/design/components/splitter'
import { clsx } from 'clsx'
import { useEffect } from 'react'

import { findPref } from '@/features/persist'
import { useClipchampStore } from '@/stores/clipchamp.ts'
import { Inspector } from '@/views/clipchamp/workspace/inspector.tsx'
import { MediaSurface } from '@/views/clipchamp/workspace/media-surface.tsx'
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
        const saved = findPref('clipchamp')
        if (saved && typeof saved === 'object' && 'project' in saved && saved.project) {
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
      <Splitter
        id="clipchamp-workspace"
        orientation="vertical"
        className="min-h-0 flex-1">
        <SplitterPane
          id="clipchamp-upper"
          defaultSize="62%"
          min="35%"
          className="min-h-0 overflow-hidden">
          <Splitter
            id="clipchamp-upper-row"
            orientation="horizontal"
            className="h-full min-h-0">
            <SplitterPane
              id="clipchamp-media"
              defaultSize="22%"
              min={240}
              max="34%"
              className="min-h-0 overflow-hidden">
              <div className="flex h-full min-h-0 border-r border-border/60">
                <MediaRail />
                <MediaSurface />
              </div>
            </SplitterPane>
            <SplitterHandle className="w-1 bg-transparent transition-colors hover:bg-primary/20" />
            <SplitterPane
              id="clipchamp-preview"
              className="flex min-h-0 flex-col overflow-hidden">
              <Preview />
            </SplitterPane>
            <SplitterHandle className="w-1 bg-transparent transition-colors hover:bg-primary/20" />
            <SplitterPane
              id="clipchamp-inspector"
              defaultSize="22%"
              min={220}
              max="34%"
              className="min-h-0 overflow-hidden">
              <Inspector />
            </SplitterPane>
          </Splitter>
        </SplitterPane>
        <SplitterHandle className="h-1 bg-transparent transition-colors hover:bg-primary/20" />
        <SplitterPane
          id="clipchamp-timeline"
          defaultSize="38%"
          min={180}
          className="min-h-0 overflow-hidden">
          <Timeline />
        </SplitterPane>
      </Splitter>
    </div>
  )
}

export default Workspace
