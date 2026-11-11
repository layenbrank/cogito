/**
 * Approval card 的纯函数层（对齐 assistant-ui `elements/approval-card`）。
 *
 * 卡片只认四态：等人答复 / 正在执行 / 做完了 / 被拒绝。宿主那边通常只是几个布尔量
 * （答复了吗、答的是什么、结果到了吗），换算收在这里，组件里不再写 if 链。
 */

type ApprovalState = 'request' | 'running' | 'done' | 'denied'
type ApprovalVariant = 'default' | 'destructive'

/** 明细表的一行：标签 + 值（会话数 / 文件数 / 目标环境这类） */
interface ApprovalDetail {
  label: string
  value: string
}

/** 还在等人答复：footer 是动作按钮，不是收据 */
function isApprovalRequest(state: ApprovalState): boolean {
  return state === 'request'
}

/** 收据那行的图标：执行中转圈、完成对勾、拒绝打叉（只有收据态用它） */
function findApprovalStatusIcon(state: ApprovalState): string {
  if (state === 'running') return 'lucide:loader-circle'
  if (state === 'done') return 'lucide:check'
  return 'lucide:x'
}

/**
 * 宿主的三个布尔量 → 元素四态。
 *
 * 取消按拒绝算：这条路已经不会执行了，收据上再分「谁取消的」对读者没用。
 * `settled` 是「工具结果到了没有」—— 答应了但还在跑就是 `running`，别提前报完成。
 */
function toApprovalState(input: {
  approved?: boolean
  cancelled?: boolean
  settled?: boolean
}): ApprovalState {
  if (input.cancelled) return 'denied'
  if (input.approved === undefined) return 'request'
  if (!input.approved) return 'denied'
  return input.settled ? 'done' : 'running'
}

export { findApprovalStatusIcon, isApprovalRequest, toApprovalState }
export type { ApprovalDetail, ApprovalState, ApprovalVariant }
