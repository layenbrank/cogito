import { Icon } from '@iconify/react/offline'
import { Skeleton } from '@cogito/design/components/skeleton'
import { clsx } from 'clsx'
import { useState, type CSSProperties, type DragEvent } from 'react'

import styles from '@/views/morph/workspace/tasks/stage/merge-board.module.scss'
import { useBoardScale } from '@/views/morph/workspace/tasks/stage/use-board-scale.ts'

const THUMB_BASE = 160

type MergeBoardProps = {
  inputs: string[]
  covers: Record<string, string>
  isCoverLoading?: boolean
  onReorder: (from: number, to: number) => void
  onRemove: (index: number) => void
  onAdd: () => void
  className?: string
}

function findFileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path
}

function MergeBoard(props: MergeBoardProps) {
  const {
    inputs,
    covers,
    isCoverLoading,
    onReorder,
    onRemove,
    onAdd,
    className
  } = props
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const { boardScale, rootRef, resetScale } = useBoardScale()
  const gridStyle = {
    '--board-thumb-min': `${Math.round(THUMB_BASE * boardScale)}px`
  } as CSSProperties

  function onDragStart(index: number) {
    return function (event: DragEvent) {
      setDragIndex(index)
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', String(index))
    }
  }

  function onDragOver(index: number) {
    return function (event: DragEvent) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (overIndex !== index) setOverIndex(index)
    }
  }

  function onDrop(index: number) {
    return function (event: DragEvent) {
      event.preventDefault()
      const from = Number(event.dataTransfer.getData('text/plain'))
      if (Number.isFinite(from) && from !== index) onReorder(from, index)
      setDragIndex(null)
      setOverIndex(null)
    }
  }

  function onDragEnd() {
    setDragIndex(null)
    setOverIndex(null)
  }

  return (
    <div
      ref={rootRef}
      className={clsx(styles.board, styles.root, className)}>
      {boardScale !== 1 ? (
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
      ) : null}
      <div
        className={styles.grid}
        style={gridStyle}>
        {inputs.map(function (path, index) {
          const cover = covers[path]
          return (
            <div
              key={path}
              className={clsx(
                styles.card,
                dragIndex === index && styles.dragging,
                overIndex === index && dragIndex !== index && styles.dropTarget
              )}
              draggable
              onDragStart={onDragStart(index)}
              onDragOver={onDragOver(index)}
              onDrop={onDrop(index)}
              onDragEnd={onDragEnd}>
              <div className={styles.thumb}>
                {cover ? (
                  <img
                    src={`data:image/png;base64,${cover}`}
                    alt={findFileName(path)}
                    draggable={false}
                  />
                ) : isCoverLoading ? (
                  <Skeleton className={styles.skeleton} />
                ) : (
                  <Icon
                    icon="ant-design:file-pdf-outlined"
                    width={36}
                    height={36}
                  />
                )}
                <span
                  className={styles.handle}
                  aria-hidden>
                  <Icon
                    icon="ant-design:holder-outlined"
                    width={12}
                    height={12}
                  />
                </span>
                <span className={styles.index}>{index + 1}</span>
                <button
                  type="button"
                  className={styles.remove}
                  aria-label="移除"
                  onClick={function (event) {
                    event.stopPropagation()
                    onRemove(index)
                  }}>
                  <Icon
                    icon="ant-design:close-outlined"
                    width={12}
                    height={12}
                  />
                </button>
              </div>
              <span
                className={styles.name}
                title={findFileName(path)}>
                {findFileName(path)}
              </span>
            </div>
          )
        })}
        <button
          type="button"
          className={styles.addTile}
          onClick={onAdd}>
          <span className={styles.addIcon}>
            <Icon
              icon="ant-design:file-add-outlined"
              width={28}
              height={28}
            />
          </span>
          <span>添加 PDF</span>
        </button>
      </div>
      <p className={styles.hint}>拖拽调整顺序 · Ctrl + 滚轮缩放</p>
    </div>
  )
}

export { MergeBoard }
export type { MergeBoardProps }
