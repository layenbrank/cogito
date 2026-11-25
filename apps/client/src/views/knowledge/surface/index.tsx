/**
 * 左栏壳（编辑器优先）：只有一条可折叠侧栏，不再有 48px 图标 rail。
 * 来源 / 检索 / 图谱 / Lint / 审阅 / 待发布 / 设置 全部收进标题栏「空间」菜单。
 */
import { memo, useEffect, useState } from 'react'

import { useSpacesStore } from '@/stores/spaces'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useIngestQueueStore } from '@/views/knowledge/lib/ingest-queue.ts'
import { takePendingForSpace } from '@/views/knowledge/lib/pending-ingest.ts'
import { readWatchAllSpaces } from '@/views/knowledge/lib/source-watch-config.ts'
import { watchKnowledgeSpaces } from '@/views/knowledge/lib/sources-watch.ts'
import { SidebarSurface } from '@/views/knowledge/surface/sidebar-surface.tsx'

const KnowledgeSurface = memo(function KnowledgeSurface() {
  const isOpen = useKnowledgeStore(function (state) {
    return state.isSidebarOpen
  })
  const refresh = useSpacesStore(function (state) {
    return state.refresh
  })
  const spaces = useSpacesStore(function (state) {
    return state.spaces
  })
  const activeSpaceID = useSpacesStore(function (state) {
    return state.activeSpaceID
  })

  // 只在侧栏打开时刷一次：切主区页签不需要重扫磁盘（否则一次 tab 点击触发 4~5 次 store 通知）
  useEffect(
    function () {
      if (!isOpen) return
      void refresh()
    },
    [isOpen, refresh]
  )

  const [watchEpoch, setWatchEpoch] = useState(0)

  // 只认「空间集合本身」的变化：refresh 每次都换新的 spaces 数组，用引用做依赖
  // 会让每个空间每次都 unwatch + watch 一遍原始资料目录。
  const spaceWatchKey = spaces
    .map(function (space) {
      return `${space.id}:${space.rootPath}`
    })
    .join('|')

  useEffect(
    function () {
      function onWatchChanged() {
        setWatchEpoch(function (value) {
          return value + 1
        })
      }
      window.addEventListener('knowledge:source-watch-changed', onWatchChanged)
      return function () {
        window.removeEventListener('knowledge:source-watch-changed', onWatchChanged)
      }
    },
    []
  )

  useEffect(
    function () {
      if (!isOpen || !activeSpaceID) return
      let cancelled = false
      let stop: (() => void) | null = null
      void watchKnowledgeSpaces({
        spaces: useSpacesStore.getState().spaces.map(function (space) {
          return { id: space.id, rootPath: space.rootPath }
        }),
        activeSpaceId: activeSpaceID,
        watchAllBases: readWatchAllSpaces()
      }).then(function (unwatch) {
        if (cancelled) {
          unwatch()
          return
        }
        stop = unwatch
      })
      return function () {
        cancelled = true
        stop?.()
      }
    },
    [isOpen, activeSpaceID, spaceWatchKey, watchEpoch]
  )

  useEffect(
    function () {
      if (!activeSpaceID) return
      const pending = takePendingForSpace(activeSpaceID)
      if (!pending || pending.paths.length === 0) return
      const enqueue = useIngestQueueStore.getState().enqueue
      for (const path of pending.paths) {
        enqueue(path)
      }
    },
    [activeSpaceID, watchEpoch]
  )

  if (!isOpen) return null

  return (
    <aside className="bg-background flex h-full min-h-0 w-full">
      <SidebarSurface />
    </aside>
  )
})

export { KnowledgeSurface }
