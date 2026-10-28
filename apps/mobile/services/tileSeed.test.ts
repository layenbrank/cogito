import { createSeedTiles } from '@/services/tileSeed'

describe('tileSeed', () => {
  test('creates navigation clock knowledge and agent tiles', () => {
    const tiles = createSeedTiles()
    const components = tiles.map((tile) => tile.component)
    expect(components).toContain('navigation')
    expect(components).toContain('clock')
    expect(components).toContain('knowledge')
    expect(components).toContain('agent')
    expect(tiles.some((tile) => /todo/i.test(tile.title))).toBe(false)
  })
})
