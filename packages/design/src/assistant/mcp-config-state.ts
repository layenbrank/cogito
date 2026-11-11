/**
 * MCP 配置弹窗 / 服务器面板的纯逻辑：状态折叠、计数、动作可用性。
 *
 * assistant-ui 的 MCP manager 有六种 `connectionState`，而 `elements/mcp-server-panel`
 * 只画四档圆点（connected / connecting / needs-auth / failed）。折叠规则写成纯函数，
 * 宿主把 manager 或 ACP 的原始状态直接喂进来，不用在组件里散落 `switch`。
 *
 * 元素的动作契约也在这里：Connect 只在「还没连上」的档位出现，Disconnect 只在
 * 「连着或正在连」的档位出现 —— 两档不许同时出现，避免同一行出现互相打架的按钮。
 */

/** 面板只画四档：连上、连接中、待授权、失败 */
type McpServerStatus = 'connected' | 'connecting' | 'needs-auth' | 'failed'

/** 一个服务器在界面上需要的事实；宿主自己拼（manager 快照 / ACP 扩展快照都行） */
interface McpServerView {
  /** 稳定标识：React key、展开状态、动作回调都认它 */
  id: string
  /** 展示名，可截断 */
  name: string
  /** 传输形态，原样展示：`streamable-http`、`stdio`、供应商自报的字符串 */
  transport: string
  status: McpServerStatus
  /** 已暴露的工具名；还没连上就是空数组（面板不拿它补占位文案） */
  tools?: readonly string[]
  /** 最近一次连接错误：有值就加错误横幅，卡片边框也转失败色 */
  error?: string | null
  /** OAuth 授权地址：有就渲染 Authorize 链接 */
  authorizationUrl?: string | null
}

/** 六档 manager 状态 → 四档圆点；未知值按失败处理，不静默当「连上」 */
function toMcpServerStatus(state: string): McpServerStatus {
  switch (state) {
    case 'connected':
      return 'connected'
    case 'connecting':
    case 'authPending':
      return 'connecting'
    case 'authRequired':
      return 'needs-auth'
    default:
      return 'failed'
  }
}

/** 表头那句「n of m connected」只数真正连上的 */
function countConnectedServers(servers: readonly McpServerView[]): number {
  return servers.filter(function (server) {
    return server.status === 'connected'
  }).length
}

/** 还没连上：给 Connect */
function canConnect(status: McpServerStatus): boolean {
  return status === 'needs-auth' || status === 'failed'
}

/** 已经连上（或正在连）：给 Disconnect */
function canDisconnect(status: McpServerStatus): boolean {
  return status === 'connected' || status === 'connecting'
}

/** 错误态：状态是 failed，或者带着一条连接错误（manager 可能保留旧状态） */
function isMcpServerFailed(server: McpServerView): boolean {
  return server.status === 'failed' || Boolean(server.error)
}

export { canConnect, canDisconnect, countConnectedServers, isMcpServerFailed, toMcpServerStatus }
export type { McpServerStatus, McpServerView }
