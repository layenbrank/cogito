import { describe, expect, it } from 'vitest'

import {
  WIKI_TEMPLATE_GENERAL,
  WIKI_TEMPLATES,
  findWikiTemplate
} from '@/views/knowledge/lib/wiki-templates.ts'

describe('wiki-templates', function () {
  it('exposes five scene templates', function () {
    expect(WIKI_TEMPLATES.map(function (item) {
      return item.id
    })).toEqual(['research', 'reading', 'personal', 'business', 'general'])
  })

  it('falls back to general for unknown id', function () {
    expect(findWikiTemplate('nope').id).toBe(WIKI_TEMPLATE_GENERAL)
  })

  it('ships non-empty Chinese purpose and schema for each template', function () {
    for (const template of WIKI_TEMPLATES) {
      expect(template.purpose.length).toBeGreaterThan(80)
      expect(template.schema.length).toBeGreaterThan(80)
      expect(template.purpose).toMatch(/项目意图|目标|研究问题|关键问题/)
      expect(template.schema).toMatch(/Wiki 结构|页面类型/)
      expect(template.purpose).toMatch(/[\u4e00-\u9fff]/)
      expect(template.schema).toMatch(/[\u4e00-\u9fff]/)
    }
  })
})
