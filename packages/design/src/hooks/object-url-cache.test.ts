import { describe, expect, it, vi } from 'vitest'

import { createObjectUrlCache } from './object-url-cache'

function makeFile(name: string): File {
  // node 环境没有 File 构造器时退化成带 name 的对象即可：缓存按身份取，不读内容
  if (typeof File === 'function') return new File(['x'], name, { type: 'image/png' })
  return { name } as unknown as File
}

function setup(capacity?: number) {
  let seed = 0
  const create = vi.fn(function () {
    seed += 1
    return `blob:test/${seed}`
  })
  const revoke = vi.fn()
  return { cache: createObjectUrlCache(create, revoke, capacity), create, revoke }
}

describe('createObjectUrlCache', () => {
  it('同一个 File 永远拿到同一串 URL，只创建一次', () => {
    const { cache, create } = setup()
    const file = makeFile('a.png')

    const first = cache.src(file)
    const second = cache.src(file)

    expect(second).toBe(first)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('不同 File 各自一串 URL', () => {
    const { cache } = setup()
    const a = makeFile('a.png')
    const b = makeFile('b.png')

    expect(cache.src(a)).not.toBe(cache.src(b))
  })

  it('超过容量后回收最久没用的那串，最近用过的保住', () => {
    const { cache, revoke } = setup(2)
    const a = makeFile('a.png')
    const b = makeFile('b.png')
    const c = makeFile('c.png')

    const urlA = cache.src(a)
    cache.src(b)
    // 摸一下 a：它变成最近用过，淘汰目标转向 b
    cache.src(a)
    const urlB = cache.src(b)
    cache.src(c)

    expect(revoke.mock.calls.map((call) => call[0])).toEqual([urlA])
    expect(cache.src(b)).toBe(urlB)
  })

  it('dispose 回收缓存里的全部 URL', () => {
    const { cache, revoke } = setup()
    const urlA = cache.src(makeFile('a.png'))
    const urlB = cache.src(makeFile('b.png'))

    cache.dispose()

    expect(revoke.mock.calls.map((call) => call[0])).toEqual([urlA, urlB])
  })

  it('dispose 之后再取会重新开一套（StrictMode 卸载再挂载）', () => {
    const { cache, create } = setup()
    const file = makeFile('a.png')
    const before = cache.src(file)

    cache.dispose()
    const after = cache.src(file)

    expect(after).not.toBe(before)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('dispose 幂等：重复调用不会重复回收', () => {
    const { cache, revoke } = setup()
    cache.src(makeFile('a.png'))

    cache.dispose()
    cache.dispose()

    expect(revoke).toHaveBeenCalledTimes(1)
  })
})
