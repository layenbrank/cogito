import { Button } from '@cogito/design/components/button'
import { Icon } from '@iconify/react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { GalleryRow } from '@/views/gallery/model/asset'
import type { GallerySection } from '@/views/gallery/model/derive'
import { sampleTimelineMarks } from '@/views/gallery/model/derive'
import { GalleryCell } from '@/views/gallery/ui/grid/cell'

/**
 * 行虚拟化网格（前缀和 + 二分找可视行）。
 *
 * 为什么手写而不是引入 `@tanstack/react-virtual`：照片墙布局规则是固定的
 * （列数 × 正方形单元 + 已知高度的分组头），前缀和足以精确算出可视区间，
 * 而且分组头作为普通虚拟项渲染（**不做 sticky**）就不会和绝对定位打架 ——
 * 顶部另用一个浮动日期胶囊承担「我在哪一天」的锚点。
 */
const GAP = 4
const HEADER_HEIGHT = 34
const OVERSCAN_ROWS = 4
/** 滚动容器的上内边距（`pt-8`）；块坐标是内层容器的，换算时需要它 */
const PAD_TOP = 32
/** 刻度条最多画多少个 ——— 再多就挤成一条实线 */
const MAX_SCRUBBED_MARKS = 40

interface GridBlock {
  key: string
  kind: 'header' | 'row'
  top: number
  height: number
  label?: string
  rows?: GalleryRow[]
}

interface VirtualGridProps {
  sections: GallerySection[]
  columns: number
  selectedIDs: Set<string>
  activeID: string | null
  /** 选择模式：传给单元决定是否画勾选圈 */
  isSelecting?: boolean
  emptyHint: string
  /** 空状态下的按钮（导入 / 清除筛选）；空列表时比一行文字有用得多 */
  emptyAction?: ReactNode
  /** 首次拉 catalog：渲染骨架，而不是“没有照片”的误导 */
  isLoading?: boolean
  onActivate: (row: GalleryRow, options: { additive: boolean; range: boolean }) => void
  onOpen: (row: GalleryRow) => void
}

function buildBlocks(
  sections: GallerySection[],
  columns: number,
  cellSize: number
): { blocks: GridBlock[]; total: number } {
  const blocks: GridBlock[] = []
  let top = 0
  for (const section of sections) {
    if (section.rows.length === 0) continue
    blocks.push({
      key: `h:${section.key}`,
      kind: 'header',
      top,
      height: HEADER_HEIGHT,
      label: section.label
    })
    top += HEADER_HEIGHT
    for (let index = 0; index < section.rows.length; index += columns) {
      const rows = section.rows.slice(index, index + columns)
      blocks.push({
        key: `r:${section.key}:${index}`,
        kind: 'row',
        top,
        height: cellSize,
        rows
      })
      top += cellSize + GAP
    }
  }
  return { blocks, total: Math.max(0, top) }
}

function findFirstVisible(blocks: GridBlock[], offset: number): number {
  let low = 0
  let high = blocks.length - 1
  let result = 0
  while (low <= high) {
    const mid = (low + high) >> 1
    const block = blocks[mid]
    if (!block) break
    if (block.top + block.height < offset) {
      low = mid + 1
    } else {
      result = mid
      high = mid - 1
    }
  }
  return result
}

/**
 * 首屏骨架：首次拉 catalog 时用。比“还没有照片”的文案准确 ——
 * 用户还没看到数据，不应该被暗示库里是空的。
 */
function GridSkeleton(props: { columns: number }) {
  const cells = Math.max(props.columns * 4, 16)
  return (
    <div className="h-full overflow-hidden px-3 pb-6 pt-8" aria-busy aria-label="正在载入图库">
      <div
        className="grid animate-pulse gap-1"
        style={{ gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: cells }, function (_, index) {
          return (
            <div
              key={index}
              className="aspect-square rounded-md bg-muted/60"
            />
          )
        })}
      </div>
    </div>
  )
}

