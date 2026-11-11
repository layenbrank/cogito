import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { ToolCall } from './tool-call'

// 离线图标集在 node 渲染里拿不到 icon 名，断言状态只能靠桩
vi.mock('@iconify/react/offline', function () {
  return {
    Icon: function StubIcon(props: {
      icon: string
      className?: string
      'data-slot'?: string
      'aria-hidden'?: boolean
    }) {
      return (
        <span
          data-icon={props.icon}
          data-slot={props['data-slot']}
          aria-hidden={props['aria-hidden']}
          className={props.className}
        />
      )
    }
  }
})

const noop = function () {}

function markup(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <ToolCall
      label="Searched the docs"
      activeLabel="Searching the docs"
      query="draft persistence"
      request={'{"query": "draft persistence"}'}
      result="3 matches, best hit /docs/runtime/drafts"
      open={false}
      onOpenChange={noop}
      {...props}
    />
  )
}

describe('ToolCall', function () {
  it('收起时只有一行：箭头 → 说法 → 参数芯片 → 右端状态', function () {
    const html = markup()
    expect(html).toContain('data-slot="tool-call"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('data-slot="tool-call-panel"')

    const chevron = html.indexOf('data-slot="tool-call-chevron"')
    const label = html.indexOf('data-slot="tool-call-label"')
    const query = html.indexOf('data-slot="tool-call-query"')
    const status = html.indexOf('data-slot="tool-call-status"')
    expect(chevron).toBeGreaterThan(-1)
    expect(chevron).toBeLessThan(label)
    expect(label).toBeLessThan(query)
    expect(query).toBeLessThan(status)
    expect(html).toContain('draft persistence')
    expect(html).toContain('data-icon="lucide:check"')
  })

  it('跑着的时候说法换成进行时那一段，另一段对读屏隐藏', function () {
    const html = markup({ running: true })
    expect(html).toContain('data-state="running"')
    expect(html).toContain('Searching the docs')
    expect(html).toContain('Searched the docs')
    // 两段都在 DOM 里（交叉淡出），但只有当前那段对读屏可见
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('shimmer')
    expect(html).toContain('data-icon="lucide:loader-circle"')
  })

  it('展开后是「请求 —— 发丝线 —— 结果」一块面板', function () {
    const html = markup({ open: true })
    expect(html).toContain('data-slot="tool-call-panel"')
    const request = html.indexOf('data-slot="tool-call-request"')
    const divider = html.indexOf('data-slot="tool-call-divider"')
    const result = html.indexOf('data-slot="tool-call-result"')
    expect(request).toBeGreaterThan(-1)
    expect(request).toBeLessThan(divider)
    expect(divider).toBeLessThan(result)
    expect(html).toContain('>Request</p>')
    expect(html).toContain('>Result</p>')
  })

  it('没有请求就不画发丝线，也不留空块', function () {
    const html = markup({ open: true, request: '' })
    expect(html).not.toContain('data-slot="tool-call-request"')
    expect(html).not.toContain('data-slot="tool-call-divider"')
    expect(html).toContain('data-slot="tool-call-result"')
  })

  it('状态各走各的图标：失败叉、等人警示、取消禁止符', function () {
    expect(markup({ failed: true })).toContain('data-icon="lucide:x"')
    expect(markup({ waiting: true })).toContain('data-icon="lucide:circle-alert"')
    const cancelled = markup({ cancelled: true })
    expect(cancelled).toContain('data-icon="lucide:ban"')
    expect(cancelled).toContain('line-through')
    expect(cancelled).toContain('data-state="cancelled"')
  })

  it('右端耗时排在状态图标之前', function () {
    const html = markup({ duration: '3.2s' })
    expect(html).toContain('3.2s')
    expect(html.indexOf('3.2s')).toBeLessThan(html.indexOf('data-icon="lucide:check"'))
  })

  it('面板里可以追加自己的内容（文件树 / 代码块这类）', function () {
    const html = markup({ open: true, children: <span>extra-panel-child</span> })
    expect(html).toContain('extra-panel-child')
    expect(html.indexOf('data-slot="tool-call-result"')).toBeLessThan(
      html.indexOf('extra-panel-child')
    )
    // 收起时不挂载
    expect(markup({ children: <span>extra-panel-child</span> })).not.toContain('extra-panel-child')
  })
})
