import { describe, expect, it } from 'vitest'

import { mergeFileHits } from '@/views/code/workspace/file-hits.ts'

describe('mergeFileHits', function () {
  it('顺序为已打开 → 最近 → 搜索，且按绝对路径去重', function () {
    const merged = mergeFileHits({
      open: [{ absolute: 'C:/repo/a.ts', name: 'a.ts', relative: 'a.ts', isOpen: true }],
      recent: [
        { absolute: 'C:/repo/b.ts', name: 'b.ts', relative: 'b.ts' },
        { absolute: 'c:/repo/A.ts', name: 'a.ts', relative: 'a.ts' }
      ],
      search: [
        { absolute: 'C:/repo/c.ts', name: 'c.ts', relative: 'c.ts' },
        { absolute: 'C:/repo/b.ts', name: 'b.ts', relative: 'b.ts' }
      ]
    })
    expect(
      merged.map(function (hit) {
        return hit.absolute
      })
    ).toEqual(['C:/repo/a.ts', 'C:/repo/b.ts', 'C:/repo/c.ts'])
    expect(merged[0]?.isOpen).toBe(true)
  })

  it('尾分隔符与反斜杠归一后再去重', function () {
    const merged = mergeFileHits({
      open: [{ absolute: 'C:\\repo\\a.ts', name: 'a.ts', relative: 'a.ts' }],
      recent: [{ absolute: 'C:/repo/a.ts/', name: 'a.ts', relative: 'a.ts' }],
      search: []
    })
    expect(merged).toHaveLength(1)
  })
})
