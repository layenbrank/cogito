/**
 * 目标后台续跑：用户切到别的会话时，原线程跑完一轮后**自动接着推**。
 *
 * 分工（两者互斥，避免同一轮被推进两次）：
 * - **当前会话**：`GoalAutoAdvance` 走 composer，续跑消息能在界面上流式看到；
 * - **其它会话**：这里挂在 `background-turn` 的回合结束钩子上，用 ACP 泵继续跑，
 *   历史自己写 —— composer 只服务当前线程，切走后用不上。
 *
 * 切回来时走 `history.load()` 就能看到后台推进出的完整记录。
 */
import type { ChatHistoryPort, ChatStreamEvent } from '@cogito/chat/ports'
import { mapChatStreamToRunResults } from '@cogito/chat/adapters/chat-model'
import { LOCAL_FORMAT } from '@cogito/chat/adapters/thread-history'
import { v4 as UUIDV4 } from 'uuid'

import {
  abortBackgroundTurn,
  ensureBackgroundTurn,
  hasRunningBackgroundTurn,
  onBackgroundTurnFinished,
  type BackgroundTurn
} from '@/features/agent/acp/background-turn'
import { runThreadPrompt } from '@/features/agent/acp/session'
import { parseAcpStreamEvent, type AcpStreamContext } from '@/features/agent/acp/stream'
import { buildPromptContext } from '@/features/agent/model/prompt-context'
import { findSystemPrompt } from '@/features/agent/model/prompts'
import { findAgentMode, readAgentModeThread } from '@/features/agent/mode'
import type { ScenarioKey } from '@/features/agent/model/scenarios'
import { notifyTurnDone } from '@/features/agent/notify'
import {
  advanceGoalRun,
  buildContinuePrompt,
  findGoalSignal,
  finishGoalRun,
  parseGoalProgress,
  readGoalRun,
  setGoalProgress,
  stopGoalRun
} from '@/features/agent/goal-run'
import type { GoalFinishStatus } from '@/features/agent/goal-run'

/** 跑一轮需要的会话上下文；由 model port 在每次运行时登记 */
interface GoalTurnContext {
  workspaceID: string | null
  providerID: string
  modelID?: string
  /** 该线程最近一轮用的场景：后台续跑不能用全局当前场景 */
  scenario: ScenarioKey
}

const contexts = new Map<string, GoalTurnContext>()
let historyPort: ChatHistoryPort | null = null

function rememberGoalTurnContext(threadID: string, context: GoalTurnContext): void {
  contexts.set(threadID, context)
}

/** 历史端口由 `port/thread-history` 在构建适配器时绑进来（后台轮次要自己落库） */
function bindGoalHistoryPort(port: ChatHistoryPort | null): void {
  historyPort = port
}

/**
 * 数组 → AsyncIterable：`mapChatStreamToRunResults` 只吃异步流。
 * 用 `Promise.resolve` 而不是 `async function*` —— 这里没有真实异步，写成 async 会遮住「没 await」这个事实。
 */
function toAsyncIterable(events: readonly ChatStreamEvent[]): AsyncIterable<ChatStreamEvent> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0
      return {
        next() {
          if (index >= events.length) {
            return Promise.resolve({ done: true as const, value: undefined })
          }
          const value = events[index]
          index += 1
          return Promise.resolve({ done: false as const, value })
        }
      }
    }
  }
}

/** 从后台回合的事件缓冲里取最终助手正文 */
async function readTurnText(events: readonly ChatStreamEvent[]): Promise<string> {
  let text = ''
  for await (const result of mapChatStreamToRunResults(toAsyncIterable(events))) {
    const parts = result.content ?? []
    text = parts
      .filter(function (part) {
        return part.type === 'text'
      })
      .map(function (part) {
        return part.type === 'text' ? part.text : ''
      })
      .join('\n')
      .trim()
  }
  return text
}

/** 把续跑指令写成一条 user 消息：切回来时历史是连着的，不是一串孤儿助手回复 */
async function appendUserMessage(threadID: string, text: string): Promise<void> {
  if (!historyPort) {
    console.warn('[agent/goal-continue] 历史端口未绑定，跳过写续跑用户消息:', threadID)
    return
  }
  try {
    const rows = await historyPort.findMessages({ threadID })
    const parentID = rows.length > 0 ? rows[rows.length - 1].id : null
    await historyPort.appendMessage({
      threadID,
      id: UUIDV4(),
      parentID,
      format: LOCAL_FORMAT,
      content: JSON.stringify({
        role: 'user',
        content: [{ type: 'text', text }],
        createdAt: new Date().toISOString()
      })
    })
  } catch (error) {
    console.warn('[agent/goal-continue] 写续跑用户消息失败:', error)
  }
}

