/**
 * agentd 传输层（client 版）：只提供**地址来源**，协议实现住在
 * `@cogito/agent-runtime/agentd`。
 *
 * 为什么还留这个文件：`port/session.ts`、`port/agentd-connection.ts` 等有 30+ 处调用
 * `callAgentd` / `callAgentdJson` / `invokeGoose`，保持导出名不变可以让这次上提对调用方
 * 完全透明。浏览器扩展走的是同一个 `createAgentdTransport`，只是 `findEndpoint`
 * 换成「问本机 client 的桥」。
 */
import { createAgentdTransport } from '@cogito/agent-runtime/agentd'
import type { AgentdEndpoint } from '@cogito/agent-runtime/agentd'

import { GET_AGENTD_ENDPOINT } from '@/apis/agent-runtime'

const transport = createAgentdTransport({
  // 每个 WebView 会话一个身份：同 thread 多窗口时，agentd 靠它区分「我自己 旧的一轮」
  // （可以 supersede）与「别人正在跑的一轮」（必须显式接管，否则 409）
  clientId: crypto.randomUUID(),
  findEndpoint() {
    return GET_AGENTD_ENDPOINT<AgentdEndpoint>()
  }
})

const { call: callAgentd, callJson: callAgentdJson, findEndpoint, forget: forgetEndpoint } = transport
const { invokeGoose } = transport

/** 需要完整传输面（如直接把回执交给 `@cogito/agent-runtime` 的 helper）时用它 */
const agentdTransport = transport

export { agentdTransport, callAgentd, callAgentdJson, findEndpoint, forgetEndpoint, invokeGoose }
export type { AgentdEndpoint }
