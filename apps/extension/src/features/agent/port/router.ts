/**
 * 执行者选路：**有桌面端走桥（全能力），没有则降级云端（仅对话）**。
 *
 * 为什么不在 UI 里让用户切：用户不关心「我在用哪条链路」，但必须知道**能力差别** ——
 * 同一条输入，桥能读文件跑命令，云端只能回文字。所以选路自动做，执行者标签必须显示。
 *
 * 选路的失败也要分清：两条路都不通时，直接把**两条**原因都说出来。只说桥的原因，
 * 用户会以为「开了桌面端就好了」，而实际他连账号都没登。
 */

import type { ChatModelPort, ChatRunInput, ChatStreamEvent, ChatTarget } from '@cogito/chat/ports'

import { findBridge } from '@/features/bridge/client-bridge.ts'
import { findPref } from '@/features/platform/prefs.ts'
import { findAuthToken } from '@/features/platform/secrets.ts'
import type { Executor } from './cloud.ts'
import { publishExecutor } from './cloud.ts'

async function findExecutor(): Promise<Executor> {
  const outcome = await findBridge()
  if (outcome.ok) {
    return { kind: 'bridge', detail: '本机 agentd（工具 / 审批可用）' }
  }

  if (!findAuthToken()) {
    return { kind: 'none', detail: `${outcome.reason}；也没有登录，云端兜底不可用` }
  }
  if (!findPref('agent').model) {
    return { kind: 'none', detail: `${outcome.reason}；云端兜底还需要先选模型` }
  }
  return { kind: 'cloud', detail: '云端网关（仅对话，无工具）' }
}

/**
 * 双路端口：`run` 前现查一次执行者（客户端可能刚启动 / 刚退出），
 * 结果同时发布给界面，让「本轮是谁在跑」始终可见。
 */
function buildRoutedModelPort(bridge: ChatModelPort, cloud: ChatModelPort): ChatModelPort {
  return {
    async findTarget(): Promise<ChatTarget | null> {
      const executor = await findExecutor()
      publishExecutor(executor)
      return executor.kind === 'cloud' ? cloud.findTarget() : bridge.findTarget()
    },

    async *run(input: ChatRunInput & ChatTarget, signal: AbortSignal): AsyncGenerator<ChatStreamEvent> {
      const executor = await findExecutor()
      publishExecutor(executor)
      if (executor.kind === 'none') throw new Error(executor.detail)
      const port = executor.kind === 'bridge' ? bridge : cloud
      yield* port.run(input, signal)
    },

    // 审批与追问问世于桥路（goose 才有工具）；云端没有票据，返回 false 让 UI 如实说「已失效」
    respondToApproval(input) {
      return bridge.respondToApproval ? bridge.respondToApproval(input) : false
    },

    findApprovalState(toolCallId) {
      return bridge.findApprovalState ? bridge.findApprovalState(toolCallId) : null
    },

    respondToElicitation(input) {
      return bridge.respondToElicitation ? bridge.respondToElicitation(input) : false
    }
  }
}

export { buildRoutedModelPort, findExecutor }
