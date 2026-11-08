/**
 * 自动化执行生命周期事件：runner → 任务面板 store。
 *
 * 不用全局 EventTarget 广播业务状态，避免和 DOM 事件搅在一起；
 * 订阅方只有 `stores/automation`，跑完即清。
 */
import type { AutomationMode } from '@/shared/ipc/specs/automation'

/** 定时任务会话的 thread / agent_session id 前缀；侧栏「自动化」分组按此前缀归拢 */
const THREAD_PREFIX = 'automation-'

type AutomationLifeEvent =
  | {
      kind: 'start'
      automationId: string
      runId: string
      sessionId: string
      phase: AutomationMode
    }
  | {
      kind: 'phase'
      automationId: string
      runId: string
      sessionId: string
      phase: AutomationMode
    }
  | {
      /** 用户消息已落库且后台回合已开泵：UI 可切会话并 resume 流式 */
      kind: 'stream'
      automationId: string
      runId: string
      sessionId: string
      phase: AutomationMode
    }
  | {
      kind: 'finish'
      automationId: string
      runId: string
      sessionId: string
      ok: boolean
      error?: string
    }

type AutomationLifeListener = (event: AutomationLifeEvent) => void

const listeners = new Set<AutomationLifeListener>()

function subscribeAutomationLife(listener: AutomationLifeListener): () => void {
  listeners.add(listener)
  return function () {
    listeners.delete(listener)
  }
}

function publishAutomationLife(event: AutomationLifeEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch (error) {
      console.warn('[automation/events] 订阅方抛错:', error)
    }
  }
}

/** 侧栏 / 会话列表：新建自动化会话后请 reload threads */
const SESSION_EVENT = 'agent:automation-session'

function notifyAutomationSession(threadID: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { threadID } }))
}

function subscribeAutomationSession(listener: (threadID: string) => void): () => void {
  function onEvent(event: Event) {
    const detail = (event as CustomEvent<{ threadID?: string }>).detail
    if (detail?.threadID) listener(detail.threadID)
  }
  window.addEventListener(SESSION_EVENT, onEvent)
  return function () {
    window.removeEventListener(SESSION_EVENT, onEvent)
  }
}

export {
  THREAD_PREFIX,
  notifyAutomationSession,
  publishAutomationLife,
  subscribeAutomationLife,
  subscribeAutomationSession
}
export type { AutomationLifeEvent }
