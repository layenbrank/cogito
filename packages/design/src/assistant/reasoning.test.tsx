/**
 * 折叠行必须说得出「具体在干什么」：只写「思考中… / 已思考」等于没说 ——
 * 收起状态用户只看得到这一行。这里锁 `ReasoningTrigger` 的 `detail` 槽：
 * 有就渲染并带分隔点，没有就整格不出现（不留空占位）。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ReasoningRoot, ReasoningTrigger } from './reasoning'

function render(label: string, detail?: string): string {
  return renderToStaticMarkup(
    <ReasoningRoot>
      <ReasoningTrigger
        label={label}
        detail={detail}
      />
    </ReasoningRoot>
  )
}

describe('ReasoningTrigger detail', function () {
  it('带上「在想什么」：状态词与提示之间自动补分隔点', function () {
    const html = render('思考中…', '需要先确认渲染路径')
    expect(html).toContain('data-slot="reasoning-trigger-detail"')
    expect(html).toContain('需要先确认渲染路径')
    expect(html).toContain('·')
  })

  it('没有提示时不渲染空的提示位', function () {
    expect(render('已思考')).not.toContain('reasoning-trigger-detail')
  })

  it('提示单独占一格并单向截断，状态词不被挤掉', function () {
    const html = render('已思考', '一段很长的思考摘要')
    expect(html).toContain('min-w-0 truncate')
  })
})
