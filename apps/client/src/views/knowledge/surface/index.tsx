/**
 * 知识库左栏：对齐 llm_wiki IconSidebar + SidebarPanel。
 * 主轨：Wiki / Sources / Search / Graph / Lint / Review / Research；
 * 底轨：Settings（Activity 在左栏底条，不再占独立内容页为主）。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@cogito/design/components/tooltip'
import { cn } from 'cn'
import { useEffect, useState } from 'react'

import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useIngestQueueStore } from '@/views/knowledge/lib/ingest-queue.ts'
import { takePendingForBase } from '@/views/knowledge/lib/pending-ingest.ts'
import { readReviewItems } from '@/views/knowledge/lib/review-store.ts'
import { readWatchAllBases } from '@/views/knowledge/lib/source-watch-config.ts'
import { watchKnowledgeBases } from '@/views/knowledge/lib/sources-watch.ts'
import { findLayoutVisibility } from '@/views/knowledge/surface/layout-visibility.ts'
import { SidebarPanel } from '@/views/knowledge/surface/sidebar-panel.tsx'
import { useSurfaceStore, type RailTabCanonical } from '@/views/knowledge/surface/store.ts'

/** 与 llm_wiki NAV_ITEMS 顺序一致（chat 由右栏 ACP dock 承担） */
const MAIN_RAIL: readonly { key: RailTabCanonical; label: string; icon: string }[] = [
  { key: 'wiki', label: 'Wiki', icon: 'lucide:file-text' },
  { key: 'sources', label: '来源', icon: 'lucide:folder-open' },
  { key: 'search', label: '检索', icon: 'lucide:search' },
  { key: 'graph', label: '图谱', icon: 'lucide:network' },
  { key: 'lint', label: 'Lint', icon: 'lucide:clipboard-check' },
  { key: 'review', label: '审阅', icon: 'lucide:clipboard-list' },
  { key: 'research', label: '深度研究', icon: 'lucide:globe' }
]

const BOTTOM_RAIL: readonly { key: RailTabCanonical; label: string; icon: string }[] = [
  { key: 'activity', label: '活动', icon: 'lucide:list-checks' },
  { key: 'settings', label: '设置', icon: 'lucide:settings' }
]

function KnowledgeSurface() {
  const isOpen = useKnowledgeStore(function (state) {
    return state.isSidebarOpen
  })
  const tab = useSurfaceStore(function (state) {
    return state.tab
  })
  const toSetTab = useSurfaceStore(function (state) {
    return state.toSetTab
  })
  const refresh = useKnowledgeBaseStore(function (state) {
    return state.refresh
  })
  const bases = useKnowledgeBaseStore(function (state) {
    return state.bases
  })
  const activeBaseID = useKnowledgeBaseStore(function (state) {
    return state.activeBaseID
  })

  const ingestPending = useIngestQueueStore(function (state) {
    return state.items.filter(function (item) {
      return item.status === 'pending' || item.status === 'running'
    }).length
  })

  const [reviewPending, setReviewPending] = useState(0)
  const visibility = findLayoutVisibility(tab)

  useEffect(
    function () {
      if (!isOpen) return
      void refresh()
      setReviewPending(
        readReviewItems().filter(function (item) {
          return item.status === 'pending'
        }).length
      )
    },
    [isOpen, refresh, tab]
  )

  const [watchEpoch, setWatchEpoch] = useState(0)

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
      if (!isOpen || !activeBaseID) return
      let cancelled = false
      let stop: (() => void) | null = null
      void watchKnowledgeBases({
        bases: bases.map(function (base) {
          return { id: base.id, rootPath: base.rootPath }
        }),
        activeBaseId: activeBaseID,
        watchAllBases: readWatchAllBases()
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
    [isOpen, activeBaseID, bases, watchEpoch]
  )

  useEffect(
    function () {
      if (!activeBaseID) return
      const pending = takePendingForBase(activeBaseID)
      if (!pending || pending.paths.length === 0) return
      const enqueue = useIngestQueueStore.getState().enqueue
      for (const path of pending.paths) {
        enqueue(path)
      }
    },
    [activeBaseID, watchEpoch]
  )

  if (!isOpen) return null

  function renderRailButton(item: {
    key: RailTabCanonical
    label: string
    icon: string
    badge?: string | null
  }) {
    const isActive = item.key === tab
    return (
      <Tooltip key={item.key}>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={item.label}
              aria-pressed={isActive}
              className={cn(
                'relative size-10 rounded-md border-0 shadow-none ring-0 focus-visible:ring-1 focus-visible:ring-ring/30',
                isActive
                  ? 'bg-accent text-accent-foreground hover:bg-accent'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
              )}
              onClick={function () {
                toSetTab(item.key)
              }}
            />
          }>
          <Icon
            icon={item.icon}
            className="size-5"
          />
          {item.badge ? (
            <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold">
              {item.badge}
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipContent
          side="right"
          sideOffset={6}>
          {item.label}
          {item.badge ? ` (${item.badge})` : ''}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <aside className="flex h-full min-h-0 w-full bg-background">
      <nav
        aria-label="知识库导航"
        className={cn(
          'bg-muted/50 flex w-12 shrink-0 flex-col items-center py-2',
          visibility.showLeftContent && 'border-r border-border'
        )}>
        <div className="flex flex-1 flex-col items-center gap-1">
          {MAIN_RAIL.map(function (item) {
            if (item.key === 'review') {
              return renderRailButton({
                ...item,
                badge:
                  reviewPending > 0
                    ? reviewPending > 99
                      ? '99+'
                      : String(reviewPending)
                    : null
              })
            }
            return renderRailButton(item)
          })}
        </div>

        <div className="flex flex-col items-center gap-1 pb-1">
          {BOTTOM_RAIL.map(function (item) {
            if (item.key === 'activity') {
              return renderRailButton({
                ...item,
                badge:
                  ingestPending > 0
                    ? ingestPending > 99
                      ? '99+'
                      : String(ingestPending)
                    : null
              })
            }
            return renderRailButton(item)
          })}
        </div>
      </nav>

      {visibility.showLeftContent ? <SidebarPanel /> : null}
    </aside>
  )
}

export { KnowledgeSurface }
