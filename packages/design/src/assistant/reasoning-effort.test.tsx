import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ReasoningEffort, type EffortLevel } from './reasoning-effort'

const LEVELS: EffortLevel[] = [
  { key: 'off', label: '关闭', budget: 0 },
  { key: 'low', label: '快速', budget: 1024 },
  { key: 'medium', label: '标准', budget: 4096 },
  { key: 'high', label: '深入', budget: 8192 },
  { key: 'max', label: '极致', budget: 16384 }
]

function markup(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <ReasoningEffort
      levels={LEVELS}
      selectedKey="medium"
      spent={1024}
      {...props}
    />
  )
}

describe('ReasoningEffort', function () {
  it('轨道不能和选中胶囊同色：底色浅一档，选中项才看得出被选中', function () {
    const html = markup()
    const track = html.slice(html.indexOf('data-slot="reasoning-effort-track"'))
    const trackTag = track.slice(0, track.indexOf('>'))
    expect(trackTag).toContain('bg-foreground/[0.04]')
    expect(trackTag).not.toContain('bg-background')
    // 选中胶囊靠「白底 + 阴影」从浅底上抬起来
    expect(html).toContain('bg-background text-foreground shadow-xs')
  })

  it('选中项是唯一带 data-active 且 aria-pressed=true 的那一格', function () {
    // 交互态：没有 onSelect 会降级成 span，那时不该有 aria-pressed
    const html = markup({ onSelect: function () {} })
    expect(html.match(/data-active="true"/g)?.length).toBe(1)
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1)
    expect(html.match(/aria-pressed="false"/g)?.length).toBe(LEVELS.length - 1)
  })

  it('没有 onSelect 时降级成 span，并标出当前档', function () {
    const html = markup({ onSelect: undefined })
    expect(html).not.toContain('<button')
    expect(html).toContain('aria-current="true"')
    expect(html.match(/data-active="true"/g)?.length).toBe(1)
  })

  it('预算按选中档算：medium=4096、spent=1024 → 25%', function () {
    const html = markup()
    expect(html).toContain('aria-valuenow="25"')
    expect(html).toContain('1,024 / 4,096')
  })

  it('预算为 0 时不除零，进度收在 0', function () {
    const html = markup({ selectedKey: 'off', spent: 500 })
    expect(html).toContain('aria-valuenow="0"')
    expect(html).toContain('width:0%')
  })

  it('note 只在传了的时候出现', function () {
    expect(markup()).not.toContain('data-slot="reasoning-effort-note"')
    const withNote = markup({ note: '本模型实际下发 high' })
    expect(withNote).toContain('data-slot="reasoning-effort-note"')
    expect(withNote).toContain('本模型实际下发 high')
  })
})
