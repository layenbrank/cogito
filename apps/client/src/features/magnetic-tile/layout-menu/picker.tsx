import { clsx } from 'clsx'
import { useId, useState } from 'react'

import { findMarkerBox } from '@/features/magnetic-tile/size'
import { useMirrorStore } from '@/stores/mirror'

import styles from './layout-menu.module.scss'
import type { Tile } from './types'

type ShapeOption = Pick<MagneticTile, 'shape' | 'direction'> & {
  label: string
}

type Draft = Pick<MagneticTile, 'size' | 'shape' | 'direction'>

interface PickerProps {
  tile: Tile
}

/** 形状缩略图固定按 size=1 比例绘制，避免菜单抖动 */
const THUMB_SIZE: MagneticTile.Size = 1
/** 矩形长边；短边由磁贴比例推导，横/竖条互为旋转 */
const THUMB_LONG = 28
/** 圆形略放大，补偿同等直径看起来更小的视错觉 */
const CIRCLE_OPTICAL = 1.08
const SIZE_BASE = 10
const SIZE_STEP = 3

const SIZES: MagneticTile.Size[] = [1, 2, 3, 4]

const SHAPES: ShapeOption[] = [
  { shape: 'square', direction: 'horizontal', label: '方形' },
  { shape: 'circle', direction: 'horizontal', label: '圆形' },
  { shape: 'rectangle', direction: 'horizontal', label: '横条' },
  { shape: 'rectangle', direction: 'vertical', label: '竖条' }
]

function findThumbSize(
  shape: MagneticTile.Shape,
  direction: MagneticTile.Direction
): { width: number; height: number } {
  const rect = findMarkerBox({
    size: THUMB_SIZE,
    shape: 'rectangle',
    direction: 'horizontal'
  })
  const scale = THUMB_LONG / Math.max(rect.w, rect.h)
  const long = Math.max(8, Math.round(rect.w * scale))
  const short = Math.max(8, Math.round(rect.h * scale))

  if (shape === 'rectangle') {
    if (direction === 'vertical') return { width: short, height: long }
    return { width: long, height: short }
  }

  const side = Math.max(8, Math.round(Math.sqrt(long * short)))
  if (shape === 'circle') {
    const optical = Math.max(8, Math.round(side * CIRCLE_OPTICAL))
    return { width: optical, height: optical }
  }
  return { width: side, height: side }
}

function ShapeThumb(props: { shape: MagneticTile.Shape; direction: MagneticTile.Direction }) {
  const size = findThumbSize(props.shape, props.direction)

  return (
    <span
      className={clsx(styles.thumb, styles[props.shape])}
      style={size}
      aria-hidden="true"
    />
  )
}

function SizeThumb(props: { size: MagneticTile.Size }) {
  const side = SIZE_BASE + (props.size - 1) * SIZE_STEP

  return (
    <span
      className={clsx(styles.thumb, styles.square)}
      style={{ width: side, height: side }}
      aria-hidden="true"
    />
  )
}

function isShapeActive(draft: Draft, option: ShapeOption) {
  if (draft.shape !== option.shape) return false
  if (option.shape === 'rectangle') return draft.direction === option.direction
  return true
}

function findDirection(draft: Draft, option: ShapeOption): MagneticTile.Direction {
  if (option.shape === 'rectangle') return option.direction
  if (draft.shape === option.shape) return draft.direction
  return 'horizontal'
}

function updateTile(tile: Tile, change: MagneticTile.Change) {
  if (!tile.id) return
  void useMirrorStore.getState().toUpdateMagneticTile([
    {
      key: tile.id,
      change
    }
  ])
}

function parseDraft(tile: Tile): Draft {
  return {
    size: tile.size,
    shape: tile.shape,
    direction: tile.direction
  }
}

function LayoutPicker(props: PickerProps) {
  const { tile } = props
  const [draft, setDraft] = useState(function () {
    return parseDraft(tile)
  })
  const sizeId = useId()
  const shapeId = useId()

  function onPickSize(value: MagneticTile.Size) {
    if (value === draft.size) return
    setDraft(function (prev) {
      return { ...prev, size: value }
    })
    updateTile(tile, { size: value })
  }

  function onPickShape(option: ShapeOption) {
    const direction = findDirection(draft, option)
    const isSame =
      draft.shape === option.shape &&
      (option.shape !== 'rectangle' || draft.direction === direction)
    if (isSame) return
    setDraft(function (prev) {
      return { ...prev, shape: option.shape, direction }
    })
    updateTile(tile, {
      shape: option.shape,
      direction
    })
  }

  return (
    <div
      className={styles.picker}
      onPointerDown={function (event) {
        event.stopPropagation()
      }}>
      <section
        className={styles.section}
        aria-labelledby={sizeId}>
        <header className={styles.header}>
          <span
            className={styles.caption}
            id={sizeId}>
            大小
          </span>
          <span className={styles.hint}>Lv.{draft.size}</span>
        </header>
        <div
          className={styles.sizes}
          role="group"
          aria-labelledby={sizeId}>
          {SIZES.map(function (value) {
            const caption = `大小 ${value}`
            return (
              <button
                key={value}
                type="button"
                title={caption}
                aria-label={caption}
                aria-pressed={draft.size === value}
                className={clsx(styles.size, draft.size === value && styles.selected)}
                onClick={function () {
                  onPickSize(value)
                }}>
                <SizeThumb size={value} />
                <span className={styles.digit}>{value}</span>
              </button>
            )
          })}
        </div>
      </section>

      <hr className={styles.line} />

      <section
        className={styles.section}
        aria-labelledby={shapeId}>
        <header className={styles.header}>
          <span
            className={styles.caption}
            id={shapeId}>
            形状
          </span>
        </header>
        <div
          className={styles.shapes}
          role="group"
          aria-labelledby={shapeId}>
          {SHAPES.map(function (option) {
            return (
              <button
                key={`${option.shape}-${option.direction}`}
                type="button"
                aria-label={option.label}
                aria-pressed={isShapeActive(draft, option)}
                className={clsx(styles.shape, isShapeActive(draft, option) && styles.selected)}
                onClick={function () {
                  onPickShape(option)
                }}>
                <ShapeThumb
                  shape={option.shape}
                  direction={option.direction}
                />
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

export { LayoutPicker }
