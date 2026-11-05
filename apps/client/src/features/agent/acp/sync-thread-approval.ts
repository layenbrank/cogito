/**
 * 按会话把「有效审批档」推到 goose。
 *
 * 与 `approval-switch` 同路径（`syncSessionApprovalMode`），供模式切换 / Goal 启停复用。
 */
import { findAcpHandle } from '@/features/agent/acp/connection'
import { findThreadAcpSessionID } from '@/features/agent/acp/session'
import { syncSessionApprovalMode } from '@/features/agent/acp/sync-approval-mode'
import type { ApprovalMode } from '@/features/agent/approval'
import { findEffectiveApprovalMode } from '@/features/agent/effective-approval'

/**
 * 有 ACP session 才推；没有则静默返回（下次 ensureThreadSession 会按有效档同步）。
 */
async function syncApprovalForThread(
  threadID: string,
  override?: ApprovalMode
): Promise<void> {
  const id = threadID.trim()
  if (!id) return
  const acpSessionID = findThreadAcpSessionID(id)
  if (!acpSessionID) return
  const handle = await findAcpHandle()
  await syncSessionApprovalMode(
    handle.connection,
    acpSessionID,
    findEffectiveApprovalMode(id, override)
  )
}

export { syncApprovalForThread }
