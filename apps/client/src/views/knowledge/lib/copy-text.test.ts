import { describe, expect, it } from 'vitest'

import { normalizeCopiedText, toCopiedHtml } from '@/views/knowledge/lib/copy-text.ts'

describe('知识库复制文本', function () {
  it('连续空行一律压成一个换行（粘到别的应用里不再出现大空行）', function () {
    expect(normalizeCopiedText('第一段\n\n\n\n第二段')).toBe('第一段\n第二段')
    expect(normalizeCopiedText('第一段\n\n第二段')).toBe('第一段\n第二段')
  })

  it('去掉段尾占位换行叠出来的首尾空行', function () {
    expect(normalizeCopiedText('\n\n只有一段\n\n')).toBe('只有一段')
  })

  it('清掉零宽字符、不换行空格与行尾空白', function () {
    expect(normalizeCopiedText('甲\u200b  \n\ufeff乙\u00a0丙  ')).toBe('甲\n乙 丙')
  })

  it('HTML 用换行而不是段落，避免再被加成空行', function () {
    expect(toCopiedHtml('甲\n乙')).toBe('<div>甲<br>乙</div>')
  })
})
