/**
 * 云端 MCP 的会话级挂载（**降级入口**）。
 *
 * 正常路径是本地 `cogito-mcp` → 桥 → core Service；它同时包含了「本地 + 云端」两路检索。
 * 只有当本地工具网关**没挂上**（`cogito-mcp` 缺失/桥没起）时，才把 `${cogito}/api/v1/mcp`
 * 作为会话扩展挂上去 —— 这时模型至少还能检索云端知识库。
 *
 * 两个入口**不并存**：都在的话模型会同时看到 `app_knowledge_search` 与
 * `cogito_knowledge_search`，然后对同一个查询调两次。
 *
 * 头里带的是**当前** JWT 与租户，且只挂在这次会话上：令牌换/过期后新建会话自然拿到新值，
 * 不需要额外的 401 刷新逻辑，也不会把令牌落到 goose 的全局配置里。
 */
import type { ClientConnection } from '@agentclientprotocol/sdk'

import { addSessionExtension } from '@/features/agent/acp/goose-extensions'
import type { GooseExtension } from '@/features/agent/model/extension'
import { findAuthToken } from '@/utils/auth'
import { reportCaught } from '@/utils/exception-report'
import { ENV_URLS } from '@/utils/http/env'
import { findActiveTenantID } from '@/utils/tenant'

/** 会话扩展里的名字：与本地 stdio 的 `cogito` 区分，便于日志与排障 */
const CLOUD_MCP_NAME = 'cogito-cloud'
const CLOUD_MCP_PATH = '/mcp'

/** 缺环境、缺令牌或缺租户时返回 `null`：宁可没有云端检索，也不要挂一个必然 401 的扩展 */
function buildCloudMcp(): GooseExtension | null {
  const base = ENV_URLS.cogito?.trim()
  const token = findAuthToken()
  const tenantID = findActiveTenantID()
  if (!base || !token || !tenantID) return null
  return {
    type: 'mcp',
    server: {
      type: 'http',
      name: CLOUD_MCP_NAME,
      url: `${base.replace(/\/+$/, '')}${CLOUD_MCP_PATH}`,
      headers: [
        { name: 'Authorization', value: `Bearer ${token}` },
        { name: 'X-Tenant-ID', value: tenantID }
      ]
    },
    description: '云端知识库检索（本地工具网关不可用时的降级入口）'
  }
}

/**
 * 把云端 MCP 挂到这次会话上。返回是否挂上。
 *
 * 失败只告警不抛： agent 少一个检索工具可以照常跑，但为它中断会话不值得。
 */
async function mountCloudMcp(
  connection: ClientConnection,
  sessionID: string
): Promise<boolean> {
  const extension = buildCloudMcp()
  if (!extension) return false
  try {
    await addSessionExtension(connection, sessionID, extension)
    console.info('[acp/session] 本地工具网关缺席，已挂云端 MCP 作降级入口')
    return true
  } catch (error) {
    reportCaught('agent.cloudMcp.mount', error, 'warning')
    return false
  }
}

export { CLOUD_MCP_NAME, buildCloudMcp, mountCloudMcp }
