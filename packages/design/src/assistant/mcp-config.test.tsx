import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { McpConfigBody, McpConfigCard, McpConfigDialog, McpServerCard } from './mcp-config'
import type { McpServerView } from './mcp-config-state'
import { AssistantLabelsProvider } from './labels'

const GITHUB: McpServerView = {
  id: 'github-mcp',
  name: 'github-mcp',
  transport: 'streamable-http',
  status: 'connected',
  tools: ['list_issues']
}

const LINEAR: McpServerView = {
  id: 'linear',
  name: 'linear',
  transport: 'streamable-http',
  status: 'needs-auth',
  authorizationUrl: 'https://mcp.linear.app/authorize'
}

const BROKEN: McpServerView = {
  id: 'broken',
  name: 'broken',
  transport: 'stdio',
  status: 'failed',
  error: 'connect ECONNREFUSED 127.0.0.1:3000'
}

function card(server: McpServerView, props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <McpServerCard
      server={server}
      {...props}
    />
  )
}

describe('McpServerCard', function () {
  it('头像 + 名称 + 状态徽标，根上带 kind / state 标记', function () {
    const html = card(GITHUB, { kind: 'connector' })
    expect(html).toContain('data-slot="mcp-server-card"')
    expect(html).toContain('data-kind="connector"')
    expect(html).toContain('data-state="connected"')
    expect(html).toContain('>github-mcp</span>')
    expect(html).toContain('data-slot="mcp-server-card-status"')
    expect(html).toContain('>connected</span>')
    expect(html).toContain('bg-emerald-500/10')
  })

  it('已连上给 Disconnect，不给 Connect；带授权地址就给授权链接', function () {
    const html = card(GITHUB, {
      onConnect: function () {},
      onDisconnect: function () {},
      onRemove: function () {}
    })
    expect(html).toContain('data-slot="mcp-server-card-disconnect"')
    expect(html).not.toContain('data-slot="mcp-server-card-connect"')
    expect(html).toContain('>Disconnect</button>')
    expect(html).toContain('data-slot="mcp-server-card-remove"')
    expect(html).not.toContain('data-slot="mcp-server-card-authorize"')
  })

  it('待授权给 Connect，并渲染 authorizationUrl 的新标签页链接', function () {
    const html = card(LINEAR, { onConnect: function () {}, onDisconnect: function () {} })
    expect(html).toContain('data-slot="mcp-server-card-connect"')
    expect(html).not.toContain('data-slot="mcp-server-card-disconnect"')
    expect(html).toContain('data-slot="mcp-server-card-authorize"')
    expect(html).toContain('href="https://mcp.linear.app/authorize"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noreferrer"')
  })

  it('失败档：错误横幅 + 失败色边框 + Connect（重试）', function () {
    const html = card(BROKEN, { onConnect: function () {} })
    expect(html).toContain('data-has-error')
    expect(html).toContain('border-destructive/40')
    expect(html).toContain('data-slot="mcp-server-card-error"')
    expect(html).toContain('connect ECONNREFUSED 127.0.0.1:3000')
    expect(html).toContain('data-slot="mcp-server-card-connect"')
  })

  it('连接器没有移除动作，只有自定义服务器有', function () {
    const connector = card(GITHUB, { kind: 'connector', onRemove: function () {} })
    expect(connector).not.toContain('data-slot="mcp-server-card-remove"')

    const custom = card(GITHUB, { kind: 'custom', onRemove: function () {} })
    expect(custom).toContain('data-slot="mcp-server-card-remove"')
  })

  it('没给回调就不渲染那颗按钮（不留点了没反应的入口）', function () {
    const html = card(GITHUB)
    expect(html).not.toContain('<button')
    expect(html).not.toContain('data-slot="mcp-server-card-disconnect"')
  })

  it('pending 时动作禁用；状态变化区挂 role=status 且初始为空', function () {
    const html = card(GITHUB, {
      pending: true,
      onDisconnect: function () {},
      onRemove: function () {}
    })
    expect(html).toContain('disabled=""')
    expect(html).toContain('role="status"')
    expect(html).toContain('data-slot="mcp-server-card-announcement"')
  })
})

