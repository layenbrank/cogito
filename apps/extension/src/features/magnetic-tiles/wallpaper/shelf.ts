/**
 * 壁纸库磁贴的画册格。
 *
 * 图铺满格子，格子之间留 1px 缝。圆形先收进内切方框，角上的图才不会被圆裁掉。
 * 装不下的张数不缩成一条，最后一格改成剩余数量。
 *
 * | 尺寸 | 方形 / 圆形 | 横条 | 竖条 |
 * | --- | --- | --- | --- |
 * | 1 | 2×2 | 4×1 | 1×4 |
 * | 2 | 3×2 | 4×2 | 2×4 |
 * | 3 | 3×3 | 6×2 | 2×6 |
 * | 4 | 4×4 | 6×3 | 3×6 |
 */
interface WallpaperShelf {
  columns: number
  rows: number
  clipsCircle: boolean
}

function findWallpaperShelf(
  size: MagneticTile.Size,
  shape: MagneticTile.Shape,
  direction: MagneticTile.Direction
): WallpaperShelf {
  const clipsCircle = shape === 'circle'
  if (shape === 'rectangle' && direction === 'horizontal') {
    if (size === 1) return { columns: 4, rows: 1, clipsCircle }
    if (size === 2) return { columns: 4, rows: 2, clipsCircle }
    if (size === 3) return { columns: 6, rows: 2, clipsCircle }
    return { columns: 6, rows: 3, clipsCircle }
  }
  if (shape === 'rectangle' && direction === 'vertical') {
    if (size === 1) return { columns: 1, rows: 4, clipsCircle }
    if (size === 2) return { columns: 2, rows: 4, clipsCircle }
    if (size === 3) return { columns: 2, rows: 6, clipsCircle }
    return { columns: 3, rows: 6, clipsCircle }
  }
  if (size === 1) return { columns: 2, rows: 2, clipsCircle }
  if (size === 2) return { columns: 3, rows: 2, clipsCircle }
  if (size === 4) return { columns: 4, rows: 4, clipsCircle }
  return { columns: 3, rows: 3, clipsCircle }
}

export { findWallpaperShelf }
export type { WallpaperShelf }
