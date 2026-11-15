/**
 * goose 配置面的传输层：**保留 `ClientConnection` 的形状，只换底层**。
 *
 * ## 为什么还要这个「连接」
 *
 * `acp/goose-providers.ts` 里有 30 多个函数，签名都是 `(connection, …args)`，被 10 多个
 * UI 组件直接调用（providers 配置、扩展开关、工具权限、模型清单…）。它们的**参数形状**是
 * ACP 的 `ClientConnection`，但真正用到的只有 `connection.agent.request(method, params)`。
 *
 * 所以这里只做一件事：提供一个能满足这个形状的对象，底层走 agentd 的 `/goose/invoke`。
 * 于是 30 多个函数与 10 多个组件一行都不用改 —— 换的是传输，不是抽象。
 *
 * ## 为什么可以断言
 *
 * SDK 的 `ClientConnection` 还带 `signal` / `closed` / `close()` 与整套具名方法表；
 * 我们只实现 `agent.request`。断言**集中在这一处**（而不是散到 30 个调用点），
 * 一旦哪个函数真的用到别的成员，这里会先把类型打出来。
 *
 * ## 与旧 `acp/connection.ts` 的差别
 *
 * 旧版负责：建 wss 连接、证书指纹 pin、initialize、把 `session/request_permission` /
 * `elicitation/create` 的反向请求路由给会话层、goose 退出时清会话。
 * 这些现在全在 agentd 里（连接是 stdio、审批有独立闸门），所以这里只剩「发请求」。
 */

import type { ClientConnection } from '@agentclientprotocol/sdk'

import { forgetEndpoint, invokeGoose } from './agentd-rpc'

/** 会话层与配置面共用的句柄形状；`needsProviderAuth` / `canLoadSession` 已无消费者但保留。 */
interface AgentdHandle {
  connection: ClientConnection
  needsProviderAuth: boolean
  canLoadSession: boolean
}

let cached: AgentdHandle | null = null

function buildConnection(): ClientConnection {
  const connection = {
    agent: {
      request: function (method: string, params?: unknown): Promise<unknown> {
        return invokeGoose(method, (params ?? {}) as Record<string, unknown>)
      }
    }
  }
  return connection as unknown as ClientConnection
}

/**
 * 拿一个「A2 形状」的连接。
 *
 * agentd 未就绪时**不抛**：调用方（如设置页）本来就会自己 `waitGooseReady`，
 * 这里抛只会多一层重复错误文案。
 */
function findAcpHandle(): Promise<AgentdHandle> {
  if (cached) return Promise.resolve(cached)
  cached = {
    connection: buildConnection(),
    // 组织网关的 provider 由 Rust 侧声明式注册（`cogito:provider:ensure`），不需要交互式 auth
    needsProviderAuth: false,
    // 会话连续性由 agentd 的 checkpoint 负责，不再依赖 goose 的 `session/load`
    canLoadSession: true
  }
  return Promise.resolve(cached)
}

/** agentd 重启后必须重建（令牌变了）。 */
function clearAcpHandle(): void {
  cached = null
  forgetEndpoint()
}

export { clearAcpHandle, findAcpHandle }
export type { AgentdHandle }
