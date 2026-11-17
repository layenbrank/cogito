/**
 * 集合嵌套的入口约束：**集合里只能放网址**（产品口径 2026-11-17）。
 *
 * 这两个用例锁的是「菜单里还能不能选」——以前只挡成环，集合仍可作为成员被移进另一个集合，
 * 而集合页没有对应的浏览入口，用户看到的是「东西少了」。
 */
import { describe, expect, it } from 'vitest'

import { buildItems, type TileMenuContext } from './items'
import type { Tile } from './types'

function tile(overrides: Partial<Tile> & { id: string }): Tile {
  return {
    title: overrides.id,
    size: 1,
    shape: 'square',
    direction: 'vertical',
    component: 'navigation',
    collectionID: null,
    ...overrides
  } as Tile
}

function context(partial: Partial<TileMenuContext> & { tile: Tile }): TileMenuContext {
  return {
    targets: [partial.tile],
    collections: [],
    onCreateCollection: function () {},
    onMoveToCollection: function () {},
    onLeaveCollection: function () {},
    onDelete: function () {},
    ...partial
  }
}

function findItem(items: ReturnType<typeof buildItems>, key: string) {
  return items.find(function (item) {
    return item.key === key
  })
}

describe('集合不能嵌套集合', function () {
  it('右键集合时，选中的集合不算进「加入此集合」', function () {
    const folder = tile({ id: 'f1', component: 'collection' })
    const nested = tile({ id: 'f2', component: 'collection', collectionID: 'other' })
    const url = tile({ id: 'n1' })
    const items = buildItems(
      context({ tile: folder, targets: [folder, nested, url], collections: [folder, nested] })
    )

    const join = findItem(items, 'join-current')
    expect(join?.label).toBe('将所选 1 项加入此集合')
    expect(join?.disabled).toBe(false)
  })

  it('只选中集合时「加入此集合」不可用（没有合法成员）', function () {
    const folder = tile({ id: 'f1', component: 'collection' })
    const other = tile({ id: 'f2', component: 'collection' })
    const items = buildItems(
      context({ tile: folder, targets: [folder, other], collections: [folder, other] })
    )

    expect(findItem(items, 'join-current')?.disabled).toBe(true)
  })
})
