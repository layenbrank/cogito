import { clsx, type ClassValue } from 'clsx'

type MarkerStyles = Record<string, string>
type Capacity = MagneticTile.Size

function markerClass(
  styles: MarkerStyles,
  size: MagneticTile.Size,
  shape: MagneticTile.Shape,
  direction: MagneticTile.Direction,
  ...extra: ClassValue[]
) {
  return clsx(styles.marker, styles[`lv${size}`], styles[shape], styles[direction], ...extra)
}

/** 有效信息容量：基础为 size，横矩形 +1（封顶 7）。大容量应展示更多字段，而非更大字号。 */
function findCapacity(
  size: MagneticTile.Size,
  shape: MagneticTile.Shape,
  direction: MagneticTile.Direction
): Capacity {
  if (shape === 'rectangle' && direction === 'horizontal' && size < 7) {
    return (size + 1) as Capacity
  }
  return size
}

function isWide(shape: MagneticTile.Shape, direction: MagneticTile.Direction) {
  return shape === 'rectangle' && direction === 'horizontal'
}

export { findCapacity, isWide, markerClass }
export type { Capacity }
