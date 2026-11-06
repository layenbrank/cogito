import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AgentPlan } from './agent-plan'

const STEPS = ['Read existing composer state', 'Design the draft store', 'Wire runtime persistence']

function markup(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <AgentPlan
      title="Composer draft"
      steps={STEPS}
      activeIndex={1}
      {...props}
    />
  )
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1
}

describe('AgentPlan', function () {
  it('表头是标题 + 已完成 / 总数', function () {
    const html = markup()
    expect(html).toContain('Composer draft')
    expect(html).toContain('1 of 3')
  })

  it('进度条把百分比和「几步」都报给读屏', function () {
    const html = markup()
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="33"')
    expect(html).toContain('aria-valuetext="1 of 3 steps"')
    expect(html).toContain('aria-label="Composer draft progress"')
    expect(html).toContain('width:33%')
  })

  it('三步分别是 done / active / ahead', function () {
    const html = markup()
    expect(count(html, 'data-status="done"')).toBe(1)
    expect(count(html, 'data-status="active"')).toBe(1)
    expect(count(html, 'data-status="ahead"')).toBe(1)
  })

  it('description 只在「进行中」那一步显示', function () {
    const html = markup({
      steps: [
        { id: 'a', label: 'Design the draft store', description: 'Keep pending changes local.' },
        'Wire runtime persistence'
      ],
      activeIndex: 0
    })
    expect(html).toContain('Keep pending changes local.')
    // 那一步不再 active 时就不该出现（针要挑不会撞上 class 的词，`hidden` 会命中 `overflow-hidden`）
    const doneHtml = markup({
      steps: [{ label: 'x', description: 'only-while-active' }],
      activeIndex: 1
    })
    expect(doneHtml).not.toContain('only-while-active')
  })

  it('全部完成时没有 active 步，进度条 100%', function () {
    const html = markup({ activeIndex: 3 })
    expect(html).toContain('3 of 3')
    expect(html).toContain('aria-valuenow="100"')
    expect(html).not.toContain('data-status="active"')
    expect(count(html, 'data-status="done"')).toBe(3)
  })

  it('没有标题时退回通用无障碍名称，计数靠右', function () {
    const html = markup({ title: undefined })
    expect(html).toContain('aria-label="Plan progress"')
    expect(html).toContain('ms-auto')
  })

  it('空列表：0 of 0、0%、一步都不渲染', function () {
    const html = markup({ steps: [], activeIndex: 0 })
    expect(html).toContain('0 of 0')
    expect(html).toContain('aria-valuenow="0"')
    expect(count(html, 'data-slot="agent-plan-step"')).toBe(0)
  })

  it('步数没超过阈值：不出现折叠开关，整份清单照旧', function () {
    const html = markup({ collapseAfter: 3 })
    expect(html).not.toContain('aria-expanded')
    expect(html).not.toContain('data-folded')
    expect(count(html, 'data-slot="agent-plan-step"')).toBe(3)
  })

  it('步数超过阈值：默认只留正在做的那一行，表头与进度条仍在', function () {
    const html = markup({ collapseAfter: 2 })
    expect(html).toContain('data-folded=""')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-label="Show all 3 steps"')
    expect(count(html, 'data-slot="agent-plan-step"')).toBe(1)
    // activeIndex 是 1 → 留下的是第二步（Done 只在它之前）
    expect(html).toContain('Design the draft store')
    expect(html).not.toContain('Read existing composer state')
    expect(html).not.toContain('Wire runtime persistence')
    // 折的只是清单：标题 / 计数 / 进度条都还在
    expect(html).toContain('Composer draft')
    expect(html).toContain('1 of 3')
    expect(html).toContain('role="progressbar"')
  })

  it('idle：一步都没开始，全是圆点、进度 0', function () {
    const html = markup({ idle: true })
    expect(html).toContain('data-status="idle"')
    expect(html).toContain('0 of 3')
    expect(html).toContain('aria-valuenow="0"')
    expect(count(html, 'data-status="ahead"')).toBe(3)
    expect(html).not.toContain('data-status="active"')
  })

  it('折叠态下全部完成：没有 active 行，只剩表头与进度条', function () {    const html = markup({ activeIndex: 3, collapseAfter: 2 })
    expect(html).toContain('data-folded=""')
    expect(count(html, 'data-slot="agent-plan-step"')).toBe(0)
    expect(html).toContain('3 of 3')
    expect(html).toContain('aria-valuenow="100"')
  })

  it('defaultOpen 时折叠壳直接展开成整份清单', function () {
    const html = markup({ collapseAfter: 2, defaultOpen: true })
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('aria-label="Collapse"')
    expect(html).not.toContain('data-folded')
    expect(count(html, 'data-slot="agent-plan-step"')).toBe(3)
  })
})
