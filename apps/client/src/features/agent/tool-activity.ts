/**
 * 工具调用的**活动状态**：所有工具卡共用这一份判定。
 *
 * 为什么需要它：以前每张卡各写一句 `props.status?.type === 'running'`，于是
 * 「等用户点审批」（`requires-action`）、「被取消」（`incomplete/cancelled`）都掉进
 * 「不是 running」那一侧，被画成绿勾「执行完成」—— 用户看到的是一张撒谎的卡。
 * 还有一类更隐蔽：终端工具超时返回 `isRunning: true`（命令还在跑），
 * status 却是 `complete`，进度卡于是把进度条拉满、写「已结束」。
 *
 * 判定只读 part 上已有的三个事实（status / isError / result），不猜业务：
 * - `requires-action` → `waiting`（在等人）
 * - `incomplete + cancelled` → `cancelled`（没跑完，也没报错）
 * - `incomplete` 其它 → `failed`
 * - `complete` + `isError` → `failed`
 * - `complete` + `result.isRunning === true` → `running`（长跑命令的续读态）
 * - 其余 `complete` → `done`
 * - 没有 status 时按 `isError` / 有没有 result 兜底；两者都没有按 `cancelled`
 *   （历史里那种「有 tool-call、永远没有结果」的行，绝不能画成执行中）
 */

type ToolActivity = 'running' | 'waiting' | 'cancelled' | 'failed' | 'done'

interface ToolActivityStatus {
  readonly type: string
  readonly reason?: string
}

interface ToolActivityInput {
  status?: ToolActivityStatus | null
  isError?: boolean | undefined
  result?: unknown
}

/** 结果里自己说「还没跑完」（终端工具的 `isRunning` / 任务卡的 `status`） */
function isResultRunning(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  const record = result as Record<string, unknown>
  return record.isRunning === true
}

function findToolActivity(input: ToolActivityInput): ToolActivity {
  const status = input.status
  if (!status) {
    if (input.isError === true) return 'failed'
    return input.result === undefined ? 'cancelled' : 'done'
  }
  if (status.type === 'requires-action') return 'waiting'
  if (status.type === 'running') return 'running'
  if (status.type === 'incomplete') {
    return status.reason === 'cancelled' ? 'cancelled' : 'failed'
  }
  if (input.isError === true) return 'failed'
  if (isResultRunning(input.result)) return 'running'
  return 'done'
}

export { findToolActivity, isResultRunning }
export type { ToolActivity, ToolActivityInput, ToolActivityStatus }
