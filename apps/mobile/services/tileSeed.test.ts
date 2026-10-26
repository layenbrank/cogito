import { createSeedTiles } from '@/services/tileSeed'

describe('tileSeed', () => {
  test('creates navigation clock knowledge and intelligence tiles', () => {
    const tiles = createSeedTiles()
    const components = tiles.map((tile) => tile.component)
    expect(components).toContain('navigation')
    expect(components).toContain('clock')
    expect(components).toContain('knowledge')
    expect(components).toContain('intelligence')
    expect(tiles.some((tile) => /todo/i.test(tile.title))).toBe(false)
  })
})
