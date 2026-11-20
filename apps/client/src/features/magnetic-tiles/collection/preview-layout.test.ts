import { describe, expect, it } from 'vitest'

import { findCollectionPreviewLayout } from '@/features/magnetic-tiles/collection/preview-layout'

interface FullGrid {
  size: MagneticTile.Size
  shape: MagneticTile.Shape
  direction: MagneticTile.Direction
  columns: number
  rows: number
  flow: 'row' | 'column'
}

const FULL: FullGrid[] = [
  { size: 1, shape: 'square', direction: 'horizontal', columns: 2, rows: 2, flow: 'row' },
  { size: 1, shape: 'square', direction: 'vertical', columns: 2, rows: 2, flow: 'column' },
  { size: 1, shape: 'circle', direction: 'horizontal', columns: 2, rows: 2, flow: 'row' },
  { size: 1, shape: 'circle', direction: 'vertical', columns: 2, rows: 2, flow: 'column' },
  { size: 1, shape: 'rectangle', direction: 'horizontal', columns: 4, rows: 1, flow: 'row' },
  { size: 1, shape: 'rectangle', direction: 'vertical', columns: 1, rows: 4, flow: 'column' },
  { size: 2, shape: 'square', direction: 'horizontal', columns: 3, rows: 3, flow: 'row' },
  { size: 2, shape: 'square', direction: 'vertical', columns: 3, rows: 3, flow: 'column' },
  { size: 2, shape: 'circle', direction: 'horizontal', columns: 3, rows: 3, flow: 'row' },
  { size: 2, shape: 'circle', direction: 'vertical', columns: 3, rows: 3, flow: 'column' },
  { size: 2, shape: 'rectangle', direction: 'horizontal', columns: 4, rows: 2, flow: 'row' },
  { size: 2, shape: 'rectangle', direction: 'vertical', columns: 2, rows: 4, flow: 'column' },
  { size: 3, shape: 'square', direction: 'horizontal', columns: 4, rows: 4, flow: 'row' },
  { size: 3, shape: 'square', direction: 'vertical', columns: 4, rows: 4, flow: 'column' },
  { size: 3, shape: 'circle', direction: 'horizontal', columns: 4, rows: 4, flow: 'row' },
  { size: 3, shape: 'circle', direction: 'vertical', columns: 4, rows: 4, flow: 'column' },
  { size: 3, shape: 'rectangle', direction: 'horizontal', columns: 4, rows: 2, flow: 'row' },
  { size: 3, shape: 'rectangle', direction: 'vertical', columns: 2, rows: 4, flow: 'column' },
  { size: 4, shape: 'square', direction: 'horizontal', columns: 5, rows: 5, flow: 'row' },
  { size: 4, shape: 'square', direction: 'vertical', columns: 5, rows: 5, flow: 'column' },
  { size: 4, shape: 'circle', direction: 'horizontal', columns: 5, rows: 5, flow: 'row' },
  { size: 4, shape: 'circle', direction: 'vertical', columns: 5, rows: 5, flow: 'column' },
  { size: 4, shape: 'rectangle', direction: 'horizontal', columns: 6, rows: 3, flow: 'row' },
  { size: 4, shape: 'rectangle', direction: 'vertical', columns: 3, rows: 6, flow: 'column' }
]

