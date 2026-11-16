import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { IslandMark } from '@/views/overlay/island/island-mark.tsx'

function getSvg(container: HTMLElement) {
  const svg = container.querySelector('svg')
  if (!svg) throw new Error('svg 没渲染出来')
  return svg
}

describe('island mark', () => {
  it('只画字形：没有底板 / 位图，底色交给 CSS', () => {
    const { container } = render(<IslandMark />)
    const svg = getSvg(container)
    // 底板是 CSS 的径向渐变，SVG 里不该再铺一层
    expect(svg.querySelector('rect')).toBeNull()
    expect(svg.querySelector('radialGradient')).toBeNull()
    expect(svg.querySelector('image')).toBeNull()
    // 满屏的 circle 只能有：中心环 + 头部圆点
    expect(svg.querySelectorAll('circle')).toHaveLength(2)
  })

  it('外环是四段弧，缺口角度按品牌图的 11° / 30° 交错排布', () => {
    const { container } = render(<IslandMark />)
    const arcs = [...getSvg(container).querySelectorAll('path[data-draw="ring"]')]
    expect(arcs).toHaveLength(4)
    // 四段弧的 d 各不相同，且都是圆弧指令
    const ds = arcs.map((p) => p.getAttribute('d'))
    expect(new Set(ds).size).toBe(4)
    for (const d of ds) expect(d).toMatch(/^M[\d.]+ [\d.]+A14\.13 14\.13 0 0 1/)
    // 两长两短：75° → 18.5，62° → 15.29
    expect(arcs.map((p) => p.getAttribute('data-len')).sort()).toEqual(['15.29', '15.29', '18.5', '18.5'])
  })

  it('每条可描边的线都用真实长度做虚线（不依赖 pathLength 归一化）', () => {
    const { container } = render(<IslandMark />)
    const strokes = [...getSvg(container).querySelectorAll('[data-draw]')]
    expect(strokes).toHaveLength(6)
    for (const node of strokes) {
      const len = node.getAttribute('data-len')
      expect(len).toBeTruthy()
      // dasharray 与初始 dashoffset 都取全长 → 初始完全隐藏，从 0 划出
      expect(node.getAttribute('stroke-dasharray')).toBe(len)
      expect(node.getAttribute('stroke-dashoffset')).toBe(len)
      expect(node.getAttribute('pathLength')).toBeNull()
    }
  })

  it('指针是渐细的刃：填充刀形 + 遮罩里一条会描边的刷子', () => {
    const { container } = render(<IslandMark />)
    const svg = getSvg(container)
    const mask = svg.querySelector('mask')
    expect(mask).not.toBeNull()
    // 刷子就是那条 needle 描边
    const brush = mask?.querySelector('[data-draw="needle"]')
    expect(brush?.tagName.toLowerCase()).toBe('line')
    // 刃形三角形走遮罩，颜色是同一个金属渐变
    const blade = [...svg.querySelectorAll('path')].find((p) => (p.getAttribute('d') ?? '').endsWith('Z'))
    expect(blade).toBeTruthy()
    expect(blade?.getAttribute('mask')).toBe(`url(#${mask?.id})`)
    expect(blade?.getAttribute('fill')).toBe(`url(#${blade?.closest('svg')?.querySelector('linearGradient')?.id})`)
    // 头上的实心圆点（半径由时间线从 0 弹出来，这里只断言位置）
    const dot = svg.querySelector('[data-dot]')
    expect(dot?.getAttribute('cx')).toBe('49.19')
    expect(dot?.getAttribute('cy')).toBe('14.47')
    expect(Number(dot?.getAttribute('r'))).toBeGreaterThanOrEqual(0)
  })

  it('多个实例的渐变 / 遮罩 id 互不串色', () => {
    const { container } = render(
      <>
        <IslandMark />
        <IslandMark />
      </>
    )
    const ids = [...container.querySelectorAll('linearGradient')].map((g) => g.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    const masks = [...container.querySelectorAll('mask')].map((m) => m.id)
    expect(new Set(masks).size).toBe(2)
  })

  it('字形默认可见（淡出只发生在时间线里，挂载时不是 opacity 0）', () => {
    const { container } = render(<IslandMark />)
    const glyph = container.querySelector('[data-glyph]')
    expect(glyph).not.toBeNull()
    expect(glyph?.getAttribute('opacity')).toBeNull()
  })
})
