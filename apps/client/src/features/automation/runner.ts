/**
 * 定时任务的执行侧（前端）：收到 `automation:due` 就起一次性会话跑 prompt，跑完回写结果。
 *
 * 为什么执行在前端：会话挂在 WebView 侧的 goose ACP 连接上，Rust 侧拿不到模型通道。
 * 因此 `owner=client` 的语义是「应用开着才执行」，worker 只负责 claim + 通知。
 *
 * 三个执行配置决定这一轮怎么跑（都存在 `automation` 表里）：
 * - `workspaceId`：会话 cwd 跟着它走（`ensureThreadSession → findWorkspaceCwd`）；
 *   配了目录却解析不到时**直接判失败**（fail-closed），绝不退回家目录 —— 否则 `auto`
 *   档会静默在家目录里自动写文件，绕过「必须圈定目录」这条底线；
 * - `approval`：`readonly` 沿用旧语义，一律拒绝审批；`auto` 直接批准（计数），
 *   前提是任务必须有工作目录，`Service::toSave` 已经卡住；
 * - 跑完发系统通知：定时任务没有人在看，静默结束等于什么都没发生。
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
import { clearApprovalModeFor, writeApprovalModeFor } from '@/features/agent/approval'
import { notifyAutomationRun } from '@/features/agent/notify'
import { buildModelPort } from '@/features/agent/port/model'
import {
  findAutomationSystemPrompt,
  parseAutomationApproval,
  shouldApprove,
  summarizeRunOutput,
  type AutomationApproval,
  type RunCounters
} from '@/features/automation/run-plan'
import { finishAutomationRun, touchAutomationRun } from '@/lib/automation-ipc'
import { EVENTS } from '@/shared/ipc/channels'
import { AutomationDueSchema, type AutomationDue } from '@/shared/ipc/specs/automation'
import { useAgentStore } from '@/stores/agent.ts'
import { reportCaught } from '@/utils/exception-report'

/** 定时任务会话的 thread 前缀：这些 id 不进会话列表，只用来区分日志与隔离上下文 */
const THREAD_PREFIX = 'automation-'

function makeBlockID(): (messageId: string | null | undefined, kind: string) => string {
  return function (messageId, kind) {
    return `${kind}:${messageId ?? 'run'}`
  }
}

/**
 * 确认这次执行的工作目录真的存在（fail-closed）。
 *
 * `ensureThreadSession → findWorkspaceCwd` 解析不到会静默 `return homeDir()`，
 * 于是「任务里配了目录」和「实际在家目录里写文件」两件事悄悄错位。这里先自己校验一遍：
 * 工作区被删、换绑、或 `workspaceFolders` 还没加载（应用停在别的页面时很常见）都判失败，
 * 让记录写下真实原因，而不是跑到家目录里乱动。
 */
async function requireWorkspace(workspaceId: string | null, approval: AutomationApproval): Promise<void> {
  if (!workspaceId) {
    // 没有目录只允许只读：`auto` 后端已拦，这里兜住被外部改过的数据
    if (shouldApprove(approval)) {
      throw new Error('任务没有指定工作目录，不能自动批准执行')
    }
    return
  }
  // 现读一次：定时触发时页面未必停在任务页，store 里可能是空数组
  const folders = await useAgentStore.getState().toReadWorkspaceFolders()
  const found = folders.find(function (item) {
    return item.workspaceID === workspaceId && Boolean(item.path)
  })
  if (!found) {
    throw new Error(`任务的工作目录已不可用（工作区可能已被删除或未加载，id=${workspaceId}），请到任务表单重新指定`)
  }
}

async function execute(due: AutomationDue): Promise<void> {
  const threadID = `${THREAD_PREFIX}${due.runId}`
  const blockID = makeBlockID()
  const approval = parseAutomationApproval(due.approval)
  const approvalShouldPass = shouldApprove(approval)
  const counters: RunCounters = { denied: 0, granted: 0 }
  let content = ''

  try {
    // 目录先解析：解析不到就判失败，绝不悄悄退回家目录
    await requireWorkspace(due.workspaceId ?? null, approval)
    // 真正开跑才补写 startedAt：排队的时间既不该算进耗时，也不该让排队的记录被判「陈旧」
    await touchAutomationRun(due.runId)

    const target = await buildModelPort().findTarget()
    if (!target) throw new Error('还没有可用的模型，请先到设置里选择供应商与模型')
    await prepareTarget(target.providerID, target.model, 'agent.automation')

    // 先把档位写到这个会话上：`ensureThreadSession` 开会话时据此把 mode 推给 goose
    writeApprovalModeFor(threadID, approval)

    for await (const item of runThreadPrompt(threadID, {
      text: due.prompt,
      systemText: findAutomationSystemPrompt(approval),
      // cwd 跟着任务的工作目录走；没配才是家目录（配了但解析不到已被 requireWorkspace 拦下）
      workspaceID: due.workspaceId ?? null,
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
          if (approvalShouldPass) counters.granted += 1
          else counters.denied += 1
          respondToApproval({ toolCallId: item.event.toolCallId, approved: approvalShouldPass })
        }
        continue
      }
      if (item.kind === 'elicitation') {
        if (item.event.kind === 'elicitation-request') {
          // 追问没有人回答：一律取消，不让这一轮挂在票据超时上
          respondToElicitation({ elicitationId: item.event.elicitationId, action: 'cancel' })
        }
        continue
      }
    }

    await finishAutomationRun({
      runId: due.runId,
      output: summarizeRunOutput(content, counters, approval)
    })
    await notifyAutomationRun(due.name, true, null)
  } catch (error) {
    reportCaught('agent.automation.run', error)
    const message = error instanceof Error ? error.message : String(error)
    try {
      await finishAutomationRun({ runId: due.runId, error: message })
    } catch (inner) {
      // 回写都失败说明数据库/桥有问题；记录后交给 worker 的陈旧回收兜底
      reportCaught('agent.automation.finish', inner)
    }
    // 失败一定要报：定时任务没人看着，静默失败等于没跑
    await notifyAutomationRun(due.name, false, message)
  } finally {
    // 一次性会话的审批档只存在内存里（approval.ts 的 transientApproval），跑完就丢
    clearApprovalModeFor(threadID)
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
