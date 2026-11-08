import { describe, expect, it } from 'vitest'

import { DEMO_WIKI_FILES, DEMO_WIKI_NAME } from '@/views/knowledge/lib/demo-wiki.ts'

describe('demo-wiki', function () {
  it('includes Chinese purpose schema sources and wiki pages', function () {
    const relatives = DEMO_WIKI_FILES.map(function (file) {
      return file.relative
    })
    expect(DEMO_WIKI_NAME).toContain('示例')
    expect(relatives).toContain('purpose.md')
    expect(relatives).toContain('schema.md')
    expect(relatives.some(function (path) {
      return path.startsWith('raw/sources/')
    })).toBe(true)
    expect(relatives.some(function (path) {
      return path.startsWith('wiki/concepts/')
    })).toBe(true)
    const purpose = DEMO_WIKI_FILES.find(function (file) {
      return file.relative === 'purpose.md'
    })
    expect(purpose?.content).toMatch(/项目意图/)
    expect(purpose?.content).toMatch(/[\u4e00-\u9fff]/)
  })
})
