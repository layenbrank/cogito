import { describe, expect, it } from 'vitest'

import { countDiff, diffLines, MAX_DIFF_LINES } from '@/views/knowledge/lib/diff.ts'

function kinds(rows: { kind: string }[]): string[] {
  return rows.map(function (row) {
    return row.kind
  })
}

describe('diffLines', function () {
  it('内容完全相同时只出一行 same', function () {
    const rows = diffLines('# 标题\n正文', '# 标题\n正文')
    expect(kinds(rows)).toEqual(['same', 'same'])
    expect(countDiff(rows)).toEqual({ added: 0, removed: 0 })
  })

  it('替换一行：先删后加', function () {
    const rows = diffLines('第一行\n旧内容', '第一行\n新内容')
    expect(kinds(rows)).toEqual(['same', 'remove', 'add'])
    expect(rows[1].text).toBe('旧内容')
    expect(rows[2].text).toBe('新内容')
  })

  it('只新增保持原有行不变', function () {
    const rows = diffLines('a', 'a\nb')
    expect(kinds(rows)).toEqual(['same', 'add'])
  })

  it('只删除保持原有行不变', function () {
    const rows = diffLines('a\nb', 'a')
    expect(kinds(rows)).toEqual(['same', 'remove'])
  })

  it('原样为空时全部算新增（续写的预览场景）', function () {
    // 空串会被 split 成一行空行，与中间的空行对上，于是只报两行新增
    const rows = diffLines('', '续写的一段\n\n第二段')
    expect(countDiff(rows)).toEqual({ added: 2, removed: 0 })
  })

  it('统一 CRLF：不会因为换行符差异整块重写', function () {
    const rows = diffLines('a\r\nb', 'a\nb')
    expect(countDiff(rows)).toEqual({ added: 0, removed: 0 })
  })

  it('超过保险丝行数时退化为整块删加', function () {
    const lines = Array.from({ length: MAX_DIFF_LINES + 1 }, function (_, index) {
      return `第 ${index} 行`
    })
    const rows = diffLines(lines.join('\n'), '完全不同的一行')
    expect(rows.filter(function (row) {
      return row.kind === 'remove'
    })).toHaveLength(MAX_DIFF_LINES + 1)
  })
})