describe('findCollectionPreviewLayout', function () {
  it('gives every size and direction a grid that is not stuck at 2×2', function () {
    const shapes = new Set<string>()

    for (const entry of FULL) {
      const layout = findCollectionPreviewLayout(entry.size, entry.shape, entry.direction, 99)
      expect(layout, `Lv.${entry.size} ${entry.shape} ${entry.direction}`).toMatchObject({
        columns: entry.columns,
        rows: entry.rows,
        flow: entry.flow,
        count: entry.columns * entry.rows
      })
      shapes.add(`${entry.columns}x${entry.rows}`)
      if (entry.shape === 'circle') {
        expect(layout.frameScale).toBeCloseTo(0.7071, 3)
      } else {
        expect(layout.frameScale).toBe(1)
      }
    }

    expect(shapes.has('2x2')).toBe(true)
    expect(shapes.has('4x1')).toBe(true)
    expect(shapes.has('1x4')).toBe(true)
    expect(shapes.has('4x2')).toBe(true)
    expect(shapes.has('2x4')).toBe(true)
    expect(shapes.has('3x3')).toBe(true)
    expect(shapes.has('4x4')).toBe(true)
    expect(shapes.has('5x5')).toBe(true)
    expect(shapes.has('6x3')).toBe(true)
    expect(shapes.has('3x6')).toBe(true)
    expect(shapes.size).toBeGreaterThan(4)
  })

  it('spreads a wide Lv.2 collection across 4×2 instead of a floating 3×2', function () {
    const wide = findCollectionPreviewLayout(2, 'rectangle', 'horizontal', 6)
    const tall = findCollectionPreviewLayout(2, 'rectangle', 'vertical', 6)

    expect(wide).toMatchObject({
      columns: 4,
      rows: 2,
      flow: 'row',
      count: 6,
      cell: 63,
      padX: 7.9,
      padY: 8,
      gapX: 20.7,
      gapY: 8
    })
    expect(wide.gapX).toBeGreaterThan(wide.gapY)
    expect(tall).toMatchObject({
      columns: 2,
      rows: 4,
      flow: 'column',
      count: 6,
      cell: 63,
      gapX: 8,
      gapY: 20.7
    })
    expect(tall.gapY).toBeGreaterThan(tall.gapX)
  })

  it('grows icon cells when the same wide grid gets a larger tile', function () {
    const lv2 = findCollectionPreviewLayout(2, 'rectangle', 'horizontal', 8)
    const lv3 = findCollectionPreviewLayout(3, 'rectangle', 'horizontal', 8)

    expect(lv2).toMatchObject({ columns: 4, rows: 2, cell: 63 })
    expect(lv3).toMatchObject({ columns: 4, rows: 2, cell: 102, gapX: 26, gapY: 12 })
    expect(lv3.cell).toBeGreaterThan(lv2.cell + 20)
  })

  it('packs a size-1 strip into one row or one column', function () {
    expect(findCollectionPreviewLayout(1, 'rectangle', 'horizontal', 2)).toMatchObject({
      columns: 2,
      rows: 1,
      flow: 'row',
      count: 2
    })
    expect(findCollectionPreviewLayout(1, 'rectangle', 'horizontal', 6)).toMatchObject({
      columns: 4,
      rows: 1,
      count: 4,
      cell: 32
    })
    expect(findCollectionPreviewLayout(1, 'rectangle', 'vertical', 3)).toMatchObject({
      columns: 1,
      rows: 3,
      flow: 'column',
      count: 3
    })
  })

  it('keeps a vertical square from collapsing into a horizontal grid', function () {
    const horizontal = findCollectionPreviewLayout(2, 'square', 'horizontal', 6)
    const vertical = findCollectionPreviewLayout(2, 'square', 'vertical', 6)

    expect(horizontal).toMatchObject({ columns: 3, rows: 2, flow: 'row', count: 6 })
    expect(vertical).toMatchObject({ columns: 2, rows: 3, flow: 'column', count: 6 })
    expect(vertical.rows).toBeGreaterThan(vertical.columns)
  })

  it('uses a smaller circle frame and the same grid as the square', function () {
    const square = findCollectionPreviewLayout(4, 'square', 'horizontal', 30)
    const circle = findCollectionPreviewLayout(4, 'circle', 'horizontal', 30)

    expect(square).toMatchObject({ columns: 5, rows: 5, count: 25, frameScale: 1, cell: 50 })
    expect(circle.columns).toBe(square.columns)
    expect(circle.rows).toBe(square.rows)
    expect(circle.flow).toBe(square.flow)
    expect(circle.frameScale).toBeLessThan(1)
    expect(circle.cell).toBeLessThan(square.cell)
  })

  it('does not change another collection when this one is reflowed', function () {
    const other = findCollectionPreviewLayout(1, 'square', 'vertical', 4)
    const snapshot = { ...other }

    findCollectionPreviewLayout(4, 'rectangle', 'horizontal', 24)
    findCollectionPreviewLayout(1, 'rectangle', 'vertical', 9)

    expect(other).toEqual(snapshot)
  })
})
