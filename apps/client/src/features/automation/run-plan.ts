/**
 * 任务执行的**纯逻辑**：审批档解释、系统提示、输出尾巴、阶段选择。
 *
 * 单独成文件是为了可单测：`runner.ts` 一上来就要 `@tauri-apps/api/event` 与 ACP 连接，
 * 在 vitest 里跑不起来；而「readonly 与 auto 分别怎么处理审批」恰恰是最该被测的分叉。
 */
import { isThinkingLevel } from '@/features/agent/model/thinking-effort-map'
import { findAgentMode } from '@/features/agent/mode'
import type { ThinkingLevel } from '@/features/persist'
import type { ApprovalMode } from '@/features/agent/approval'
import type { AutomationMode } from '@/shared/ipc/specs/automation'

/** 任务只有两档：无人值守下 `ask` 没有人应答，不进任务定义 */
type AutomationApproval = Extract<ApprovalMode, 'readonly' | 'auto'>

const AUTOMATION_APPROVAL: Record<AutomationApproval, AutomationApproval> = {
  readonly: 'readonly',
  auto: 'auto'
}

/** 缺省与未知值一律按只读处理（失败关闭：新枚举值不该悄悄放开写权限） */
function parseAutomationApproval(value: string | null | undefined): AutomationApproval {
  return value === AUTOMATION_APPROVAL.auto
    ? AUTOMATION_APPROVAL.auto
    : AUTOMATION_APPROVAL.readonly
}

const READONLY_PROMPT = `你是被定时任务唤起的执行者，没有人正在看屏幕。
只做只读工作：检索、阅读、归纳。不要写文件，也不要发布文档。
不要向用户提问；需要审批的工具调用会被直接拒绝。
把结论用一段话直接写出来，不要客套。`

const AUTO_PROMPT = `你是被定时任务唤起的执行者，没有人正在看屏幕；这一轮已获准自动执行工具。
工作目录已在任务里指定：只在该目录内读写，不要越界到别处，也不要碰与任务无关的文件。
不要向用户提问。把做过什么、改动了哪些文件用一段话讲清楚，不要客套。`

/**
 * 把绝对目录写进 System Prompt。
 *
 * 只靠 cwd 不够：cwd 只决定相对路径从哪儿展开，模型完全可以拼绝对路径去别处；
 * 而「工作目录已在任务里指定」这句话本身不告诉它是哪个目录 —— 它只能猜，猜错就是
 * 在别的项目里翻文件（既错又费 token）。这里把路径直接摊开，越界规则也点名。
 */
function buildWorkspaceScope(workdir: string | null | undefined): string {
  const trimmed = workdir?.trim()
  if (!trimmed) return ''
  return `本次执行的工作目录是 ${trimmed}。所有读写都相对它展开：不要访问这个目录之外的任何文件（同一工作区的其它项目也算外面），也不要为此再做探索。`
}

const PLAN_THEN_GOAL_BRIDGE = `上一阶段已经产出计划。现在按该计划推进到可验证终态。
不要重新规划；遇到偏差就在计划范围内修正。`

function findAutomationSystemPrompt(
  approval: AutomationApproval,
  mode: AutomationMode = 'agent',
  workdir?: string | null
): string {
  const base = approval === AUTOMATION_APPROVAL.auto ? AUTO_PROMPT : READONLY_PROMPT
  const scope = buildWorkspaceScope(workdir)
  const guidance = findAgentMode(mode).guidance.trim()
  return [base, scope, guidance]
    .filter(function (part) {
      return Boolean(part)
    })
    .join('\n\n')
}

/**
 * 任务上的思考强度：缺省 / 未知值一律「标准」。
 *
 * 与审批同一套「失败关闭」思路，但方向相反：认不出就退回安全的常态档，而不是
 * 悄悄用最高档烧 token —— 老任务（加列前没有这个字段）升级后行为必须不变。
 */
function parseAutomationThinking(value: string | null | undefined): ThinkingLevel {
  const level = value?.trim().toLowerCase() ?? ''
  return isThinkingLevel(level) ? level : 'medium'
}

/** 审批请求在这一档下该不该放行（readonly 保持既有「一律拒绝」语义） */
function shouldApprove(approval: AutomationApproval): boolean {
  return approval === AUTOMATION_APPROVAL.auto
}

/**
 * 这一轮实际跑哪个阶段：流水线开 → 先 plan；否则用任务配置的单模式。
 */
function findInitialPhase(planThenGoal: boolean, mode: AutomationMode): AutomationMode {
  return planThenGoal ? 'plan' : mode
}

/**
 * 流水线是否还要进目标段：只有「计划后执行」且刚跑完 plan 才衔接到 goal。
 */
function shouldContinueToGoal(planThenGoal: boolean, phase: AutomationMode): boolean {
  return planThenGoal && phase === 'plan'
}

interface RunCounters {
  /** 因无人审批被拒绝的工具调用次数（readonly 档） */
  denied: number
  /** 自动批准的工具调用次数（auto 档） */
  granted: number
  /** 自动批准档下因为越出任务目录被拒绝的次数（不执行，直接打回给模型） */
  blocked: number
}

/**
 * 记录里的最终输出：正文 + 一句「审批发生了什么」。
 *
 * 拒绝次数必须写出来 —— 否则用户只看到「任务成功」却什么都没干，无从判断是模型偷懒
 * 还是被权限拦住了。
 */
function summarizeRunOutput(
  text: string,
  counters: RunCounters,
  approval: AutomationApproval
): string {
  const body = text.trim() || '（模型没有输出内容）'
  const notes: string[] = []
  if (counters.denied > 0) {
    notes.push(`（本轮有 ${counters.denied} 次工具调用因无人审批被拒绝）`)
  }
  // 越界被拦是「自动批准」档的独有情况：写在记录里，用户才知道为什么任务没做完
  if (counters.blocked > 0 && shouldApprove(approval)) {
    notes.push(`（本轮有 ${counters.blocked} 次工具调用越出任务目录被拒绝）`)
  }
  if (counters.granted > 0 && shouldApprove(approval)) {
    notes.push(`（本轮自动批准了 ${counters.granted} 次工具调用）`)
  }
  if (notes.length === 0) return body
  return `${body}\n\n${notes.join('\n')}`
}

export {
  AUTOMATION_APPROVAL,
  AUTO_PROMPT,
  PLAN_THEN_GOAL_BRIDGE,
  READONLY_PROMPT,
  buildWorkspaceScope,
  findAutomationSystemPrompt,
  findInitialPhase,
  parseAutomationApproval,
  parseAutomationThinking,
  shouldApprove,
  shouldContinueToGoal,
  summarizeRunOutput
}
export type { AutomationApproval, RunCounters }
