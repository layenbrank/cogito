import { describe, expect, it } from 'vitest'

import { findWallpaperShelf } from './shelf'

const CASES: Array<{
  size: MagneticTile.Size
  shape: MagneticTile.Shape
  direction: MagneticTile.Direction
  columns: number
  rows: number
}> = [
  { size: 1, shape: 'square', direction: 'horizontal', columns: 2, rows: 2 },
  { size: 2, shape: 'square', direction: 'vertical', columns: 3, rows: 2 },
  { size: 3, shape: 'circle', direction: 'horizontal', columns: 3, rows: 3 },
  { size: 4, shape: 'square', direction: 'horizontal', columns: 4, rows: 4 },
  { size: 1, shape: 'rectangle', direction: 'horizontal', columns: 4, rows: 1 },
  { size: 2, shape: 'rectangle', direction: 'horizontal', columns: 4, rows: 2 },
  { size: 3, shape: 'rectangle', direction: 'horizontal', columns: 6, rows: 2 },
  { size: 4, shape: 'rectangle', direction: 'horizontal', columns: 6, rows: 3 },
  { size: 1, shape: 'rectangle', direction: 'vertical', columns: 1, rows: 4 },
  { size: 2, shape: 'rectangle', direction: 'vertical', columns: 2, rows: 4 },
  { size: 4, shape: 'rectangle', direction: 'vertical', columns: 3, rows: 6 }
]

describe('wallpaper shelf', function () {
  it('picks a contact sheet for each size and direction', function () {
    for (const sample of CASES) {
      const shelf = findWallpaperShelf(sample.size, sample.shape, sample.direction)
      expect(shelf.columns).toBe(sample.columns)
      expect(shelf.rows).toBe(sample.rows)
      expect(shelf.clipsCircle).toBe(sample.shape === 'circle')
    }
  })
})
