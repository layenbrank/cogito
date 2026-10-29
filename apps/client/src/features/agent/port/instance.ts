/**
 * 端口的**单例** + 运行时的宿主扩展。
 *
 * 为什么放模块作用域而不是组件里：runtime 与工具卡（审批按钮）是两个组件树分支，
 * 审批回执要回到「发起这次审批的那次运行」—— 各自 new 一份端口就回不去了（会话控制器
 * 按票据 id 记着回执该投给谁）。
 */
import type { ChatTarget } from '@cogito/chat/ports'

import { buildHistoryPort } from '@/features/agent/port/history'
import { buildModelPort } from '@/features/agent/port/model'
import { useAgentStore } from '@/stores/agent'

const historyPort = buildHistoryPort()
const chatModelPort = buildModelPort()

/**
 * 每次运行现读的宿主扩展。
 *
 * `threadID` 由调用方按**本线程**给出（runtime hook 每个线程各调一次；后台线程收尾时问
 * 「当前会话」拿到的是别人）。这里只报事实，不给结论 —— 用哪个 provider、走不走审批，
 * 全在 `port/model.ts` 里按这次运行的目标裁。
 */
function findHostOptions(target: ChatTarget, threadID: string): Record<string, unknown> {
  const state = useAgentStore.getState()
  // 归属看**这个会话自己的**那一行：库允许多会话同时跑，切走的会话下一轮不一定还站在
  // 「当前工作区」上。还没水合（或行缺失）时才退回全局指针。
  const session = state.sessions.find(function (item) {
    return item.id === threadID
  })
  return {
    threadID,
    workspaceID: session ? session.workspaceID : state.activeWorkspaceID,
    providerID: target.providerID
  }
}

export { chatModelPort, findHostOptions, historyPort }