/** 在后台起一轮目标推进（不经过 composer，不需要 UI 订阅） */
function startGoalTurn(threadID: string, prompt: string, context: GoalTurnContext): void {
  void (async function () {
    // 与前台 port.run 同槽：若仍有旧泵（极少见竞态），先停再开，避免 start 冲突
    if (hasRunningBackgroundTurn(threadID)) {
      await abortBackgroundTurn(threadID)
    }
    await ensureBackgroundTurn(threadID, async function* (signal) {
      // 不能用 `appendModeGuidance()`：它读的是**当前 UI 线程**的模式，
      // 后台线程可能不在前台，读到的是别的模式 —— 续跑必须固定用目标模式的约束。
      // 场景同理：用登记下来的那个，不读全局。
      const systemText = [
        findSystemPrompt(context.scenario, buildPromptContext()),
        findAgentMode('goal').guidance
      ]
        .filter(function (part) {
          return part.trim().length > 0
        })
        .join('\n\n')
      const streamContext: AcpStreamContext = {
        blockID: function (messageId, kind) {
          return messageId ? `${kind}:${messageId}` : `${kind}:goal`
        }
      }
      try {
        for await (const item of runThreadPrompt(threadID, {
          text: prompt,
          systemText,
          workspaceID: context.workspaceID,
          providerID: context.providerID,
          modelID: context.modelID,
          signal
        })) {
          if (item.kind === 'update') {
            const event = parseAcpStreamEvent(item.update, streamContext)
            if (event) yield event
            continue
          }
          if (item.kind === 'stop') {
            yield item.stopReason === 'cancelled'
              ? { kind: 'aborted', usage: {} }
              : { kind: 'finish', finishReason: item.stopReason, usage: {} }
            return
          }
          // approval / elicitation：后台没人应答，交给票据超时兜底（启动目标推进时已提示审批档）
        }
      } catch (error) {
        console.warn('[agent/goal-continue] 后台轮次异常:', threadID, error)
        yield {
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
          usage: {}
        }
      }
    })
  })().catch(function (error) {
    console.warn('[agent/goal-continue] 启动后台轮次失败:', threadID, error)
  })
}

/** 一段目标推进结束：先写入明确终态再通知（`notifyTurnDone` 见有活跃目标会跳过） */
function finishGoal(
  threadID: string,
  body: string,
  status: GoalFinishStatus = 'paused'
): void {
  if (status === 'paused') {
    stopGoalRun(threadID)
  } else {
    finishGoalRun(threadID, status)
  }
  void notifyTurnDone(threadID, false, body)
}

async function handleTurnFinished(turn: BackgroundTurn): Promise<void> {
  const goal = readGoalRun(turn.threadID)
  if (!goal) return
  // 当前会话的续跑交给 UI（composer 才有流式显示），这里只管切走的那些
  if (readAgentModeThread() === turn.threadID) return

  // 被用户停止 / 新一轮 supersede：不自动续跑（避免与前台 port.run 抢槽）
  const terminal = turn.events.findLast
    ? turn.events.findLast(function (event) {
        return event.kind === 'finish' || event.kind === 'aborted' || event.kind === 'error'
      })
    : [...turn.events].reverse().find(function (event) {
        return event.kind === 'finish' || event.kind === 'aborted' || event.kind === 'error'
      })
  if (terminal?.kind === 'aborted' || terminal?.kind === 'error') return

  const text = await readTurnText(turn.events)
  if (!text) return
  setGoalProgress(turn.threadID, parseGoalProgress(text))

  const signal = findGoalSignal(text)
  if (signal === 'done') {
    finishGoal(turn.threadID, '目标推进完成', 'done')
    return
  }
  // 首轮宽松（模型常先干一半就收尾），后续轮次没打标记视为已收敛，避免空转
  if (!signal && goal.used > 0) {
    finishGoal(turn.threadID, '目标推进已停（本轮未报继续）', 'paused')
    return
  }

  const context = contexts.get(turn.threadID)
  if (!context) {
    console.warn('[agent/goal-continue] 缺少轮次上下文，停止后台推进:', turn.threadID)
    finishGoal(turn.threadID, '目标推进已停（上下文缺失）', 'paused')
    return
  }

  if (!advanceGoalRun(turn.threadID)) {
    // advance 已写 exhausted，只通知，勿再 pause
    void notifyTurnDone(turn.threadID, false, `已达目标推进上限（${goal.budget} 轮）`)
    return
  }
  const next = readGoalRun(turn.threadID)
  if (!next) return

  const prompt = buildContinuePrompt(next)
  await appendUserMessage(turn.threadID, prompt)
  startGoalTurn(turn.threadID, prompt, context)
}

onBackgroundTurnFinished(handleTurnFinished)

export { bindGoalHistoryPort, rememberGoalTurnContext }