function VirtualGrid(props: VirtualGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)

  useEffect(
    function () {
      const node = scrollRef.current
      if (!node) return
      const observer = new ResizeObserver(
        function (entries) {
          const entry = entries[0]
          if (!entry) return
          setWidth(entry.contentRect.width)
          setViewportHeight(entry.contentRect.height)
        }
      )
      observer.observe(node)
      return function () {
        observer.disconnect()
      }
    },
    []
  )

  const cellSize = width > 0 ? Math.floor((width - GAP * (props.columns - 1)) / props.columns) : 120
  const { blocks, total } = useMemo(
    function () {
      return buildBlocks(props.sections, props.columns, cellSize)
    },
    [props.sections, props.columns, cellSize]
  )

  const startIndex = findFirstVisible(blocks, Math.max(0, scrollTop - OVERSCAN_ROWS * cellSize))
  const endOffset = scrollTop + viewportHeight + OVERSCAN_ROWS * cellSize
  const visible: GridBlock[] = []
  for (let index = startIndex; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (!block || block.top > endOffset) break
    visible.push(block)
  }

  // 刻度条：所有分组头（含未渲染的），抽样后用 top 比例定位
  const scrubMarks = useMemo(
    function () {
      const headers = blocks
        .filter(function (block) {
          return block.kind === 'header'
        })
        .map(function (block) {
          return { key: block.key.slice(2), label: block.label ?? '', top: block.top }
        })
      return headers.length > 1 ? sampleTimelineMarks(headers, MAX_SCRUBBED_MARKS) : []
    },
    [blocks]
  )

  // 浮层与当前分组：块坐标 = 滚动位置 - 上内边距
  const blockOffset = scrollTop - PAD_TOP
  const activeKey = useMemo(
    function () {
      let active: string | null = null
      for (const block of blocks) {
        if (block.kind !== 'header') continue
        if (block.top <= blockOffset + HEADER_HEIGHT) active = block.key.slice(2)
        else break
      }
      return active
    },
    [blocks, blockOffset]
  )

  const floatingLabel = useMemo(
    function () {
      let label: string | null = null
      for (const block of blocks) {
        if (block.kind !== 'header') continue
        if (block.top <= blockOffset + HEADER_HEIGHT) label = block.label ?? null
        else break
      }
      return label
    },
    [blocks, blockOffset]
  )

  const jumpTo = useCallback(function (top: number) {
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = Math.max(0, top + PAD_TOP - HEADER_HEIGHT)
  }, [])

  const isEmpty = blocks.length === 0

  return (
    <div className="relative min-h-0 flex-1">
      {floatingLabel ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-1">
          <span className="rounded-full bg-background/85 px-2.5 py-0.5 text-xs font-medium text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur">
            {floatingLabel}
          </span>
        </div>
      ) : null}

      {props.isLoading ? (
        <GridSkeleton columns={props.columns} />
      ) : isEmpty ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-muted/60">
            <Icon icon="lucide:images" className="size-5 text-muted-foreground" />
          </div>
          <p className="max-w-xs text-sm text-muted-foreground">{props.emptyHint}</p>
          {props.emptyAction ? (
            <div className="flex items-center gap-1.5">{props.emptyAction}</div>
          ) : null}
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            role="listbox"
            aria-multiselectable
            aria-label="图库"
            className="h-full overflow-y-auto overflow-x-hidden px-3 pb-6 pt-8"
            onScroll={function (event) {
              setScrollTop(event.currentTarget.scrollTop)
            }}
          >
            <div style={{ height: total, position: 'relative' }}>
              {visible.map(function (block) {
                if (block.kind === 'header') {
                  return (
                    <div
                      key={block.key}
                      data-gallery-section={block.key.slice(2)}
                      className="flex items-center text-xs font-medium text-muted-foreground"
                      style={{ position: 'absolute', top: block.top, left: 0, right: 0, height: block.height }}
                    >
                      {block.label}
                    </div>
                  )
                }
                return (
                  <div
                    key={block.key}
                    style={{
                      position: 'absolute',
                      top: block.top,
                      left: 0,
                      right: 0,
                      height: block.height,
                      display: 'grid',
                      gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))`,
                      gap: GAP
                    }}
                  >
                    {(block.rows ?? []).map(function (row) {
                      return (
                        <GalleryCell
                          key={row.id}
                          row={row}
                          columns={props.columns}
                          isSelected={props.selectedIDs.has(row.id)}
                          isActive={props.activeID === row.id}
                          isSelecting={props.isSelecting ?? false}
                          onActivate={props.onActivate}
                          onOpen={props.onOpen}
                        />
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>

          {scrubMarks.length > 0 ? (
            <div
              className="absolute inset-y-8 right-0.5 z-10 w-3"
              role="group"
              aria-label="时间刻度"
            >
              {scrubMarks.map(function (mark) {
                return (
                  <Button
                    key={mark.key}
                    variant="ghost"
                    size="icon"
                    title={mark.label}
                    aria-label={`跳到 ${mark.label}`}
                    data-active={mark.key === activeKey}
                    className={[
                      'absolute right-0 h-0.5 w-2.5 min-w-0 -translate-y-1/2 rounded-full p-0',
                      'hover:w-3 hover:bg-primary focus-visible:w-3',
                      mark.key === activeKey ? 'w-3 bg-primary' : 'bg-border'
                    ].join(' ')}
                    style={{ top: `${total > 0 ? (mark.top / total) * 100 : 0}%` }}
                    onClick={function () {
                      jumpTo(mark.top)
                    }}
                  />
                )
              })}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

export { VirtualGrid }
export type { VirtualGridProps }
