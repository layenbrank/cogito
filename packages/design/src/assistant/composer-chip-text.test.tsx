/**
 * `ComposerChipText` 的单行模式。
 *
 * 队列折叠头 / 队列条目 / pending 行都是「预览」：必须真的只有一行，
 * 而不是「看起来像一行」。约束落在文档层而不是 CSS —— `whitespace-pre-wrap`
 * 会覆盖父级的 `truncate`，`<br>` 则让 `text-overflow` 直接失效。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ComposerChipText, countComposerLines, flattenSingleLine } from './composer-chip-text'
import { parseDocument } from './composer-document'

/** 去掉标签后的可见文本（够用：这里只断言换行与断行节点） */
function visibleText(markup: string): string {
  return markup.replace(/<[^>]*>/g, '')
}

const MULTILINE = '第一行\n第二行\n第三行\n第四行'

describe('ComposerChipText 单行模式', () => {
  it('多行正文不渲染 <br>，可见文本里也没有换行', function () {
    const markup = renderToStaticMarkup(
      <ComposerChipText
        text={MULTILINE}
        singleLine
      />
    )

    expect(markup).not.toContain('<br')
    expect(visibleText(markup)).not.toContain('\n')
    expect(markup).toContain('data-single-line="true"')
    expect(markup).toContain('truncate')
    expect(visibleText(markup)).toContain('第一行')
    expect(visibleText(markup)).toContain('第四行')
  })

  it('非单行模式保持原样：换行仍是 <br>', function () {
    const markup = renderToStaticMarkup(<ComposerChipText text={MULTILINE} />)

    expect(markup).toContain('<br')
    expect(markup).toContain('whitespace-pre-wrap')
    expect(markup).not.toContain('data-single-line')
  })

  it('flatten 把 break 折成空格并合并相邻文本', function () {
    const atoms = parseDocument('a\nb')
    const flat = flattenSingleLine(atoms)

    expect(flat.some((atom) => atom.kind === 'break')).toBe(false)
    for (const atom of flat) {
      if (atom.kind === 'text') expect(atom.text).not.toContain('\n')
    }
    // 相邻文本合并成一段，避免单行里出现一串只剩空格的 Fragment
    expect(flat.filter((atom) => atom.kind === 'text')).toHaveLength(1)
  })

  it('行数口径：3 处换行 = 4 行', function () {
    expect(countComposerLines(MULTILINE)).toBe(4)
    expect(countComposerLines('单行')).toBe(1)
    expect(countComposerLines('')).toBe(0)
  })
})
