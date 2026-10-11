import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Skeleton } from '@i-thinking/design/components/skeleton'
import { clsx } from 'clsx'
import { useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import type { CSSProperties, ReactNode } from 'react'

import styles from '@/views/morph/workspace/tasks/stage/page-board.module.scss'
import { useBoardScale } from '@/views/morph/workspace/tasks/stage/use-board-scale.ts'

const GROUP_PALETTE_SIZE = 6
const THUMB_BASE = 168

type PageBoardProps = {
  thumbnails: Morph.Render[]
  count: number
  selectedOffsets?: ReadonlySet<number>
  /** 返回分组序号（0-based），用于拆分「固定页数」着色 */
  resolveGroup?: (offset: number) => number | null
  /** 页卡底部标签；默认原稿页码。整理重排时传网格序号 */
  offsetLabel?: (offset: number, gridIndex: number) => string
  isLoading?: boolean
  hasError?: boolean
  onRetry?: () => void
  emptyText?: string
  onOffsetClick?: (offset: number) => void
  banner?: ReactNode
  className?: string
}

function PageBoard(props: PageBoardProps) {
  const {
    thumbnails,
    count,
    selectedOffsets,
    resolveGroup,
    offsetLabel,
    isLoading,
    hasError,
    onRetry,
    emptyText = '请先打开 PDF',
    onOffsetClick,
    banner,
    className
  } = props
  const isReducedMotion = useReducedMotion()
  const isFewPages = count > 0 && count <= 3
  const { boardScale, rootRef, resetScale } = useBoardScale()
  const thumbMin = Math.round(THUMB_BASE * boardScale)
  const gridStyle = {
    '--board-thumb-min': `${thumbMin}px`
  } as CSSProperties

  function renderScaleChip() {
    if (boardScale === 1) return null
    return (
      <button
        type="button"
        className={styles.scaleChip}
        title="双击复位缩放"
        onDoubleClick={resetScale}
        onClick={resetScale}>
        <Icon
          icon="ant-design:zoom-in-outlined"
          width={12}
          height={12}
        />
        {Math.round(boardScale * 100)}%
      </button>
    )
  }

  if (!count) {
    return (
      <div
        ref={rootRef}
        className={clsx(styles.board, styles.root, className)}>
        <div className={styles.empty}>
          <span>{emptyText}</span>
        </div>
      </div>
    )
  }

  if (hasError) {
    return (
      <div
        ref={rootRef}
        className={clsx(styles.board, styles.root, className)}>
        <div className={styles.empty}>
          <span>缩略图加载失败</span>
          {onRetry ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}>
              <Icon
                icon="ant-design:reload-outlined"
                className="size-3.5"
              />
              重试
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  if (isLoading || thumbnails.length === 0) {
    return (
      <div
        ref={rootRef}
        className={clsx(styles.board, styles.root, className)}>
        <div
          className={clsx(styles.grid, isFewPages && styles.gridSparse)}
          style={gridStyle}>
          {Array.from({ length: Math.min(count, 8) }).map(function (_, i) {
            return (
              <Skeleton
                key={i}
                className={styles.skeleton}
              />
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className={clsx(styles.board, styles.root, className)}>
      {banner ? <div className={styles.banner}>{banner}</div> : null}
      {renderScaleChip()}
      <ul
        className={clsx(styles.grid, isFewPages && styles.gridSparse)}
        style={gridStyle}>
        {thumbnails.map(function (image, index) {
          const offset = image.offset
          const isSelected = selectedOffsets?.has(offset) ?? false
          const group = resolveGroup?.(offset) ?? null
          const label = offsetLabel
            ? offsetLabel(offset, index)
            : String(offset + 1)
          return (
            <li key={offset}>
            <m.button
              type="button"
              aria-pressed={selectedOffsets ? isSelected : undefined}
              className={clsx(
                styles.card,
                isSelected && styles.cardSelected,
                group !== null && styles.cardGrouped
              )}
              data-group={
                group !== null ? String(group % GROUP_PALETTE_SIZE) : undefined
              }
              initial={
                isReducedMotion ? false : { opacity: 0, scale: 0.94, y: 10 }
              }
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{
                duration: isReducedMotion ? 0 : 0.28,
                delay: isReducedMotion ? 0 : Math.min(index, 12) * 0.04,
                ease: [0.22, 1, 0.36, 1]
              }}
              onClick={function () {
                onOffsetClick?.(offset)
              }}>
              <div className={styles.paper}>
                <img
                  className={styles.img}
                  src={`data:image/png;base64,${image.base64}`}
                  alt={`第 ${offset + 1} 页`}
                  draggable={false}
                />
                <span className={styles.badge}>{label}</span>
                {isSelected ? (
                  <span
                    className={styles.check}
                    aria-hidden>
                    <Icon
                      icon="ant-design:check-outlined"
                      width={12}
                      height={12}
                    />
                  </span>
                ) : null}
                {group !== null ? (
                  <span className={styles.groupBadge}>组 {group + 1}</span>
                ) : null}
              </div>
            </m.button>
            </li>
          )
        })}
      </ul>
      <p className={styles.hint}>Ctrl + 滚轮缩放预览</p>
    </div>
  )
}

export { PageBoard }
export type { PageBoardProps }
