import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '@cogito/design/components/tabs'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { startTransition, useEffect, useRef, useState } from 'react'

import {
  GRID_ZOOM_LEVELS,
  MOTION_MS,
  type LibraryLayout,
  type TimeScope
} from '@/views/gallery/constraints'
import { DateScrubber } from '@/views/gallery/library/date-scrubber'
import { MediaGrid } from '@/views/gallery/library/media-grid'
import { findScrubberMarks } from '@/views/gallery/library/time-buckets'
import { TimelineAxis } from '@/views/gallery/library/timeline-axis'
import { useGalleryScroll } from '@/views/gallery/library/use-gallery-scroll'
import type { GalleryMedia } from '@/views/gallery/model/media'

interface LibraryProps {
  title?: string
  medias: GalleryMedia[]
  selecting: boolean
  selectedIds: Set<string>
  onSelectingChange: (value: boolean) => void
  onToggleSelect: (media: GalleryMedia) => void
  onClearSelection: () => void
  onOpen: (media: GalleryMedia) => void
  onImport: (mode: 'files' | 'folders') => void
  onHideSelected: () => void
  onRemoveSelected: () => void
  importing?: boolean
  emptyHint?: string
  hideLabel?: string
}

/** 顶栏控件统一 h-8：Tabs sm / Button default / icon */
function LibraryToolbar(props: {
  title: string
  count: number
  scope: TimeScope
  onScope: (scope: TimeScope) => void
  layout: LibraryLayout
  onLayout: (layout: LibraryLayout) => void
  zoomIndex: number
  onZoomIndex: (updater: (value: number) => number) => void
  selecting: boolean
  onSelectingChange: (value: boolean) => void
  onClearSelection: () => void
  onImport: (mode: 'files' | 'folders') => void
  importing?: boolean
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 bg-background px-4 pt-2 pb-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{props.title}</h1>
        <p className="text-sm text-muted-foreground">{props.count} 个项目</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Tabs
          value={props.scope}
          onValueChange={function (value) {
            if (value) props.onScope(value as TimeScope)
          }}
          className="hidden sm:flex">
          <TabsList size="sm">
            <TabsTrigger value="years">年</TabsTrigger>
            <TabsTrigger value="months">月</TabsTrigger>
            <TabsTrigger value="all">全部</TabsTrigger>
          </TabsList>
        </Tabs>

        <Tabs
          value={props.layout}
          onValueChange={function (value) {
            if (value) props.onLayout(value as LibraryLayout)
          }}>
          <TabsList size="sm">
            <TabsTrigger
              value="grid"
              aria-label="网格视图"
              className="px-2.5">
              <Icon icon="lucide:layout-grid" />
            </TabsTrigger>
            <TabsTrigger
              value="axis"
              aria-label="时间轴视图"
              className="px-2.5">
              <Icon icon="lucide:gallery-vertical" />
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="缩小缩略图"
          disabled={props.zoomIndex >= GRID_ZOOM_LEVELS.length - 1}
          onClick={function () {
            props.onZoomIndex(function (value) {
              return Math.min(GRID_ZOOM_LEVELS.length - 1, value + 1)
            })
          }}>
          <Icon icon="lucide:zoom-out" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="放大缩略图"
          disabled={props.zoomIndex <= 0}
          onClick={function () {
            props.onZoomIndex(function (value) {
              return Math.max(0, value - 1)
            })
          }}>
          <Icon icon="lucide:zoom-in" />
        </Button>
        <Button
          type="button"
          variant={props.selecting ? 'secondary' : 'outline'}
          className={props.selecting ? 'bg-primary/15 text-foreground' : undefined}
          onClick={function () {
            if (props.selecting) props.onClearSelection()
            props.onSelectingChange(!props.selecting)
          }}>
          {props.selecting ? '完成' : '选择'}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                disabled={props.importing}>
                <Icon icon="lucide:plus" />
                导入
                <Icon
                  icon="lucide:chevron-down"
                  className="size-3.5 opacity-70"
                />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={function () {
                props.onImport('files')
              }}>
              <Icon icon="lucide:file-image" />
              选择文件
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={function () {
                props.onImport('folders')
              }}>
              <Icon icon="lucide:folder-open" />
              选择文件夹
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

/**
 * 选择操作条。
 *
 * `AnimatePresence` 必须常驻、只在内部条件渲染子元素：否则它与正在退场的子元素一起被卸载，
 * 退场动画根本不会播（react-doctor 的 motion-animate-presence-must-outlive-child）。
 */
function LibrarySelectionBar(props: {
  visible: boolean
  count: number
  hideLabel?: string
  onHideSelected: () => void
  onRemoveSelected: () => void
  isReducedMotion: boolean | null
  motionSec: number
}) {
  return (
    <AnimatePresence initial={false}>
      {props.visible ? (
        <m.div
          className="mx-4 mb-2 flex items-center gap-2 overflow-hidden rounded-xl border border-border/60 bg-card/80 px-3 py-2 text-sm backdrop-blur-sm"
          initial={props.isReducedMotion ? false : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={props.isReducedMotion ? undefined : { opacity: 0, y: -4 }}
          transition={{ duration: props.motionSec, ease: [0.22, 1, 0.36, 1] }}>
          <span className="text-muted-foreground">已选 {props.count}</span>
          <div className="ml-auto flex gap-1.5">
            <Button
              type="button"
              variant="outline"
              onClick={props.onHideSelected}>
              <Icon icon={props.hideLabel === '取消隐藏' ? 'lucide:eye' : 'lucide:eye-off'} />
              {props.hideLabel ?? '隐藏'}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={props.onRemoveSelected}>
              <Icon icon="lucide:trash-2" />
              删除
            </Button>
          </div>
        </m.div>
      ) : null}
    </AnimatePresence>
  )
}

/** 空态：还没有媒体时的引导 */
function LibraryEmptyState(props: {
  emptyHint?: string
  importing?: boolean
  onImport: (mode: 'files' | 'folders') => void
}) {
  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 text-center">
      <Icon
        icon="lucide:images"
        className="size-10 text-muted-foreground/70"
      />
      <p className="text-sm text-muted-foreground">
        {props.emptyHint ?? '还没有媒体。导入照片或视频，或从截图磁贴收录。'}
      </p>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              disabled={props.importing}>
              导入媒体
            </Button>
          }
        />
        <DropdownMenuContent>
          <DropdownMenuItem
            onClick={function () {
              props.onImport('files')
            }}>
            选择文件
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={function () {
              props.onImport('folders')
            }}>
            选择文件夹
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * 内容区：空态 / 时间轴 / 网格。
 *
 * 切布局 / 时间粒度时不要用 AnimatePresence mode=wait 整树卸载：
 * 会拆掉 MediaCell、IntersectionObserver 与 streamed 分片，切换必卡。
 * 网格内部改 props 即可；仅空态保留轻量进出场。
 */
function LibraryContent(props: {
  medias: GalleryMedia[]
  layout: LibraryLayout
  scope: TimeScope
  columns: number
  selecting: boolean
  selectedIds: Set<string>
  emptyHint?: string
  importing?: boolean
  onImport: (mode: 'files' | 'folders') => void
  onOpen: (media: GalleryMedia) => void
  onToggleSelect: (media: GalleryMedia) => void
  isReducedMotion: boolean | null
  motionSec: number
}) {
  const isEmpty = props.medias.length === 0

  return (
    <AnimatePresence
      mode="popLayout"
      initial={false}>
      {isEmpty ? (
        <m.div
          key="empty"
          initial={props.isReducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={props.isReducedMotion ? undefined : { opacity: 0 }}
          transition={{ duration: props.motionSec * 0.7, ease: [0.22, 1, 0.36, 1] }}>
          <LibraryEmptyState
            emptyHint={props.emptyHint}
            importing={props.importing}
            onImport={props.onImport}
          />
        </m.div>
      ) : props.layout === 'axis' ? (
        <div key="axis">
          <TimelineAxis
            medias={props.medias}
            selecting={props.selecting}
            selectedIds={props.selectedIds}
            onOpen={props.onOpen}
            onToggleSelect={props.onToggleSelect}
          />
        </div>
      ) : (
        <div key="grid">
          <MediaGrid
            medias={props.medias}
            scope={props.scope}
            columns={props.columns}
            selecting={props.selecting}
            selectedIds={props.selectedIds}
            onOpen={props.onOpen}
            onToggleSelect={props.onToggleSelect}
          />
        </div>
      )}
    </AnimatePresence>
  )
}

function Library(props: LibraryProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollRoot, onScrollRoot] = useState<HTMLElement | null>(null)
  const [layout, onLayout] = useState<LibraryLayout>('grid')
  const [scope, onScope] = useState<TimeScope>('all')
  const [zoomIndex, onZoomIndex] = useState(2)
  const columns = GRID_ZOOM_LEVELS[zoomIndex] ?? 5
  const marks = findScrubberMarks(props.medias)
  const scrollFx = useGalleryScroll(scrollRoot)
  const isReducedMotion = useReducedMotion()
  const motionSec = MOTION_MS / 1000

  useEffect(
    function () {
      onScrollRoot(scrollRef.current)
    },
    []
  )

  const hasSelection = props.selectedIds.size > 0

  function switchScope(next: TimeScope) {
    startTransition(function () {
      onScope(next)
    })
  }

  function switchLayout(next: LibraryLayout) {
    startTransition(function () {
      onLayout(next)
    })
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-background">
      <LibraryToolbar
        title={props.title ?? '图库'}
        count={props.medias.length}
        scope={scope}
        onScope={switchScope}
        layout={layout}
        onLayout={switchLayout}
        zoomIndex={zoomIndex}
        onZoomIndex={onZoomIndex}
        selecting={props.selecting}
        onSelectingChange={props.onSelectingChange}
        onClearSelection={props.onClearSelection}
        onImport={props.onImport}
        importing={props.importing}
      />

      <LibrarySelectionBar
        visible={props.selecting && hasSelection}
        count={props.selectedIds.size}
        hideLabel={props.hideLabel}
        onHideSelected={props.onHideSelected}
        onRemoveSelected={props.onRemoveSelected}
        isReducedMotion={isReducedMotion}
        motionSec={motionSec}
      />

      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-y-auto bg-background px-4">
        <LibraryContent
          medias={props.medias}
          layout={layout}
          scope={scope}
          columns={columns}
          selecting={props.selecting}
          selectedIds={props.selectedIds}
          emptyHint={props.emptyHint}
          importing={props.importing}
          onImport={props.onImport}
          onOpen={props.onOpen}
          onToggleSelect={props.onToggleSelect}
          isReducedMotion={isReducedMotion}
          motionSec={motionSec}
        />
      </div>

      {layout === 'grid' && scope === 'all' ? (
        <DateScrubber
          marks={marks}
          scrollRoot={scrollRoot}
          scrollFxRef={scrollFx}
        />
      ) : null}
    </div>
  )
}

export { Library }
export type { LibraryProps }
