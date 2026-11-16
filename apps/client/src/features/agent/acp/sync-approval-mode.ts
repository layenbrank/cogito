/**
 * 把 composer 的审批策略同步到 goose。
 *
 * **只写会话 `mode`**，不再写细粒度工具权限。
 *
 * ## 为什么细粒度权限不在这里
 *
 * `permission.yaml` 的 `user` 段是**全进程**的，而档位是**会话级**的 —— 按档位把整张表
 * 覆写会让两个会话互相踩（A 选「询问」，B 跑一次自动审批就把 A 的工具改成
 * always_allow，A 从此不再弹审批）。之前为了避开这个，只写「与档位无关的硬禁用」，
 * 但那又留下一个更糟的洞：写入时机挂在「用户点审批档下拉 / 切模式 / Goal 启停」上，
 * 全新会话在用户碰过这三处之前，`permission.yaml` 里**一条 `never_allow` 都没有**，
 * 黑盒 shell 在 `auto` 档下直通。
 *
 * 现在硬禁用由 agentd 在**每个 goose 会话建立时**幂等同步一次
 * （`graph.ts` 的 `ensureHardDeny`）—— 那是唯一不依赖用户操作、且每个会话必然经过的
 * 位置。档位语义仍然完全由 `mode` 表达。
 */
import type { ClientConnection } from '@agentclientprotocol/sdk'
import { methods } from '@agentclientprotocol/sdk'

import { findGooseMode, readApprovalMode, type ApprovalMode } from '@/features/agent/approval'

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

async function syncSessionApprovalMode(
  connection: ClientConnection,
  sessionId: string,
  mode: ApprovalMode = readApprovalMode()
): Promise<void> {
  await writeSessionGooseMode(connection, sessionId, findGooseMode(mode))
}

export { syncSessionApprovalMode, writeSessionGooseMode }
