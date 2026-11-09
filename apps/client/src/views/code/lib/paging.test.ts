import { describe, expect, it } from 'vitest'

import {
  EXPLORER_PAGE_SIZE,
  appendUniqueEntries,
  findLoadMoreTitle,
  makeLoadMoreKey,
  paginateEntries,
  toLoadMoreParentKey
} from '@/views/code/lib/paging.ts'

const ALL = Array.from({ length: 450 }, function (_item, index) {
  return `entry-${index}`
})

describe('paginateEntries', function () {
  it('首屏取满一页并标记还有更多', function () {
    const page = paginateEntries(ALL, 0, EXPLORER_PAGE_SIZE)
    expect(page.entries).toHaveLength(EXPLORER_PAGE_SIZE)
    expect(page.entries[0]).toBe('entry-0')
    expect(page.entries[EXPLORER_PAGE_SIZE - 1]).toBe(`entry-${EXPLORER_PAGE_SIZE - 1}`)
    expect(page.isTruncated).toBe(true)
    expect(page.nextOffset).toBe(EXPLORER_PAGE_SIZE)
    expect(page.total).toBe(450)
  })

  it('offset 连续：三次翻页拼起来等于全量且无重复', function () {
    const collected: string[] = []
    let offset = 0
    let guard = 0
    while (guard < 10) {
      guard += 1
      const page = paginateEntries(ALL, offset, EXPLORER_PAGE_SIZE)
      collected.push(...page.entries)
      offset = page.nextOffset
      if (!page.isTruncated) break
    }
    expect(collected).toHaveLength(450)
    expect(new Set(collected).size).toBe(450)
    expect(collected).toEqual(ALL)
  })

  it('最后一页 isTruncated=false，nextOffset 到底', function () {
    const page = paginateEntries(ALL, 400, EXPLORER_PAGE_SIZE)
    expect(page.entries).toHaveLength(50)
    expect(page.isTruncated).toBe(false)
    expect(page.nextOffset).toBe(450)
  })

  it('越界 offset 返回空页，不抛错', function () {
    const page = paginateEntries(ALL, 999, 10)
    expect(page.entries).toEqual([])
    expect(page.isTruncated).toBe(false)
    expect(page.nextOffset).toBe(999)
  })

  it('limit 非法时回落到默认分页大小', function () {
    const page = paginateEntries(ALL, 0, Number.NaN)
    expect(page.entries).toHaveLength(EXPLORER_PAGE_SIZE)
  })

  it('空目录给出空页而不是 hasMore', function () {
    const page = paginateEntries([] as string[], 0, EXPLORER_PAGE_SIZE)
    expect(page.entries).toEqual([])
    expect(page.isTruncated).toBe(false)
    expect(page.total).toBe(0)
  })
})

describe('appendUniqueEntries', function () {
  it('按 path 去重且保持原顺序', function () {
    const previous = [{ path: 'a' }, { path: 'b' }]
    const next = [{ path: 'b' }, { path: 'c' }]
    expect(appendUniqueEntries(previous, next)).toEqual([
      { path: 'a' },
      { path: 'b' },
      { path: 'c' }
    ])
  })

  it('next 为空时返回 previous 的浅拷贝（不改原数组）', function () {
    const previous = [{ path: 'a' }]
    const merged = appendUniqueEntries(previous, [])
    expect(merged).toEqual(previous)
    expect(merged).not.toBe(previous)
  })
})

describe('「显示更多」哨兵 key', function () {
  it('往返可还原父目录 key', function () {
    const parent = '0::node_modules'
    expect(toLoadMoreParentKey(makeLoadMoreKey(parent))).toBe(parent)
  })

  it('真实路径不会被误判成哨兵', function () {
    expect(toLoadMoreParentKey('0::src/index.ts')).toBeNull()
    expect(toLoadMoreParentKey('0::')).toBeNull()
  })

  it('文案带剩余条数', function () {
    expect(findLoadMoreTitle(120)).toBe('显示更多（还有 120 项）')
    expect(findLoadMoreTitle(0)).toBe('显示更多')
  })
})
