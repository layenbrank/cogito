/**
 * 「这一次调用该不该问用户」—— 审批的业务判定，纯函数。
 *
 * 这是全仓最关键的**安全闸门**之一。它原先埋在 client 一个上千行的传输模块里，
 * 没有任何单元测试；现在移到协议层，client 与浏览器扩展共用同一份判定 ——
 * 两端各写一版「只读档该不该拦写工具」，迟早有一端会写反。
 *
 * ## 三种结果
 *
 * - `ask`：推给 UI，让用户自己点（默认分支，也是唯一「不替用户决定」的分支）；
 * - `allow` / `deny`：已经替用户拍板的 optionId；
 * - `cancel`：要拦但拿不到合适的选项 —— **fail-closed**，绝不放行。
 *
 * ## 为什么只用 `*_once`
 *
 * `allow_always` / `reject_always` 会被 goose 写进 `permission.yaml` 的 `user` 段，
 * 那是全进程持久的用户偏好：一次自动放行会变成永久放行，一次自动拒绝会变成永久禁用。
 * 替用户拍板只能是「这一次」。
 *
 * ## 为什么拒绝不看 `cancelled`
 *
 * `cancelled` 在 goose 里是中止整个回合：模型只知道「被打断」，不会改用
 * `cogito_workspace_write`，用户只看到对话停了。`reject_once` 才是「拒这个工具、继续」。
 */

import {
  findGooseMode,
  findHardDenyLevel,
  isWriteTool,
  type ApprovalMode
} from '@cogito/agent-protocol/policy'

/** 一条审批选项（goose 的 `PermissionOption`：`optionId` 与 `kind` 目前同值） */
interface ApprovalOption {
  optionId: string
  kind: string
}

type ApprovalOutcome =
  /** 该问用户 */
  | { kind: 'ask' }
  /** 替用户放行（`optionId` 必然是 `allow_once`） */
  | { kind: 'allow'; optionId: string }
  /** 替用户拒绝（`optionId` 必然是 `reject_once`） */
  | { kind: 'deny'; optionId: string }
  /** 要拦但拿不到合适选项：按取消结案 */
  | { kind: 'cancel'; reason: string }

interface ApprovalDecisionInput {
  toolName: string
  /** 有效审批档（会话覆盖 → 全局偏好 → 计划模式强制只读） */
  approvalMode: ApprovalMode
  /** 计划模式：这一轮在出计划，不该落盘 */
  planning: boolean
  /** 目标推进中：无人值守的长任务 */
  goalActive: boolean
  options: readonly ApprovalOption[]
}

function pickOnce(options: readonly ApprovalOption[], kind: string): string | null {
  const hit = options.find(function (option) {
    return option.kind === kind
  })
  return hit ? hit.optionId : null
}

function decideApproval(input: ApprovalDecisionInput): ApprovalOutcome {
  // 1. 硬禁用。goose 侧本来会靠 permission.yaml 的 never_allow 拦，但那是
  //    一份可被清空、可被用户改的全局文件 —— auto 档下它是**唯一**拦住黑盒 shell 的
  //    屏障，不能只有这一道。
  //
  //    **询问档例外**：用户选的就是「让我决定」。以前这里一律替用户拒，结果是
  //    「选了询问审批，工具却没人问就被拒」—— goose 的写入会被记成用户拒绝，模型据此
  //    反复改道，而用户完全不知道发生过什么。现在把卡推给用户，卡上标出风险与替代工具。
  //    计划模式仍然直接拒：那一轮本来就不该落盘，没有「允许一次」的语义。
  if (findHardDenyLevel(input.toolName) !== null) {
    if (input.approvalMode === 'ask' && !input.planning) return { kind: 'ask' }
    const optionId = pickOnce(input.options, 'reject_once')
    return optionId
      ? { kind: 'deny', optionId }
      : { kind: 'cancel', reason: `硬禁用工具 ${input.toolName} 拿不到 reject_once 选项` }
  }

  // 2. 只读档 / 计划模式：写工具直接拒，只读工具直接放行 —— 否则 `approve` 档下
  //    连 list/read 都要弹一张卡，用户会被淹。
  if (input.planning || input.approvalMode === 'readonly') {
    if (isWriteTool(input.toolName)) {
      const optionId = pickOnce(input.options, 'reject_once')
      return optionId
        ? { kind: 'deny', optionId }
        : { kind: 'cancel', reason: `只读策略拒绝 ${input.toolName} 但拿不到 reject_once` }
    }
    const optionId = pickOnce(input.options, 'allow_once')
    // 只读工具自动放行失败不致命：退回「问用户」比中止回合更合理
    return optionId ? { kind: 'allow', optionId } : { kind: 'ask' }
  }

  // 3. 目标推进：这一线程不是「问一次动一下」，但**只在用户当前就是自动审批**时才放行
  if (input.goalActive && input.approvalMode === 'auto') {
    const optionId = pickOnce(input.options, 'allow_once')
    return optionId
      ? { kind: 'allow', optionId }
      : { kind: 'cancel', reason: '目标推进放行时拿不到 allow_once 选项' }
  }

  return { kind: 'ask' }
}

export { decideApproval, findGooseMode }
export type { ApprovalDecisionInput, ApprovalOption, ApprovalOutcome }
