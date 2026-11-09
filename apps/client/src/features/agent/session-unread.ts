/**
 * 会话「已读 / 未读」的**唯一写入口**。
 *
 * 语义（见 `agent_session.unread` 列）：
 * - 已读 = `false`，新会话与历史会话都是这个值；
 * - 未读 = `true`，一轮跑完时用户没在看这个会话 —— 左栏那一行点个圆点提醒。
 *
 * 为什么状态要落库而不是像 `run-state.ts` 那样只放内存：内存集合一重启就没了，
 * 而「昨天有个会话跑完了我还没看」正是要跨重启保留的信息。
 *
 * 为什么写之前先比对内存里的值：切会话、跑完、打开会话都会调过来，
 * 没变就不该打一轮 IPC（也免得 `updatedAt` 被无谓地碰一下）。
 */

import { useAgentStore } from '@/stores/agent.ts'

/**
 * 标记某个会话的已读 / 未读。会话还没落库（草稿）或值没变时是空操作。
 *
 * 失败只告警不抛：这是个装饰性状态，为它中断切换会话 / 收流不值得。
 */
function markSessionUnread(sessionID: string, unread: boolean): void {
  const state = useAgentStore.getState()
  const session = state.sessions.find(function (item) {
    return item.id === sessionID
  })
  if (!session || session.unread === unread) return
  void state.toUpdateSession([{ id: sessionID, unread }]).catch(function (error) {
    console.warn('[agent/unread] 会话未读状态写入失败:', sessionID, error)
  })
}

export { markSessionUnread }
