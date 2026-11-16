/**
 * Git 操作层与视图之间的最小契约。
 *
 * code 窗（`stores/code-git`）与 agent 审阅面板（`features/agent/workspace/git`）
 * 各有一套缓存，但共用的 UI 只认这里的形状，避免把任何一方的 store 拖进 features。
 */

/** 动作结果：与 store 的 `GitOutcome` 同形 */
interface GitOpOutcome {
  ok: boolean
  message: string
}

interface GitOpHandlers {
  onStashPush: (options: {
    message?: string
    isIncludeUntracked?: boolean
  }) => Promise<GitOpOutcome>
  /** `isPop` = true 弹出（应用后丢弃），false 只应用 */
  onStashApply: (index: number, isPop: boolean) => Promise<GitOpOutcome>
  onStashDrop: (index: number) => Promise<GitOpOutcome>
  /** `upstream` 缺省 = 当前分支的上游 */
  onRebase: (upstream?: string | null) => Promise<GitOpOutcome>
  onRebaseContinue: () => Promise<GitOpOutcome>
  onRebaseAbort: () => Promise<GitOpOutcome>
}

export type { GitOpHandlers, GitOpOutcome }
