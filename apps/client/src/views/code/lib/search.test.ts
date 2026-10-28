import { describe, expect, it } from 'vitest'

import { preserveCase } from './search.ts'

describe('preserveCase', function () {
  it('全大写命中 → 全大写替换', function () {
    expect(preserveCase('NAME', 'thing')).toBe('THING')
  })

  it('全小写命中 → 全小写替换', function () {
    expect(preserveCase('name', 'Thing')).toBe('thing')
  })

  it('Title Case → 首字母大写', function () {
    expect(preserveCase('Name', 'thing')).toBe('Thing')
  })

  it('混合大小写按位映射', function () {
    expect(preserveCase('nAmE', 'thing')).toBe('tHiNG')
  })
})
