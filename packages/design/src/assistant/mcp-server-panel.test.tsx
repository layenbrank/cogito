import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AssistantLabelsProvider } from './labels'
import type { McpServerView } from './mcp-config-state'
import { McpServerPanel } from './mcp-server-panel'

const SERVERS: McpServerView[] = [
  {
    id: 'github-mcp',
    name: 'github-mcp',
    transport: 'streamable-http',
    status: 'connected',
    tools: ['list_issues', 'create_pr', 'get_diff']
  },
  { id: 'linear', name: 'linear', transport: 'streamable-http', status: 'needs-auth', tools: [] },
  {
    id: 'filesystem',
    name: 'filesystem',
    transport: 'stdio',
    status: 'connected',
    tools: ['read_file', 'write_file']
  }
]

function markup(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <McpServerPanel
      servers={SERVERS}
      {...props}
    />
  )
}

function countOf(html: string, needle: string): number {
  return html.split(needle).length - 1
}

describe('McpServerPanel', function () {
  it('表头只数连上的：2 of 3 connected，根上有元素标记', function () {
    const html = markup()
    expect(html).toContain('data-slot="mcp-server-panel"')
    expect(html).toContain('>Servers</span>')
    expect(html).toContain('>2 of 3 connected</span>')
  })

  it('每行收起时只有 chevron / plug / 名称 / 工具数 / 圆点，三行都不展开', function () {
    const html = markup()
    expect(countOf(html, 'data-slot="mcp-server-row"')).toBe(3)
    expect(countOf(html, 'aria-expanded="false"')).toBe(3)
    expect(html).toContain('>3 tools</span>')
    expect(html).toContain('>0 tools</span>')
    expect(html).toContain('>2 tools</span>')
    expect(html).not.toContain('data-slot="mcp-server-row-detail"')
  })

  it('工具数按单复数走：1 tool 不是 1 tools', function () {
    const html = renderToStaticMarkup(
      <McpServerPanel
        servers={[
          { id: 'one', name: 'one', transport: 'stdio', status: 'connected', tools: ['x'] }
        ]}
      />
    )
    expect(html).toContain('>1 tool</span>')
  })

  it('四档状态都有 sr-only 文案，读屏不靠颜色', function () {
    const html = renderToStaticMarkup(
      <McpServerPanel
        servers={[
          { id: 'a', name: 'a', transport: 'stdio', status: 'connected' },
          { id: 'b', name: 'b', transport: 'stdio', status: 'connecting' },
          { id: 'c', name: 'c', transport: 'stdio', status: 'needs-auth' },
          { id: 'd', name: 'd', transport: 'stdio', status: 'failed' }
        ]}
      />
    )
    expect(html).toContain('>connected</span>')
    expect(html).toContain('>connecting</span>')
    expect(html).toContain('>needs auth</span>')
    expect(html).toContain('>failed</span>')
    // 圆点四档配色各不相同
    expect(html).toContain('bg-emerald-500')
    expect(html).toContain('animate-pulse')
    expect(html).toContain('bg-amber-500')
    expect(html).toContain('bg-destructive')
  })

  it('展开的行才给传输形态与工具徽标，chevron 转 90°', function () {
    const html = markup({ defaultOpenIds: ['github-mcp'] })
    expect(countOf(html, 'data-slot="mcp-server-row-detail"')).toBe(1)
    expect(html).toContain('>streamable-http</span>')
    expect(html).toContain('>list_issues</span>')
    expect(html).toContain('>get_diff</span>')
    // chevron 的旋转靠 aria-expanded 表达：图标是离线集，SSR 时只出空 span
    expect(html).toContain('aria-expanded="true"')
    // 没展开的行没有工具徽标
    expect(html).not.toContain('>read_file</span>')
  })

  it('授权动作只在 needs-auth 行且给了 onAuthorize 时出现', function () {
    const without = markup({ defaultOpenIds: ['linear'] })
    expect(without).not.toContain('data-slot="mcp-server-row-authorize"')

    const withAction = markup({
      defaultOpenIds: ['linear'],
      onAuthorize: function () {}
    })
    expect(withAction).toContain('data-slot="mcp-server-row-authorize"')
    expect(withAction).toContain('>Authorize</button>')

    // 已连上的行展开了也不给授权动作
    const connected = markup({ defaultOpenIds: ['github-mcp'], onAuthorize: function () {} })
    expect(connected).not.toContain('data-slot="mcp-server-row-authorize"')
  })

  it('空清单：表头是 0 of 0，一行都不渲染', function () {
    const html = markup({ servers: [] })
    expect(html).toContain('>0 of 0 connected</span>')
    expect(html).not.toContain('data-slot="mcp-server-row"')
  })

  it('className 落在根上，其余属性照传', function () {
    const html = markup({ className: 'max-w-xs', id: 'mcp-panel' })
    const start = html.indexOf('<div data-slot="mcp-server-panel"')
    const rootTag = html.slice(start, html.indexOf('>', start))
    expect(rootTag).toContain('max-w-xs')
    expect(html).toContain('id="mcp-panel"')
  })

  it('文案走 labels：注入中文后英文不再出现', function () {
    const html = renderToStaticMarkup(
      <AssistantLabelsProvider
        labels={{
          mcpServersTitle: '服务器',
          mcpConnectedCount: function (connected, total) {
            return `${connected}/${total} 已连接`
          },
          mcpToolCount: function (count) {
            return `${count} 个工具`
          },
          mcpAuthorize: '去授权'
        }}>
        <McpServerPanel
          servers={SERVERS}
          defaultOpenIds={['linear']}
          onAuthorize={function () {}}
        />
      </AssistantLabelsProvider>
    )
    expect(html).toContain('>服务器</span>')
    expect(html).toContain('>2/3 已连接</span>')
    expect(html).toContain('>3 个工具</span>')
    expect(html).toContain('>去授权</button>')
    expect(html).not.toContain('>Servers</span>')
    expect(html).not.toContain('3 tools</span>')
  })
})
