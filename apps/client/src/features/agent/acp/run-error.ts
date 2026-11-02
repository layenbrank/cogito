/**
 * 一轮对话「怎么失败的」翻译成人话。
 *
 * 两件事在这里定：
 * 1. **取消不是失败**：用户按停止会把 `session/prompt` 的请求打回，ACP SDK 顺手
 *    reject 掉排队中的 `nextUpdate()`，泵和 prompt 两条路都会收到同一个 abort 错误。
 *    判成失败就会在用户主动停止时弹一个红色错误块。
 * 2. **连接被重置要说清下一步**：这些消息原本是 SDK / WebView 的内部话术
 *    （`Active session disposed`、`Connection closed`、`Failed to fetch`），用户既
 *    看不懂也不知道该做什么。统一换成「发生了什么 + 重发一次就好」，原始错误留在
 *    `cause` 里，异常上报照样拿得到根因。
 *
 * 纯函数：不碰会话状态，只读「这一轮有没有被取消 / 有没有被重置」两个标记。
 */

interface CancellableRun {
  prompt: { cancelled: boolean }
}

/** 这一轮是不是「用户自己停的」 */
function isRunCancelled(run: CancellableRun, signal: AbortSignal | undefined): boolean {
  return run.prompt.cancelled || signal?.aborted === true
}

const RESET_ERROR_HINT = '与 goose 的连接已断开（侧车退出或重启），本轮已中止；重新发送即可继续'

const RESET_ERROR_PATTERNS: readonly RegExp[] = [
  /active session disposed/i,
  /connection (?:closed|lost|reset)/i,
  /websocket/i,
  /socket hang ?up/i,
  /econnrefused|econnreset|epipe/i,
  /failed to fetch|network ?error|net::err/i,
  /acp .*(?:closed|disconnected)/i
]

/**
 * `reset` 是会话层打的标记（`clearThreadSessions` / 换连接时提前置位）：
 * 有了它就不必靠猜消息内容，中文/本地化过的错误也能正确归类。
 */
function humanizeRunError(error: unknown, reset: boolean): Error {
  const source = error instanceof Error ? error : new Error(String(error))
  const isReset = reset || RESET_ERROR_PATTERNS.some((pattern) => pattern.test(source.message))
  if (!isReset) return source
  return new Error(RESET_ERROR_HINT, { cause: source })
}

export { RESET_ERROR_HINT, humanizeRunError, isRunCancelled }
export type { CancellableRun }