describe('McpConfigBody', function () {
  it('标题 / 说明 / 连接器 / 自定义服务器四段按顺序排', function () {
    const html = renderToStaticMarkup(
      <McpConfigBody
        connectors={[]}
        servers={[]}
      />
    )
    expect(html).toContain('data-slot="mcp-config-body"')
    expect(html).toContain('>MCP servers</h4>')
    expect(html).toContain('Connect servers to expose their tools to this assistant.')
    const order = [
      'data-slot="mcp-config-heading"',
      'data-slot="mcp-config-connectors"',
      'data-slot="mcp-config-servers"'
    ]
    let last = -1
    for (const marker of order) {
      const at = html.indexOf(marker)
      expect(at).toBeGreaterThan(last)
      last = at
    }
  })

  it('连接器空态是描边虚线框，没有假的卡片', function () {
    const html = renderToStaticMarkup(
      <McpConfigBody
        connectors={[]}
        servers={[]}
      />
    )
    expect(html).toContain('data-slot="mcp-config-connectors-empty"')
    expect(html).toContain('border-dashed')
    expect(html).toContain('No connectors configured')
    expect(html).not.toContain('data-slot="mcp-server-card"')
  })

  it('连接器与自定义服务器分组渲染，连接器不带移除', function () {
    const html = renderToStaticMarkup(
      <McpConfigBody
        connectors={[GITHUB]}
        servers={[LINEAR]}
        onConnect={function () {}}
        onDisconnect={function () {}}
        onRemove={function () {}}
      />
    )
    expect(html).toContain('data-kind="connector"')
    expect(html).toContain('data-kind="custom"')
    expect(html.match(/data-slot="mcp-server-card-remove"/g)).toHaveLength(1)
  })

  it('没给添加入口就不渲染 Add server；给了表单默认收起', function () {
    const bare = renderToStaticMarkup(
      <McpConfigBody
        connectors={[]}
        servers={[]}
      />
    )
    expect(bare).not.toContain('data-slot="mcp-config-add-server"')

    const ready = renderToStaticMarkup(
      <McpConfigBody
        connectors={[]}
        servers={[]}
        onAddServer={function () {}}
      />
    )
    expect(ready).toContain('data-slot="mcp-config-add-server"')
    expect(ready).toContain('>Add server</button>')
    // 默认收起：给了表单也不展开
    const withForm = renderToStaticMarkup(
      <McpConfigBody
        connectors={[]}
        servers={[]}
        renderAddForm={function () {
          return <p>form</p>
        }}
      />
    )
    expect(withForm).toContain('aria-expanded="false"')
    expect(withForm).not.toContain('data-slot="mcp-config-add-form"')
  })

  it('标题 / 说明可以被替换（弹窗里换成 DialogTitle）', function () {
    const html = renderToStaticMarkup(
      <McpConfigBody
        connectors={[]}
        servers={[]}
        title={<h2>MCP</h2>}
        description={<p>说明</p>}
      />
    )
    expect(html).toContain('<h2>MCP</h2>')
    expect(html).toContain('<p>说明</p>')
    expect(html).not.toContain('>MCP servers</h4>')
  })

  it('文字走 labels：注入中文后英文小标题消失', function () {
    const html = renderToStaticMarkup(
      <AssistantLabelsProvider
        labels={{
          mcpConfigTitle: 'MCP 服务器',
          mcpConfigDescription: '连接服务器，把它们提供的工具交给这个助手。',
          mcpConnectors: '连接器',
          mcpNoConnectors: '还没有配置连接器',
          mcpCustomServers: '自定义服务器',
          mcpAddServer: '添加服务器'
        }}>
        <McpConfigBody
          connectors={[]}
          servers={[]}
          onAddServer={function () {}}
        />
      </AssistantLabelsProvider>
    )
    expect(html).toContain('>MCP 服务器</h4>')
    expect(html).toContain('>连接器</p>')
    expect(html).toContain('>还没有配置连接器</div>')
    expect(html).toContain('>自定义服务器</p>')
    expect(html).toContain('>添加服务器</button>')
    expect(html).not.toContain('>Connectors</p>')
  })
})

describe('McpConfigCard / McpConfigDialog', function () {
  it('卡片只是同一套内容加了纸卡外壳', function () {
    const html = renderToStaticMarkup(
      <McpConfigCard
        connectors={[]}
        servers={[]}
      />
    )
    expect(html).toContain('data-slot="mcp-config-card"')
    expect(html).toContain('data-slot="mcp-config-body"')
    expect(html).toContain('rounded-2xl')
  })

  it('弹窗默认是一个描边触发器；给了 children 就用自己的', function () {
    const html = renderToStaticMarkup(
      <McpConfigDialog
        connectors={[]}
        servers={[]}
      />
    )
    expect(html).toContain('data-slot="mcp-config-trigger"')
    expect(html).toContain('MCP servers')

    const custom = renderToStaticMarkup(
      <McpConfigDialog
        connectors={[]}
        servers={[]}>
        <span>连接器</span>
      </McpConfigDialog>
    )
    expect(custom).toContain('<span>连接器</span>')
  })
})
