/** 磁贴在容器网格里占的格子数：方/圆是 size×size，矩形按方向翻倍 */
export interface GridSpan {
  w: number
  h: number
}

export function findGridSpan(tile: Pick<MagneticTile, 'size' | 'shape' | 'direction'>): GridSpan {
  const size = Math.max(1, tile.size)

  if (tile.shape !== 'rectangle') return { w: size, h: size }

  return tile.direction === 'vertical' ? { w: size, h: size * 2 } : { w: size * 2, h: size }
}
