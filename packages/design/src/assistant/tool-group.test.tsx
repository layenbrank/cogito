import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AssistantLabelsProvider } from './labels'
import { ToolGroupContent, ToolGroupRoot, ToolGroupTrigger } from './tool-group.aui'

function markup(props: Record<string, unknown> = {}, children?: React.ReactNode) {
  return renderToStaticMarkup(
    <ToolGroupRoot {...props}>
      {children ?? (
        <>
          <ToolGroupTrigger count={3} />
          <ToolGroupContent>
            <div>read file</div>
            <div>run tests</div>
          </ToolGroupContent>
        </>
      )}
    </ToolGroupRoot>
  )
}

function rootTag(html: string) {
  const start = html.indexOf('<div')
  return html.slice(start, html.indexOf('>', start))
}

function triggerTag(html: string) {
  const start = html.indexOf('<button')
  return html.slice(start, html.indexOf('>', start))
}

/** iconify 的离线 svg 在测试环境只留占位 span，用数量差判断「有没有多一个图标」 */
function placeholderCount(html: string) {
  return (html.match(/<span><\/span>/g) ?? []).length
}

describe('ToolGroup', function () {
  it('缺省是 outline（元素页的 default），类名与 data-variant 说的是同一件事', function () {
    const html = markup()
    expect(rootTag(html)).toContain('data-slot="tool-group-root"')
    expect(rootTag(html)).toContain('data-variant="outline"')
    expect(rootTag(html)).toContain('rounded-lg border py-3')
  })

  it('ghost 没有壳：无描边、无圆角卡身', function () {
    const html = markup({ variant: 'ghost' })
    expect(rootTag(html)).toContain('data-variant="ghost"')
    expect(rootTag(html)).not.toContain('rounded-lg border')
    expect(rootTag(html)).not.toContain('bg-muted/30')
  })

  it('muted 是弱底描边卡', function () {
    const html = markup({ variant: 'muted' })
    expect(rootTag(html)).toContain('data-variant="muted"')
    expect(rootTag(html)).toContain('bg-muted/30')
    expect(rootTag(html)).toContain('border-muted-foreground/30')
  })

  it('折叠条默认收起，并报出次数', function () {
    const html = markup()
    expect(triggerTag(html)).toContain('aria-expanded="false"')
    expect(html).toContain('3 tool calls')
  })

  it('一次调用说单数，失败次数附在后面', function () {
    const html = renderToStaticMarkup(
      <ToolGroupRoot>
        <ToolGroupTrigger count={1} />
      </ToolGroupRoot>
    )
    expect(html).toContain('1 tool call<')

    const withFailure = renderToStaticMarkup(
      <ToolGroupRoot>
        <ToolGroupTrigger
          count={3}
          failed={2}
        />
      </ToolGroupRoot>
    )
    expect(withFailure).toContain('3 tool calls, 2 failed')
  })

  it('跑着时：多一个转圈图标 + 文案 shimmer', function () {
    const idle = renderToStaticMarkup(
      <ToolGroupRoot>
        <ToolGroupTrigger count={2} />
      </ToolGroupRoot>
    )
    const running = renderToStaticMarkup(
      <ToolGroupRoot>
        <ToolGroupTrigger
          count={2}
          active
        />
      </ToolGroupRoot>
    )
    expect(placeholderCount(running)).toBe(placeholderCount(idle) + 1)
    expect(running).toContain('shimmer')
    expect(idle).not.toContain('shimmer')
  })

  it('展开后露出内容，子项按第 N 个错峰入场（第六个起同档）', function () {
    const html = markup({ variant: 'ghost', open: true })
    expect(triggerTag(html)).toContain('aria-expanded="true"')
    expect(html).toContain('data-slot="tool-group-content"')
    expect(html).toContain('read file')
    // 错峰：第二个 40ms、第五个起封顶 160ms（HTML 里 & 与 > 会被转义）
    expect(html).toContain(':nth-child(2)]:[animation-delay:40ms')
    expect(html).toContain(':nth-child(n+5)]:[animation-delay:160ms')
  })

  it('受控 open 决定展开，收起时内容不渲染', function () {
    const closed = markup({ open: false })
    expect(triggerTag(closed)).toContain('aria-expanded="false"')
    expect(closed).not.toContain('read file')
  })

  it('className 落在根上，其余属性照传', function () {
    const html = markup({ className: 'mt-2', id: 'tools' })
    expect(rootTag(html)).toContain('mt-2')
    expect(rootTag(html)).toContain('id="tools"')
  })

  it('文案走 labels：注入中文后英文不再出现', function () {
    const html = renderToStaticMarkup(
      <AssistantLabelsProvider labels={{ toolCalls: (count) => `${count} 次工具调用` }}>
        <ToolGroupRoot>
          <ToolGroupTrigger count={3} />
        </ToolGroupRoot>
      </AssistantLabelsProvider>
    )
    expect(html).toContain('3 次工具调用')
    expect(html).not.toContain('tool calls')
  })
})
