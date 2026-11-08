import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { TimeSurface } from './time-picker'

function render(hour = 9, minute = 30, step = 5) {
  return renderToStaticMarkup(
    <TimeSurface
      hour={hour}
      minute={minute}
      step={step}
      onChange={function () {}}
    />
  )
}

/** 去掉标签后的纯文本：属性里的 aria-label 不算「展示文字」 */
function visibleText(html: string) {
  return html.replace(/<[^>]*>/g, '').trim()
}

describe('TimeSurface', function () {
  it('视觉上不展示「时 / 分」文字，只保留 aria-label 给读屏', function () {
    const html = render()
    expect(visibleText(html)).not.toMatch(/[时分]/)
    expect(html).toContain('aria-label="时"')
    expect(html).toContain('aria-label="分"')
  })

  it('两列合在一张面上：列不画边框，只有中间一条分栏线', function () {
    const html = render()
    expect(html).not.toContain('border-border')
    expect(html).toContain('bg-border')
  })

  it('每小时 24 项、分钟按 step 生成，各有一个选中项', function () {
    const html = render(9, 30, 5)
    const options = html.match(/role="option"/g) ?? []
    const selected = html.match(/aria-selected="true"/g) ?? []
    expect(options).toHaveLength(24 + 12)
    expect(selected).toHaveLength(2)
    // 选中项沿用 Select 的浅主色 + 中粗
    expect(html).toContain('bg-primary/10')
    expect(html).toContain('dark:bg-primary/20')
    expect(html).toContain('font-semibold')
  })

  it('step 非法时退化为逐分钟（60 项）', function () {
    const html = render(9, 30, 0)
    const options = html.match(/role="option"/g) ?? []
    expect(options).toHaveLength(24 + 60)
  })
})
