/**
 * 「这一轮按哪个思考强度跑」的线程级覆盖。
 *
 * 与 `approval` / `mode` 同一套做法：执行侧在开会话之前把档位写在 thread 上，
 * 会话控制器（`applyGooseThinking`）读它来决定下发值。不这么做的话，任务钉的档位
 * 只能盖掉**用户偏好**（`agent.json` 的 modelPrefs），跑一次定时任务就把用户给这个
 * 模型选的那档改掉了 —— 后台任务不该动前台的手感。
 *
 * 纯内存、跑完即清：它描述的是「这一次执行」，不是持久配置（持久配置在任务行上）。
 */
import type { ThinkingLevel } from '@/features/persist'

const overrides = new Map<string, ThinkingLevel>()

function trimID(threadID: string | null | undefined): string {
  return threadID?.trim() ?? ''
}

/** 钉住某个会话这一轮的思考强度（任务执行前调用） */
function writeThinkingLevelFor(threadID: string | null | undefined, level: ThinkingLevel): void {
  const id = trimID(threadID)
  if (!id) return
  overrides.set(id, level)
}

/** 读覆盖值；没有覆盖（普通聊天）返回 null，由调用方回落到模型偏好 */
function readThinkingLevelFor(threadID: string | null | undefined): ThinkingLevel | null {
  const id = trimID(threadID)
  if (!id) return null
  return overrides.get(id) ?? null
}

/** 跑完清掉，避免同 id 会话下一轮被旧档位粘住 */
function clearThinkingLevelFor(threadID: string | null | undefined): void {
  const id = trimID(threadID)
  if (!id) return
  overrides.delete(id)
}

export { clearThinkingLevelFor, readThinkingLevelFor, writeThinkingLevelFor }
