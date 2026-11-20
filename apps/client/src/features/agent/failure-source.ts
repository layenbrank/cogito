/**
 * 工具失败来源：同一句「失败了」背后可能是四件完全不同的事。
 *
 * 为什么必须分开：模型/网关错误与工具自身错误的修法**正好相反** —— 前者去查
 * provider、配额、上下文长度，后者去查工具实现、参数、权限。混成一句「工具失败」，
 * 人只能靠猜，最后经常改错了那一层。
 *
 * 纯函数：只读错误正文做有限归类，认不出来就是 `unknown`；指错方向比说「不知道」更糟。
 */

type ToolFailureSource = 'permission' | 'connection' | 'model' | 'tool' | 'unknown'

/** 授权闸门：策略拒绝 / 人工拒绝（与 `approval.ts` 的 `isPolicyDeniedText` 同一批说法） */
const PERMISSION_PATTERNS: readonly RegExp[] = [
  /permission/i,
  /never_allow/i,
  /not allowed/i,
  /denied/i,
  /拒绝/,
  /未授权/,
  /授权策略/
]

/** 连接 / 侧车：goose 重启、ACP 断开、本机端口打不通 */
const CONNECTION_PATTERNS: readonly RegExp[] = [
  /active session disposed/i,
  /connection (?:closed|lost|reset)/i,
  /socket hang ?up/i,
  /econn(refused|reset)|epipe/i,
  /failed to fetch|network ?error|net::err/i,
  /acp .*(?:closed|disconnected|超时)/i,
  /goose (?:acp 已退出|未就绪)/
]

/** 模型 / 网关：provider、鉴权、配额、上下文超限、上游 5xx */
const MODEL_PATTERNS: readonly RegExp[] = [
  /provider/i,
  /model/i,
  /gateway/i,
  /api[ _-]?key/i,
  /rate.?limit/i,
  /quota/i,
  /overloaded/i,
  /context (?:window|length|token)/i,
  /max[ _-]?tokens/i,
  /\b(?:401|403|429|5\d\d)\b/
]

/** 文件系统错误码：是工具在读写时撞到的，不是授权闸门 */
const OS_ERROR_PATTERNS: readonly RegExp[] = [
  /\beacces\b/i,
  /\beperm\b/i,
  /\benoent\b/i,
  /\benotdir\b/i,
  /\beisdir\b/i
]

/** 工具层：工具自己报错、参数不合法 */
const TOOL_PATTERNS: readonly RegExp[] = [
  /tool/i,
  /工具/,
  /invalid (?:argument|params?)/i,
  /参数(?:不合法|错误)/
]

function matchesAny(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some(function (pattern) {
    return pattern.test(text)
  })
}

/**
 * 归类顺序：连接 → 文件系统错误 → 授权 → 模型/网关 → 工具。
 *
 * 连接排最前：「与 goose 的连接断了」时工具根本没跑，报错文案里却可能带 tool 字样。
 * 文件系统错误码排在授权前：`EACCES: permission denied` 是工具撞到文件权限，
 * 不是「被审批策略拦下」—— 归错会让人去翻权限文件。
 * 模型排在工具前：provider 报错也常说 tool calling failed，而工具报错里几乎不会出现
 * provider / gateway / 429 这类具体词。
 */
function classifyToolFailure(output: string): ToolFailureSource {
  const text = output.trim()
  if (!text) return 'unknown'
  if (matchesAny(CONNECTION_PATTERNS, text)) return 'connection'
  if (matchesAny(OS_ERROR_PATTERNS, text)) return 'tool'
  if (matchesAny(PERMISSION_PATTERNS, text)) return 'permission'
  if (matchesAny(MODEL_PATTERNS, text)) return 'model'
  if (matchesAny(TOOL_PATTERNS, text)) return 'tool'
  return 'unknown'
}

interface ToolFailureCopy {
  label: string
  hint: string
}

const FAILURE_COPY: Readonly<Record<ToolFailureSource, ToolFailureCopy>> = {
  permission: {
    label: '授权拒绝',
    hint: '这次调用被权限闸门拦下（策略或人工拒绝），工具没有真正执行。'
  },
  connection: {
    label: '连接中断',
    hint: '与 goose / 侧车的连接断了，工具可能没跑完；重发一次再看。'
  },
  model: {
    label: '模型 / 网关',
    hint: '更像是模型或网关返回的错误（provider、配额、上下文超限），不是工具本身。'
  },
  tool: {
    label: '工具执行',
    hint: '工具本身报错：看展开后的输出，必要时用同样参数重跑复现。'
  },
  unknown: {
    label: '未分类',
    hint: '消息里没有可归类的线索：展开这张卡把诊断信息贴出来，再去日志里查。'
  }
}

function describeToolFailure(source: ToolFailureSource): ToolFailureCopy {
  return FAILURE_COPY[source]
}

interface ToolFailureReportInput {
  toolName: string
  toolCallId: string
  output: string
  args?: unknown
}

/**
 * 「复制诊断」的载荷：工具名 + 调用 id + 归类 + 原始输出 + 参数 + 时间。
 *
 * 不用 `String(error)` 那种一行摘要：排查时要能原样贴回工具参数重跑，
 * 也要能把 `toolCallId` 拿去日志里 `Select-String` 对上这一条。
 */
function buildToolFailureReport(input: ToolFailureReportInput): string {
  return JSON.stringify(
    {
      at: new Date().toISOString(),
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      source: classifyToolFailure(input.output),
      output: input.output,
      args: input.args ?? null
    },
    null,
    2
  )
}

export { buildToolFailureReport, classifyToolFailure, describeToolFailure }
export type { ToolFailureCopy, ToolFailureReportInput, ToolFailureSource }
