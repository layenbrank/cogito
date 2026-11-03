import { describe, expect, it } from 'vitest'

import { parseJsonc, stripJsonc } from '@/views/code/lib/jsonc.ts'

describe('parseJsonc', function () {
  it('剥掉行注释与块注释', function () {
    const result = parseJsonc(`{
      // 行注释
      "a": 1, /* 块注释 */
      "b": [2, 3]
    }`)
    expect(result).toEqual({ ok: true, value: { a: 1, b: [2, 3] } })
  })

  it('删除对象与数组尾逗号', function () {
    const result = parseJsonc('{"a":[1,2,], "b":{"c":1,},}')
    expect(result).toEqual({ ok: true, value: { a: [1, 2], b: { c: 1 } } })
  })

  it('字符串里的 // 与 /* 不误伤', function () {
    const result = parseJsonc('{"url":"https://a/b","glob":"src/*","x":"a//b"}')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ url: 'https://a/b', glob: 'src/*', x: 'a//b' })
    }
  })

  it('空文件与非法 JSON 返回 ok:false', function () {
    expect(parseJsonc('   ').ok).toBe(false)
    expect(parseJsonc('{"a": }').ok).toBe(false)
    expect(parseJsonc('{a:1}').ok).toBe(false)
  })

  it('stripJsonc 保留字符串内容', function () {
    expect(stripJsonc('{"a":"x,}", // c\n"b":1,}')).toBe('{"a":"x,}", \n"b":1}')
  })
})
