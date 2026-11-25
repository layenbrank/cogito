import { describe, expect, it } from 'vitest'

import { MAX_ENTRIES, createSessionRegistry } from './session-registry'

describe('session registry', function () {
  it('登记 / 查找 / 按 session 反查删除', function () {
    const registry = createSessionRegistry()
    registry.remember('t1', 's1')
    expect(registry.find('t1')).toBe('s1')

    registry.forgetSession('s1')
    expect(registry.find('t1')).toBeNull()
  })

  it('同一线程重新登记会覆盖', function () {
    const registry = createSessionRegistry()
    registry.remember('t1', 's1')
    registry.remember('t1', 's2')
    expect(registry.find('t1')).toBe('s2')
    expect(registry.size()).toBe(1)
  })

  it('超过上限时淘汰最久未用的一条', function () {
    const registry = createSessionRegistry()
    for (let index = 0; index < MAX_ENTRIES + 1; index += 1) {
      registry.remember(`t${index}`, `s${index}`)
    }
    expect(registry.size()).toBe(MAX_ENTRIES)
    expect(registry.find('t0')).toBeNull()
    expect(registry.find(`t${MAX_ENTRIES}`)).toBe(`s${MAX_ENTRIES}`)
  })
})
