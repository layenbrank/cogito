import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@i-thinking/design/components/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@i-thinking/design/components/toggle-group'
import { cn } from 'cn'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { useEffect, useRef, useState } from 'react'

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

/** Base UI Toggle 用 data-pressed，不是 Radix 的 data-state=on */
const TOGGLE_ACTIVE =
  'data-[pressed]:bg-primary/15 data-[pressed]:text-primary data-[pressed]:shadow-sm aria-pressed:bg-primary/15 aria-pressed:text-primary'

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

  const title = props.title ?? '图库'
  const hasSelection = props.selectedIds.size > 0

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex shrink-0 items-start justify-between gap-3 bg-background px-4 pt-2 pb-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{props.medias.length} 个项目</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <ToggleGroup
            value={[scope]}
            onValueChange={function (values) {
              const next = values[0] as TimeScope | undefined
              if (next) onScope(next)
            }}
            variant="outline"
            size="sm"
            spacing={0}
            className="hidden sm:flex">
            <ToggleGroupItem value="years" className={TOGGLE_ACTIVE}>
              年
            </ToggleGroupItem>
            <ToggleGroupItem value="months" className={TOGGLE_ACTIVE}>
              月
            </ToggleGroupItem>
            <ToggleGroupItem value="all" className={TOGGLE_ACTIVE}>
              全部
            </ToggleGroupItem>
          </ToggleGroup>

          <ToggleGroup
            value={[layout]}
            onValueChange={function (values) {
              const next = values[0] as LibraryLayout | undefined
              if (next) onLayout(next)
            }}
            variant="outline"
            size="sm"
            spacing={0}>
            <ToggleGroupItem
              value="grid"
              aria-label="网格视图"
              className={cn('px-2', TOGGLE_ACTIVE)}>
              <Icon icon="lucide:layout-grid" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="axis"
              aria-label="时间轴视图"
              className={cn('px-2', TOGGLE_ACTIVE)}>
              <Icon icon="lucide:gallery-vertical" />
            </ToggleGroupItem>
          </ToggleGroup>

          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="缩小缩略图"
            disabled={zoomIndex >= GRID_ZOOM_LEVELS.length - 1}
            onClick={function () {
              onZoomIndex(function (value) {
                return Math.min(GRID_ZOOM_LEVELS.length - 1, value + 1)
              })
            }}>
            <Icon icon="lucide:zoom-out" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="放大缩略图"
            disabled={zoomIndex <= 0}
            onClick={function () {
              onZoomIndex(function (value) {
                return Math.max(0, value - 1)
              })
            }}>
            <Icon icon="lucide:zoom-in" />
          </Button>
          <Button
            type="button"
            size="sm"
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
                <Button type="button" size="sm" disabled={props.importing}>
                  <Icon icon="lucide:plus" />
                  导入
                  <Icon icon="lucide:chevron-down" className="size-3.5 opacity-70" />
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

      <AnimatePresence initial={false}>
        {props.selecting && hasSelection ? (
          <m.div
            className="mx-4 mb-2 flex items-center gap-2 overflow-hidden rounded-xl border border-border/60 bg-card/80 px-3 py-2 text-sm backdrop-blur-sm"
            initial={isReducedMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={isReducedMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: motionSec, ease: [0.22, 1, 0.36, 1] }}>
            <span className="text-muted-foreground">已选 {props.selectedIds.size}</span>
            <div className="ml-auto flex gap-1.5">
              <Button type="button" size="sm" variant="outline" onClick={props.onHideSelected}>
                <Icon icon={props.hideLabel === '取消隐藏' ? 'lucide:eye' : 'lucide:eye-off'} />
                {props.hideLabel ?? '隐藏'}
              </Button>
              <Button type="button" size="sm" variant="destructive" onClick={props.onRemoveSelected}>
                <Icon icon="lucide:trash-2" />
                删除
              </Button>
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>

      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background px-4">
        {props.medias.length === 0 ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 text-center">
            <Icon icon="lucide:images" className="size-10 text-muted-foreground/70" />
            <p className="text-sm text-muted-foreground">
              {props.emptyHint ?? '还没有媒体。导入照片或视频，或从截图磁贴收录。'}
            </p>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button type="button" disabled={props.importing}>
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
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <m.div
              key={`${layout}:${scope}`}
              initial={isReducedMotion ? false : { opacity: 0.4, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={isReducedMotion ? undefined : { opacity: 0.35, y: -4 }}
              transition={{ duration: motionSec, ease: [0.22, 1, 0.36, 1] }}>
              {layout === 'axis' ? (
                <TimelineAxis
                  medias={props.medias}
                  selecting={props.selecting}
                  selectedIds={props.selectedIds}
                  onOpen={props.onOpen}
                  onToggleSelect={props.onToggleSelect}
                />
              ) : (
                <MediaGrid
                  medias={props.medias}
                  scope={scope}
                  columns={columns}
                  selecting={props.selecting}
                  selectedIds={props.selectedIds}
                  onOpen={props.onOpen}
                  onToggleSelect={props.onToggleSelect}
                />
              )}
            </m.div>
          </AnimatePresence>
        )}
      </div>

      {layout === 'grid' && scope === 'all' ? (
        <DateScrubber marks={marks} scrollRoot={scrollRoot} scrollFxRef={scrollFx} />
      ) : null}
    </div>
  )
}

export { Library }
export type { LibraryProps }
