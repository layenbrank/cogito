/**
 * 定时任务的执行侧（前端）：收到 `automation:due` 就起一次性会话跑 prompt，跑完回写结果。
 *
 * 为什么执行在前端：会话挂在 WebView 侧的 goose ACP 连接上，Rust 侧拿不到模型通道。
 * 因此 `owner=client` 的语义是「应用开着才执行」，worker 只负责 claim + 通知。
 *
 * 无人值守所以**自动拒绝一切审批/追问**：没有界面等人点，等下去只会卡到票据超时。
 * 被拒绝的次数会写进输出的尾巴，用户能看出「这次没干成是因为要写文件」。
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import {
  closeThreadSession,
  respondToApproval,
  respondToElicitation,
  runThreadPrompt
} from '@/features/agent/acp/session'
import { parseAcpStreamEvent } from '@/features/agent/acp/stream'
import { prepareTarget } from '@/features/agent/acp/target-guard'
import { createModelPort } from '@/features/agent/port/model'
import { finishAutomationRun } from '@/lib/automation-ipc'
import { EVENTS } from '@/shared/ipc/channels'
import { AutomationDueSchema, type AutomationDue } from '@/shared/ipc/specs/automation'
import { reportCaught } from '@/utils/exception-report'

/** 定时任务会话的 thread 前缀：这些 id 不进会话列表，只用来区分日志与隔离上下文 */
const THREAD_PREFIX = 'automation-'

const SYSTEM_PROMPT = `你是被定时任务唤起的一次性执行者，没有人正在看屏幕。
只做只读工作：检索、阅读、归纳。不要写文件，也不要发布文档。
不要向用户提问；需要审批的工具调用会被直接拒绝。
把结论用一段话直接写出来，不要客套。`

function createBlockID(): (messageId: string | null | undefined, kind: string) => string {
  return function (messageId, kind) {
    return `${kind}:${messageId ?? 'run'}`
  }
}

async function execute(due: AutomationDue): Promise<void> {
  const threadID = `${THREAD_PREFIX}${due.runId}`
  const blockID = createBlockID()
  let content = ''
  let denied = 0

  try {
    const target = await createModelPort().findTarget()
    if (!target) throw new Error('还没有可用的模型，请先到设置里选择供应商与模型')
    await prepareTarget(target.providerID, target.model, 'agent.automation')

    for await (const item of runThreadPrompt(threadID, {
      text: due.prompt,
      systemText: SYSTEM_PROMPT,
      providerID: target.providerID,
      modelID: target.model
    })) {
      if (item.kind === 'update') {
        const event = parseAcpStreamEvent(item.update, { blockID })
        if (event?.kind === 'text') content += event.text
        continue
      }
      if (item.kind === 'approval') {
        if (item.event.kind === 'tool-approval-request') {
          denied += 1
          respondToApproval({ toolCallId: item.event.toolCallId, approved: false })
        }
        continue
      }
      if (item.kind === 'elicitation') {
        if (item.event.kind === 'elicitation-request') {
          respondToElicitation({ elicitationId: item.event.elicitationId, action: 'cancel' })
        }
        continue
      }
    }

    const text = content.trim()
    const suffix = denied > 0 ? `\n\n（本轮有 ${denied} 次工具调用因无人审批被拒绝）` : ''
    await finishAutomationRun({
      runId: due.runId,
      output: (text || '（模型没有输出内容）') + suffix
    })
  } catch (error) {
    reportCaught('agent.automation.run', error)
    const message = error instanceof Error ? error.message : String(error)
    try {
      await finishAutomationRun({ runId: due.runId, error: message })
    } catch (inner) {
      // 回写都失败说明数据库/桥有问题；记录后交给 worker 的陈旧回收兜底
      reportCaught('agent.automation.finish', inner)
    }
  } finally {
    closeThreadSession(threadID)
  }
}

/** 串行队列：同时拉起多个会话既抢模型配额，也让日志无法对应 */
let chain: Promise<void> = Promise.resolve()

/**
 * 跑一次（定时触发与「立即执行」共用）：排队后再执行，避免两个会话抢配额。
 */
function runDue(due: AutomationDue): Promise<void> {
  const next = chain.then(function () {
    return execute(due)
  })
  chain = next.catch(function () {
    return undefined
  })
  return next
}

function enqueue(due: AutomationDue): void {
  void runDue(due)
}

/**
 * 安装事件监听。返回取消监听的函数（组件卸载时调用）。
 */
async function installAutomationRunner(): Promise<UnlistenFn> {
  return listen(EVENTS.AUTOMATION_DUE, function (event) {
    const parsed = AutomationDueSchema.safeParse(event.payload)
    if (!parsed.success) {
      reportCaught('agent.automation.payload', parsed.error, 'warning')
      return
    }
    enqueue(parsed.data)
  })
}

export { installAutomationRunner, runDue }
