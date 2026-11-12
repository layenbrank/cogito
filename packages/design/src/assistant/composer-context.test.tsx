import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ComposerContext, type ComposerUsage } from './composer-context'
import { AssistantLabelsProvider } from './labels'

const USAGE: ComposerUsage = { system: 12, tools: 8, messages: 162, total: 200 }

function markup(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <ComposerContext
      usage={USAGE}
      {...props}
    />
  )
}

describe('ComposerContext', function () {
  it('根上是元素本体，面板与按钮各带自己的标记', function () {
    const html = markup()
    expect(html).toContain('data-slot="composer-context"')
    expect(html).toContain('group/ctx')
    expect(html).toContain('data-slot="composer-context-panel"')
    expect(html).toContain('data-slot="composer-context-trigger"')
    expect(html).toContain('aria-label="Context usage"')
  })

  it('百分比按 system + tools + messages 占 total 算（12 + 8 + 162 = 182 / 200 → 91%）', function () {
    const html = markup()
    expect(html).toContain('data-slot="composer-context-percent"')
    expect(html).toContain('>91%</p>')
  })

  it('三段按 系统 / 工具 / 对话 排，值是千 token', function () {
    const html = markup()
    const system = html.indexOf('>System<')
    const tools = html.indexOf('>Tools<')
    const messages = html.indexOf('>Messages<')
    expect(system).toBeGreaterThan(0)
    expect(system).toBeLessThan(tools)
    expect(tools).toBeLessThan(messages)
    expect(html).toContain('>12k</span>')
    expect(html).toContain('>8k</span>')
    expect(html).toContain('>162k</span>')
    expect(html).toContain('>182k / 200k</span>')
  })

  it('环的弧长跟着占比走：182 / 200 时只剩 9% 的 offset', function () {
    const html = markup()
    expect(html).toContain('stroke-dasharray="37.699')
    expect(html).toContain('stroke-dashoffset="3.39')
    expect(html).toContain('stroke-linecap="round"')
  })

  it('过 85% 环、百分比、按钮一起转红；没到就保持 muted', function () {
    const alert = markup()
    expect(alert).toContain('data-state="alert"')
    expect(alert).toContain('text-red-500')

    const calm = markup({ usage: { system: 10, tools: 4, messages: 30, total: 200 } })
    expect(calm).toContain('data-state="normal"')
    expect(calm).not.toContain('text-red-500')
    expect(calm).toContain('>22%</p>')
  })

  it('total 为 0 不除零：0% 且不报警，环保持满偏移', function () {
    const html = markup({ usage: { system: 0, tools: 0, messages: 0, total: 0 } })
    expect(html).toContain('>0%</p>')
    expect(html).toContain('data-state="normal"')
    expect(html).toContain('stroke-dashoffset="37.699')
  })

  it('className 落在根上，其余 div 属性照传', function () {
    const html = markup({ className: '[&_button]:size-9', id: 'ctx' })
    const start = html.indexOf('<div data-slot="composer-context"')
    const rootTag = html.slice(start, html.indexOf('>', start))
    expect(rootTag).toContain('[&amp;_button]:size-9')
    expect(html).toContain('id="ctx"')
  })

  it('悬停通道不断：面板外层的 pb-2 属于面板，鼠标穿过空隙不会缩回去', function () {
    const html = markup()
    // 空隙由外层 padding 撑着，而不是面板自己的 margin
    expect(html).toContain('pb-2')
    expect(html).not.toContain('mb-2')
    // 关着时不吃指针事件，打开时整块（含空隙）都吃 —— 这两条一起才叫「能悬浮」
    expect(html).toContain('pointer-events-none absolute end-0 bottom-full')
    expect(html).toContain('group-hover/ctx:pointer-events-auto')
  })

  it('档位透了色：warn 走琥珀、danger 走红，ok 保持 muted', function () {
    // 用没到 85% 的用量：元素红线优先，过线就一定是 danger
    const calm = { system: 10, tools: 4, messages: 30, total: 200 }
    const warn = markup({ usage: calm, level: 'warn' })
    expect(warn).toContain('data-level="warn"')
    expect(warn).toContain('data-state="warn"')
    expect(warn).toContain('text-amber-600')

    const danger = markup({ usage: calm, level: 'danger' })
    expect(danger).toContain('data-level="danger"')
    expect(danger).toContain('text-red-500')

    const ok = markup({ usage: calm, level: 'ok' })
    expect(ok).toContain('data-level="ok"')
    expect(ok).not.toContain('text-amber-600')
  })

  it('段色可换：传 tones 后气泡和右栏那套分段色一致', function () {
    const html = markup({
      usage: { system: 10, tools: 4, messages: 30, total: 200 },
      tones: { system: 'bg-sky-500/80', tools: 'bg-amber-500/80', messages: 'bg-violet-500/80' }
    })
    expect(html).toContain('bg-sky-500/80')
    expect(html).toContain('bg-amber-500/80')
    expect(html).toContain('bg-violet-500/80')
    expect(html).not.toContain('bg-foreground/25')
  })

  it('文案走 labels：注入中文后英文不再出现', function () {
    const html = renderToStaticMarkup(
      <AssistantLabelsProvider
        labels={{
          contextTitle: '上下文',
          contextUsage: '上下文用量',
          contextTotal: '合计',
          contextSystem: '系统提示词',
          contextTools: '工具',
          contextMessages: '对话'
        }}>
        <ComposerContext usage={USAGE} />
      </AssistantLabelsProvider>
    )
    expect(html).toContain('>上下文</p>')
    expect(html).toContain('>合计<')
    expect(html).toContain('>系统提示词<')
    expect(html).toContain('>对话<')
    expect(html).toContain('aria-label="上下文用量"')
    expect(html).not.toContain('>Messages<')
  })
})
