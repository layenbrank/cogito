import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SplitterHandleView } from './splitter-handle'

type HandleProps = Parameters<typeof SplitterHandleView>[0]

const BASE: HandleProps = {
  index: 0,
  orientation: 'horizontal',
  ariaNow: 50,
  ariaMin: 0,
  ariaMax: 100,
  canResize: true,
  startCollapsible: true,
  endCollapsible: true,
  startCollapsed: false,
  endCollapsed: false,
  onPointerDown: function () {},
  onPointerEnter: function () {},
  onPointerLeave: function () {},
  onCollapseStart: function () {},
  onCollapseEnd: function () {}
}

function markup(props: Partial<HandleProps> = {}) {
  return renderToStaticMarkup(
    <SplitterHandleView
      {...BASE}
      {...props}
    />
  )
}

/** 逐个切出折叠钮：顺序先 start 侧、再 end 侧 */
function buttonsOf(html: string, label: string): string[] {
  return html
    .split(`aria-label="${label}"`)
    .slice(1)
    .map(function (part) {
      return part.slice(0, part.indexOf('</button>'))
    })
}

describe('SplitterHandleView 折叠钮', function () {
  it('默认字形是一片异形剪影（填充，不是 chevron 线）', function () {
    const html = markup()
    expect(html).toContain('data-slot="splitter-collapse-wave"')
    expect(html).toContain('fill-opacity')
    expect(html).not.toContain('chevron')
  })

  it('不画方框也不画底：只有一块透明热区', function () {
    const [start] = buttonsOf(markup(), '折叠面板')
    expect(start).toContain('h-10 w-4')
    expect(start).not.toContain('size-5')
    expect(start).not.toContain('rounded-sm')
    expect(start).not.toContain('border-border')
    expect(start).not.toContain('bg-card')
  })

  it('横向分隔条时热区转成横向、剪影转 90°', function () {
    const [start] = buttonsOf(markup({ orientation: 'vertical' }), '折叠面板')
    expect(start).toContain('h-4 w-10')
    expect(start).toContain('rotate-90')
  })

  it('收起动作时波峰朝本侧：start 侧不镜像，end 侧镜像', function () {
    const view = buttonsOf(markup(), '折叠面板')
    expect(view).toHaveLength(2)
    expect(view[0]).not.toContain('-scale-x-100')
    expect(view[1]).toContain('-scale-x-100')
  })

  it('展开动作时方向反过来', function () {
    const view = buttonsOf(markup({ startCollapsed: true, endCollapsed: true }), '展开面板')
    expect(view).toHaveLength(2)
    expect(view[0]).toContain('-scale-x-100')
    expect(view[1]).not.toContain('-scale-x-100')
  })

  it('自定义 icon 优先于波形', function () {
    const html = markup({
      collapseConfig: { start: { icon: <span data-testid="custom" /> } }
    })
    expect(html).toContain('data-testid="custom"')
  })
})
