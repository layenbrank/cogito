/**
 * 新建会话的「归属工作区」草稿。
 *
 * 需求是「会话归哪个工作区，取决于用户点的哪个 +」：工作区节点上的「+」归属该工作区，
 * 顶部「新的任务」归属当前激活工作区，一个工作区都没有时归属「未分组」。
 *
 * 难点在时序：assistant-ui 的 `switchToNewThread()` 只种下一个**本地**线程（不进列表、不落库），
 * 真正写库发生在首条消息触发 `adapter.initialize()` 时。这之间用户切了工作区，
 * 「读当前工作区指针」就会把会话挂到别处去。所以点击那一刻先记下归属，落库时再取用。
 *
 * 为什么只需要一个槽位：库同一时刻只有一个未落库的新会话（落库前 `switchToNewThread()`
 * 复用同一个 `newThreadId`），「下一个要落库的新会话」必然是用户最后点的那一个。
 *
 * `null` 是明确表态「未分组」——与「没记过」（`undefined`）不同。
 */

type DraftWorkspace = string | null

let pending: { workspaceID: DraftWorkspace } | null = null

/** 记下「下一个落库的新会话」归属哪个工作区 */
function rememberNextThreadWorkspace(workspaceID: DraftWorkspace): void {
  pending = { workspaceID }
}

/** 落库时取走：取过就清空，避免影响到更后面的新会话 */
function takeNextThreadWorkspace(): { workspaceID: DraftWorkspace } | null {
  const value = pending
  pending = null
  return value
}

export { rememberNextThreadWorkspace, takeNextThreadWorkspace }
