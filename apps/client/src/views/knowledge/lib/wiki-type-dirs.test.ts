import { describe, expect, it } from 'vitest'

import {
  buildTypedWikiPath,
  findWikiDirForType,
  findWikiTypeInContent,
  toTypedWikiRelative
} from '@/views/knowledge/lib/wiki-type-dirs.ts'

describe('findWikiDirForType', function () {
  it('已知类型映射到规范目录', function () {
    expect(findWikiDirForType('concept')).toBe('wiki/concepts')
    expect(findWikiDirForType('note')).toBe('wiki/notes')
    expect(findWikiDirForType('CONCEPT')).toBe('wiki/concepts')
  })

  it('模板类型也有固定目录', function () {
    expect(findWikiDirForType('chapter')).toBe('wiki/chapters')
    expect(findWikiDirForType('plot-thread')).toBe('wiki/plot-threads')
    expect(findWikiDirForType('stakeholder')).toBe('wiki/stakeholders')
  })

  it('未知类型回退 wiki/ 根（由 lint 报缺 type）', function () {
    expect(findWikiDirForType('claim')).toBe('wiki')
  })
})

describe('buildTypedWikiPath', function () {
  it('按类型拼出落点并压 slug', function () {
    expect(buildTypedWikiPath('concept', '本地 优先')).toBe('wiki/concepts/本地-优先.md')
  })
})

describe('findWikiTypeInContent', function () {
  it('读 frontmatter type，非法值当没有', function () {
    expect(findWikiTypeInContent('---\ntype: entity\n---\n正文')).toBe('entity')
    expect(findWikiTypeInContent('---\ntype: claim\n---\n正文')).toBeNull()
    expect(findWikiTypeInContent('没有 frontmatter')).toBeNull()
  })
})

describe('toTypedWikiRelative', function () {
  it('根级页按 type 重定向，聚合页与已有子目录不动', function () {
    expect(toTypedWikiRelative('wiki/本地优先.md', 'concept')).toBe(
      'wiki/concepts/本地优先.md'
    )
    expect(toTypedWikiRelative('wiki/随手记.md', null)).toBe('wiki/notes/随手记.md')
    expect(toTypedWikiRelative('wiki/concepts/already.md', 'entity')).toBe(
      'wiki/concepts/already.md'
    )
    expect(toTypedWikiRelative('wiki/index.md', 'concept')).toBe('wiki/index.md')
    expect(toTypedWikiRelative('raw/sources/a.md', 'concept')).toBe('raw/sources/a.md')
  })
})
