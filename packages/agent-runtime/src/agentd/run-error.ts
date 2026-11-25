/**
 * 一轮对话「怎么失败的」翻译成人话。
 *
 * 住在协议层而不是某个宿主里：client 与浏览器扩展都要给出**同一套说法**，
 * 两端各写一版「哪种错误算连接断开」迟早会漂移，而漂移的表现是「同一个故障，
 * 桌面端说重发即可、扩展说 Failed to fetch」，用户与排查都被误导。
 *
 * 三件事在这里定：
 * 1. **取消不是失败**：用户按停止会把请求打回，ACP SDK 顺手 reject 掉排队中的
 *    `nextUpdate()`，泵和 prompt 两条路都会收到同一个 abort 错误。判成失败就会在
 *    用户主动停止时弹一个红色错误块。
 * 2. **连接被重置要说清下一步**：这些消息原本是 SDK / WebView 的内部话术
 *    （`Active session disposed`、`Connection closed`、`Failed to fetch`），用户既
 *    看不懂也不知道该做什么。统一换成「发生了什么 + 重发一次就好」，原始错误留在
 *    `cause` 里，异常上报照样拿得到根因。
 * 3. **失败的哪一层要说清**：agentd 在 `status` 事件里带了 `errorKind`（模型/网关、
 *    工具、授权、连接），这里把它拼到消息前面 —— 用户最常问的就是「是模型挂了
 *    还是工具坏了」，只给一条原始错误等于没回答。
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
 * agentd 在 `status` 事件（`phase: 'settled'`）里带的归因词表，与 agentd 的
 * `src/error-kind.ts` 是同一套。改一边就得改另一边，否则 UI 上的说法会跟日志里的
 * `run.failed` 对不上，排查时反而更乱。
 */
type RunFailureKind = 'cancelled' | 'connection' | 'permission' | 'provider' | 'tool' | 'unknown'

/** 失败归因的人话：先说「哪一层坏了」，再说下一步做什么 */
const RUN_FAILURE_KIND_COPY: Record<RunFailureKind, { label: string; hint: string }> = {
  cancelled: { label: '已取消', hint: '这一轮是主动停下的，不算失败。' },
  connection: { label: '连接中断', hint: '与 goose 的连接断了，工具可能没跑完；重新发送即可继续。' },
  permission: { label: '授权拒绝', hint: '被权限闸门拦下，工具没有真正执行。' },
  provider: {
    label: '模型 / 网关',
    hint: '模型或网关返回了错误（provider 未配置、配额、上下文超限等），不是工具的问题。'
  },
  tool: {
    label: '工具执行',
    hint: '工具自己报错了；展开那张失败的工具卡，必要时用同样参数重跑复现。'
  },
  unknown: { label: '未分类', hint: '日志里 `run.failed` 那一行有原始错误。' }
}

function isRunFailureKind(value: unknown): value is RunFailureKind {
  return typeof value === 'string' && Object.hasOwn(RUN_FAILURE_KIND_COPY, value)
}

/**
 * 把「失败的哪一层」拼到消息前面：`模型 / 网关：Upstream 429 rate limit exceeded`。
 * 归因缺失或认不出来就原样透传 —— 这里不猜，猜错比不说更误导。
 */
function annotateRunFailure(message: string, kind: unknown): string {
  const text = message.trim()
  if (!isRunFailureKind(kind) || kind === 'unknown') return text || '这一轮失败了'
  const copy = RUN_FAILURE_KIND_COPY[kind]
  return text ? `${copy.label}：${text}` : `${copy.label}：${copy.hint}`
}

/**
 * `reset` 是会话层打的标记（`clearThreadSessions` / 换连接时提前置位）：
 * 有了它就不必靠猜消息内容，中文/本地化过的错误也能正确归类。
 */
function humanizeRunError(error: unknown, reset: boolean): Error {
  const source = error instanceof Error ? error : new Error(String(error))
  const isReset = reset || RESET_ERROR_PATTERNS.some(function (pattern) {
    return pattern.test(source.message)
  })
  if (!isReset) return source
  return new Error(RESET_ERROR_HINT, { cause: source })
}

export { RESET_ERROR_HINT, annotateRunFailure, humanizeRunError, isRunCancelled }
export type { RunFailureKind }
