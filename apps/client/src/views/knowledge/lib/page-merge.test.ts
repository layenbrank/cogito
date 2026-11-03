import { describe, expect, it } from 'vitest'

import { mergePageContent } from '@/views/knowledge/lib/page-merge.ts'

describe('mergePageContent', function () {
  it('合并 sources 并保留既有正文', function () {
    const existing = `---
title: A
type: concept
sources: ["raw/sources/a.md"]
---

# A

old
`
    const incoming = `---
title: A
type: concept
sources: ["raw/sources/b.md"]
---

# A

new
`
    const merged = mergePageContent(existing, incoming)
    expect(merged).toContain('raw/sources/a.md')
    expect(merged).toContain('raw/sources/b.md')
    expect(merged).toContain('new')
    expect(merged).toContain('既有内容保留')
  })
})
