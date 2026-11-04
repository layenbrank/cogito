/**
 * 知识库左栏：对齐 llm_wiki IconSidebar + SidebarPanel。
 * 主轨：Wiki / Sources / Search / Graph / Lint / Review。
 * 深度研究只在标题栏 + 右栏 tabs，不进左轨。
 * 底轨：Settings。Activity 仅左栏底条。
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

const MAIN_RAIL: readonly { key: RailTabCanonical; label: string; icon: string }[] = [
  { key: 'wiki', label: 'Wiki', icon: 'lucide:book-open' },
  { key: 'sources', label: '来源', icon: 'lucide:folder-input' },
  { key: 'search', label: '检索', icon: 'lucide:search' },
  { key: 'graph', label: '图谱', icon: 'lucide:git-fork' },
  { key: 'lint', label: 'Lint', icon: 'lucide:scan-text' },
  { key: 'review', label: '审阅', icon: 'lucide:list-todo' }
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
    key: string
    label: string
    icon: string
    isActive: boolean
    badge?: string | null
    onClick: () => void
  }) {
    return (
      <Tooltip key={item.key}>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={item.label}
              aria-pressed={item.isActive}
              className={cn(
                'relative flex size-9 items-center justify-center rounded-md border-0 shadow-none outline-none transition-colors',
                'focus-visible:ring-1 focus-visible:ring-ring/35',
                item.isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
              onClick={item.onClick}
            />
          }>
          <Icon
            icon={item.icon}
            className="size-4 shrink-0"
          />
          {item.badge ? (
            <span className="bg-primary text-primary-foreground absolute -top-0.5 -end-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] leading-none font-semibold tabular-nums">
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
          'border-border flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden bg-background py-1.5',
          visibility.showLeftContent && 'border-e'
        )}>
        <div className="flex flex-1 flex-col items-center gap-1">
          {MAIN_RAIL.map(function (item) {
            return renderRailButton({
              key: item.key,
              label: item.label,
              icon: item.icon,
              isActive: item.key === tab,
              badge:
                item.key === 'review' && reviewPending > 0
                  ? reviewPending > 99
                    ? '99+'
                    : String(reviewPending)
                  : null,
              onClick: function () {
                toSetTab(item.key)
              }
            })
          })}
        </div>

        <div className="mt-1 flex flex-col items-center gap-1 border-t border-border pt-2">
          {renderRailButton({
            key: 'settings',
            label: '设置',
            icon: 'lucide:settings',
            isActive: tab === 'settings',
            onClick: function () {
              toSetTab('settings')
            }
          })}
        </div>
      </nav>

      {visibility.showLeftContent ? <SidebarPanel /> : null}
    </aside>
  )
}

export { KnowledgeSurface }
