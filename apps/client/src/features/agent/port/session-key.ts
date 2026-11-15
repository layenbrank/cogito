/**
 * 会话标识口径：**列表项 id ≠ 库内会话 id**。
 *
 * assistant-ui 给还没落库的新会话种下的列表项 id 形如 `__LOCALID_…`，落库后
 * 这一串**不会**变成库内 id（晋升时保留草稿 id，另给一个 `remoteId`）。
 * 所以它只能用来认「界面上是哪一个」，不能当偏好 / 档案 / 排队的持久化键 ——
 * 用草稿 id 写进去的行，重启后按库内 id 永远读不回来。
 */

/** assistant-ui 给「还没落库的新会话」的列表项 id 前缀 */
const DRAFT_THREAD_PREFIX = '__LOCALID_'

function isDraftSessionKey(id: string | null | undefined): boolean {
  return Boolean(id?.startsWith(DRAFT_THREAD_PREFIX))
}

export { DRAFT_THREAD_PREFIX, isDraftSessionKey }
