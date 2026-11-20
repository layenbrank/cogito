/**
 * 一轮失败的归因：只在「消息文本」这一层做有限分类。
 *
 * 为什么单独一个文件：结构化日志（`AGENTD_EVENT`）、计数器、回给前端的状态事件要读
 * **同一个词**。三处各写一套正则，迟早会漂成三种说法，排查时又要重新对齐。
 *
 * 这里只回答「看起来是谁的问题」，不做因果推断：归不进去就是 `unknown` ——
 * 指错方向比说「不知道」更糟（会让人去改根本没坏的那一层）。
 */

const RUN_FAILURE_KINDS = [
  'cancelled',
  'connection',
  'permission',
  'provider',
  'tool',
  'unknown'
] as const

type RunFailureKind = (typeof RUN_FAILURE_KINDS)[number]

/** 用户自己停的：不算失败，不该进失败率 */
const CANCELLED_PATTERNS: readonly RegExp[] = [/abort/i, /cancelled by user/i, /用户.*取消/, /已停止/]

/** 连接 / 侧车层：goose 重启、ACP 断开、本机 HTTP 打不通 */
const CONNECTION_PATTERNS: readonly RegExp[] = [
  /active session disposed/i,
  /connection (?:closed|lost|reset)/i,
  /socket hang ?up/i,
  /econn(refused|reset)|epipe/i,
  /acp .*(?:closed|disconnected|超时)/i,
  /goose acp 已退出/i,
  /goose 未就绪/
]

/** 授权闸门：策略拒绝 / 人工拒绝 / 权限文件里没有这条 */
const PERMISSION_PATTERNS: readonly RegExp[] = [
  /permission/i,
  /never_allow/i,
  /not allowed/i,
  /denied/i,
  /拒绝/,
  /未授权/,
  /授权策略/
]

/**
 * 模型 / 网关：provider 解析、鉴权、配额、上下文超限、上游 5xx。
 *
 * 这是「工具明明没跑」和「模型根本没回话」最容易混在一起的一类，所以关键词要具体：
 * 只写 `error` 会把所有工具错误都吸过来。
 */
const PROVIDER_PATTERNS: readonly RegExp[] = [
  /provider/i,
  /model/i,
  /gateway/i,
  /api[ _-]?key/i,
  /rate.?limit/i,
  /quota/i,
  /overloaded/i,
  /context (?:window|length)/i,
  /max[ _-]?tokens/i,
  /\b(?:401|403|429|5\d\d)\b/
]

/** 工具层：工具自己炸了、参数不合法、超时 */
const TOOL_PATTERNS: readonly RegExp[] = [/tool/i, /工具/]

function matchesAny(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some(function (pattern) {
    return pattern.test(text)
  })
}

/**
 * 判定顺序就是「先排除最确定的」：
 * 取消 → 连接 → 授权 → 模型/网关 → 工具。
 *
 * 模型错误排在工具之前：很多 provider 报错文案里也带 tool（`tool calling failed`），
 * 而工具错误里几乎不会出现 provider / gateway / 429 这类具体词。
 */
function classifyRunFailure(message: string | undefined | null): RunFailureKind {
  const text = (message ?? '').trim()
  if (!text) return 'unknown'
  if (matchesAny(CANCELLED_PATTERNS, text)) return 'cancelled'
  if (matchesAny(CONNECTION_PATTERNS, text)) return 'connection'
  if (matchesAny(PERMISSION_PATTERNS, text)) return 'permission'
  if (matchesAny(PROVIDER_PATTERNS, text)) return 'provider'
  if (matchesAny(TOOL_PATTERNS, text)) return 'tool'
  return 'unknown'
}

/**
 * 日志里的错误摘录：压成一行、限长。
 *
 * 结构化日志是给 `Select-String` / `jq` 用的，多行 message 会把一条事件拆成好几行，
 * 之后按 `AGENTD_EVENT` grep 时只能捞到前半截。
 */
const ERROR_EXCERPT_MAX_CHARS = 500

function toErrorExcerpt(message: string | undefined | null): string | undefined {
  const text = (message ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  return text.length > ERROR_EXCERPT_MAX_CHARS
    ? text.slice(0, ERROR_EXCERPT_MAX_CHARS) + '…'
    : text
}

export { RUN_FAILURE_KINDS, classifyRunFailure, toErrorExcerpt }
export type { RunFailureKind }
