/**
 * 回合尾注：这一轮是「说完了」还是「断在半路」。
 *
 * 以前只有 `incomplete / cancelled` 会在正文末尾留一行「已停止生成」，正常跑完的回合
 * 什么都不显示 —— 于是「模型答完了」「界面悄悄断了」「流被截断」在视觉上完全一样，
 * 用户只能靠猜。这里把四种结局统一成一句话，全都挂在正文末尾：
 *
 * - `complete`：只标**最后一条**消息。历史回合逐条刷「已完成」会把对话刷成日志。
 * - `incomplete / cancelled`：用户自己按的停止。
 * - `incomplete / length`：撞到长度上限，正文是被切掉的，必须区别于「正常结束」。
 * - `incomplete / 其它`（content-filter / other / tool-calls）：按「中断」处理。
 * - `incomplete / error`：返回 null —— 消息上的错误块已经写明了原因，别重复两遍。
 * - `running` / `requires-action`：还没结束（或等人审批），不标。
 *
 * 纯函数：渲染层只负责把 `tone` 落到样式上，文案和图标都在这里定，便于单测。
 */
import type { MessageStatus } from '@assistant-ui/react'

import type { AssistantLabels } from './labels'

type RunNoteTone = 'complete' | 'cancelled' | 'truncated' | 'interrupted'

interface RunNote {
  readonly tone: RunNoteTone
  /** @iconify 图标名（离线集合里已包含） */
  readonly icon: string
  readonly iconClassName: string
  readonly text: string
}

type RunNoteLabels = Pick<
  AssistantLabels,
  'completedRun' | 'stoppedRun' | 'truncatedRun' | 'interruptedRun'
>

function findRunNote(
  status: MessageStatus | undefined,
  isLast: boolean,
  labels: RunNoteLabels
): RunNote | null {
  if (!status) return null
  if (status.type === 'running' || status.type === 'requires-action') return null

  if (status.type === 'complete') {
    if (!isLast) return null
    return {
      tone: 'complete',
      icon: 'lucide:circle-check',
      iconClassName: 'size-3 shrink-0 opacity-70',
      text: labels.completedRun
    }
  }

  // 错误：正文下方已有红色错误块，再挂一句就是重复
  if (status.reason === 'error') return null

  if (status.reason === 'cancelled') {
    return {
      tone: 'cancelled',
      icon: 'lucide:square',
      iconClassName: 'size-2.5 shrink-0 fill-current opacity-70',
      text: labels.stoppedRun
    }
  }

  if (status.reason === 'length') {
    return {
      tone: 'truncated',
      icon: 'lucide:triangle-alert',
      iconClassName: 'size-3 shrink-0 opacity-70',
      text: labels.truncatedRun
    }
  }

  return {
    tone: 'interrupted',
    icon: 'lucide:circle-x',
    iconClassName: 'size-3 shrink-0 opacity-70',
    text: labels.interruptedRun
  }
}

export { findRunNote }
export type { RunNote, RunNoteLabels, RunNoteTone }
