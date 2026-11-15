/**
 * 把 composer 的审批策略同步到 goose。
 *
 * 两步缺一不可：
 * 1. `session/set_config_option`（或 `set_mode`）写入会话 mode —— goose 默认 `auto`
 *    会无条件放行，单改 permission.yaml 的 ask_before **不会**弹审批；
 * 2. `tools/permissions/set` 写细粒度档（smart_approve 下的 always_allow / ask_before / never_allow）。
 */
import type { ClientConnection } from '@agentclientprotocol/sdk'
import { methods } from '@agentclientprotocol/sdk'

import { fetchSessionTools, writeToolPermissions } from '@/features/agent/acp/goose-providers'
import {
  findGooseMode,
  findHardDenyLevel,
  readApprovalMode,
  type ApprovalMode
} from '@/features/agent/approval'

async function writeSessionGooseMode(
  connection: ClientConnection,
  sessionId: string,
  gooseMode: string
): Promise<void> {
  try {
    await connection.agent.request(methods.agent.session.setConfigOption, {
      sessionId,
      configId: 'mode',
      value: gooseMode
    })
    return
  } catch (error) {
    console.warn('[sync-approval-mode] set_config_option(mode) 失败，回退 set_mode:', error)
  }

  await connection.agent.request(methods.agent.session.setMode, {
    sessionId,
    modeId: gooseMode
  })
}

/**
 * 细粒度权限：**只写与档位无关的硬禁用**（黑盒 shell / goose 内置写工具）。
 *
 * 为什么不再按档位全表覆写：`permission.yaml` 是**全进程**的，而档位是**会话级**的 ——
 * 两个会话交替同步会互相覆盖（A 选「询问」，B 跑一次自动审批就把 A 的工具改回
 * always_allow，A 从此不再弹审批）。档位本身由会话 `mode`（smart_approve / auto）表达。
 */
async function syncSessionToolPermissions(
  connection: ClientConnection,
  sessionId: string
): Promise<void> {
  const tools = await fetchSessionTools(connection, sessionId)
  const toolPermissions = tools.flatMap(function (tool) {
    const level = findHardDenyLevel(tool.name)
    return level ? [{ toolName: tool.name, permission: level }] : []
  })
  if (toolPermissions.length === 0) return
  await writeToolPermissions(connection, toolPermissions)
}

async function syncSessionApprovalMode(
  connection: ClientConnection,
  sessionId: string,
  mode: ApprovalMode = readApprovalMode()
): Promise<void> {
  const gooseMode = findGooseMode(mode)
  await writeSessionGooseMode(connection, sessionId, gooseMode)

  try {
    await syncSessionToolPermissions(connection, sessionId)
  } catch (error) {
    // mode 已切到 smart_approve 时，即使细粒度权限失败，写工具仍会走审批通道
    console.warn('[sync-approval-mode] 写入工具权限失败（会话 mode 已更新）:', error)
  }
}

export { syncSessionApprovalMode, writeSessionGooseMode }
