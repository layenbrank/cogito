import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ConversationMap, type ConversationMapTurn } from './conversation-map'
import { AssistantLabelsProvider } from './labels'

const TURNS: ConversationMapTurn[] = [
  { id: 'm1', label: 'Your message 1 / 4', preview: 'Chrome 现在跑的是哪个 Athena 构建？' },
  { id: 'm2', label: 'Your message 2 / 4', preview: 'ready dot 报的到底是什么状态？' },
  { id: 'm3', label: 'Your message 3 / 4', preview: '要不要换成 v0.3.5 再重载？' },
  { id: 'm4', label: 'Your message 4 / 4', preview: '重载之后会话还在吗？' }
]

function markup(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <ConversationMap
      turns={TURNS}
      activeId="m3"
      visibleIds={['m3', 'm4']}
      onSelect={function () {}}
      {...props}
    />
  )
}

function findTickTag(html: string, label: string) {
  const start = html.indexOf(`aria-label="${label}"`)
  const open = html.lastIndexOf('<button', start)
  return html.slice(open, html.indexOf('>', start))
}

describe('ConversationMap', function () {
  it('一个回合一根刻度，根上是导航 + 无障碍名', function () {
    const html = markup()
    expect(html).toContain('data-slot="conversation-map"')
    expect(html).toContain('aria-label="Conversation map"')
    expect(html.match(/data-slot="conversation-map-tick"/g)).toHaveLength(4)
    expect(html.match(/<button/g)).toHaveLength(4)
  })

  it('每条刻度的无障碍名就是宿主给的 label（正文预览只在悬停时进 portal）', function () {
    const html = markup()
    expect(html).toContain('aria-label="Your message 2 / 4"')
    expect(html).toContain('aria-label="Your message 4 / 4"')
  })

  it('正在读的那根带 aria-current + data-active，且只有它进 Tab 序列', function () {
    const html = markup()
    const active = findTickTag(html, 'Your message 3 / 4')
    expect(active).toContain('aria-current="true"')
    expect(active).toContain('data-active')
    expect(active).toContain('tabindex="0"')

    const idle = findTickTag(html, 'Your message 1 / 4')
    expect(idle).not.toContain('aria-current')
    expect(idle).not.toContain('data-active')
    expect(idle).toContain('tabindex="-1"')
  })

  it('视口里的刻度带 data-in-view，颜色比默认深一档', function () {
    const html = markup()
    const inView = findTickTag(html, 'Your message 4 / 4')
    expect(inView).toContain('data-in-view')

    const outside = findTickTag(html, 'Your message 1 / 4')
    expect(outside).not.toContain('data-in-view')
    expect(html).toContain('bg-foreground/50')
    expect(html).toContain('bg-foreground/15')
  })

  it('当前那根自己是一档：3px 高 + 90% 前景色', function () {
    const html = markup()
    expect(html).toContain('h-[3px]')
    expect(html).toContain('bg-foreground/90')
    // 整条尺子悬停时加长到 24px
    expect(html).toContain('group-hover:w-6')
    expect(html).toContain('group-focus-within/rail:w-6')
  })

  it('没有 activeId 时没有任何刻度算当前（也不占 Tab）', function () {
    const html = markup({ activeId: null, visibleIds: [] })
    expect(html).not.toContain('aria-current')
    expect(html).not.toContain('tabindex="0"')
    expect(html.match(/tabindex="-1"/g)).toHaveLength(4)
  })

  it('空回合列表只剩一个空导航，不渲染按钮', function () {
    const html = markup({ turns: [], activeId: null })
    expect(html).toContain('data-slot="conversation-map"')
    expect(html).not.toContain('<button')
  })

  it('className 落在根上，其余 nav 属性照传', function () {
    const html = markup({ className: 'ml-2', id: 'rail' })
    const start = html.indexOf('<nav')
    expect(html.slice(start, html.indexOf('>', start))).toContain('ml-2')
    expect(html).toContain('id="rail"')
  })

  it('文案走 labels：注入中文后英文不再出现', function () {
    const html = renderToStaticMarkup(
      <AssistantLabelsProvider labels={{ conversationMap: '消息刻度' }}>
        <ConversationMap
          turns={TURNS}
          activeId="m1"
          onSelect={function () {}}
        />
      </AssistantLabelsProvider>
    )
    expect(html).toContain('aria-label="消息刻度"')
    expect(html).not.toContain('Conversation map')
  })
})
