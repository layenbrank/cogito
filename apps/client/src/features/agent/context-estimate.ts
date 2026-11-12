/**
 * 上下文窗口分段估算（字符启发式，非精确 tokenizer）。
 * 供 composer Context breakdown：系统 / 历史 / 工具 / 附件。
 *
 * 为什么按 part 缓存**字符数**：这个估算挂在 composer footer 上，流式时随
 * `thread.messages` 一起被反复调用；而工具结果可能有几 MB，`JSON.stringify` 每帧重跑一次
 * 就是每秒几十 MB 的纯浪费。part 是不可变对象（assistant-ui 更新时整块替换），
 * 按身份缓存长度即可 —— 流式增长的只有正文 part，量的是 `.length`，不做序列化。
 */
import type { ThreadMessage } from '@assistant-ui/react'
import type { ModelUsageBreakdown } from '@cogito/design/assistant/context'

/** ~4 字符 ≈ 1 token（中英混合粗估） */
function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(0, Math.ceil(text.length / 4))
}

/** 一个 part 的三类字符数（history / tool / attachment），缓存值，勿改 */
interface PartCost {
  history: number
  tool: number
  attachment: number
}

const partCostCache = new WeakMap<object, PartCost>()

function textLength(value: unknown): number {
  return typeof value === 'string' ? value.length : 0
}

function measurePart(part: ThreadMessage['content'][number]): PartCost {
  const cached = partCostCache.get(part)
  if (cached) return cached

  let cost: PartCost = { history: 0, tool: 0, attachment: 0 }
  if (part.type === 'text') {
    cost = { history: part.text.length, tool: 0, attachment: 0 }
  } else if (part.type === 'reasoning') {
    cost = { history: textLength(part.text), tool: 0, attachment: 0 }
  } else if (part.type === 'tool-call') {
    // 与旧实现 `\`${toolName}\n${args}\n${result}\`` 的字符数等价，只是分开量、不拼字符串
    const args = part.argsText ?? JSON.stringify(part.args ?? {})
    const result =
      part.result === undefined
        ? ''
        : typeof part.result === 'string'
          ? part.result
          : JSON.stringify(part.result)
    cost = {
      history: 0,
      tool: part.toolName.length + 1 + args.length + 1 + result.length,
      attachment: 0
    }
  } else if (part.type === 'image' || part.type === 'file' || part.type === 'audio') {
    const name = 'filename' in part && typeof part.filename === 'string' ? part.filename : part.type
    cost = { history: 0, tool: 0, attachment: name.length }
  }

  partCostCache.set(part, cost)
  return cost
}

function estimateContextBreakdown(input: {
  systemText?: string | null
  messages: readonly ThreadMessage[]
}): ModelUsageBreakdown {
  let historyLen = 0
  let toolLen = 0
  let attachmentLen = 0

  for (const message of input.messages) {
    for (const part of message.content) {
      const cost = measurePart(part)
      historyLen += cost.history
      toolLen += cost.tool
      attachmentLen += cost.attachment
    }
  }

  return {
    systemTokens: estimateTokens(input.systemText ?? ''),
    historyTokens: Math.ceil(historyLen / 4),
    toolTokens: Math.ceil(toolLen / 4),
    attachmentTokens: Math.ceil(attachmentLen / 4)
  }
}

/**
 * 一条消息吃掉的估算 token（「最占上下文 Top 5」用）。
 */
interface ContextMessageCost {
  id: string
  role: string
  tokens: number
  /** 正文预览（没有正文时退化成角色名 / 工具名） */
  label: string
}

/** 只读结构：业务侧传进来的消息只需要 id / role / content 三样 */
interface CostMessage {
  id: string
  role: string
  content: readonly ThreadMessage['content'][number][]
}

const PREVIEW_CHARS = 24

function previewOf(message: CostMessage): string {
  for (const part of message.content) {
    if (part.type === 'text' && part.text.trim().length > 0) {
      return part.text.trim().replace(/\s+/g, ' ').slice(0, PREVIEW_CHARS)
    }
    if (part.type === 'tool-call') return part.toolName
  }
  return message.role === 'user' ? '（用户消息）' : '（助手消息）'
}

/**
 * 按估算 token 倒序取前 `limit` 条消息。
 *
 * 只读 part 缓存里的字符数（不序列化、不拼字符串）；空消息直接跳过，不占位。
 * 与 `estimateContextBreakdown` 同一套口径（4 字符 ≈ 1 token），所以 Top N 的合计
 * 不会超过分段色条里 history + tool + attachment 的总量。
 */
/**
 * 整条线程里「思考」占了多少估算 token（累计口径）。
 *
 * 仪表（`thinking-effort`）需要的是**思考本身**的量，不是上下文总量：
 * 所以只数 reasoning part，并且和 `estimateContextBreakdown` 用同一套字符启发式
 * （4 字符 ≈ 1 token），两个数字不会互相打脸。
 */
function countReasoningTokens(messages: readonly CostMessage[]): number {
  let chars = 0
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === 'reasoning') chars += textLength(part.text)
    }
  }
  return Math.ceil(chars / 4)
}

/**
 * 本轮（最后一条用户消息之后）的思考 token。
 *
 * 仪表要的是「这一轮花了多少」，不是「这个会话一共花了多少」：档位预算是**单轮**
 * 量级（4k / 8k / 16k / 32k），拿全线程累计去比，第二轮就必然把进度条顶满，
 * 条子从此一直停在 100% —— 那就不是仪表了。
 *
 * 一次 run 可能产出多条 assistant 消息（工具往返），所以口径是「最后一条 user 之后的
 * 全部 reasoning」，不是「最后一条 message」。
 */
function countTurnReasoningTokens(messages: readonly CostMessage[]): number {
  let chars = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'user') break
    for (const part of message.content) {
      if (part.type === 'reasoning') chars += textLength(part.text)
    }
  }
  return Math.ceil(chars / 4)
}
function rankMessagesByTokens(messages: readonly CostMessage[], limit = 5): ContextMessageCost[] {
  const costs: ContextMessageCost[] = []
  for (const message of messages) {
    let chars = 0
    for (const part of message.content) {
      const cost = measurePart(part)
      chars += cost.history + cost.tool + cost.attachment
    }
    if (chars <= 0) continue
    costs.push({
      id: message.id,
      role: message.role,
      tokens: Math.ceil(chars / 4),
      label: previewOf(message)
    })
  }
  costs.sort(function (a, b) {
    return b.tokens - a.tokens
  })
  return costs.slice(0, Math.max(0, limit))
}

export {
  countReasoningTokens,
  countTurnReasoningTokens,
  estimateContextBreakdown,
  estimateTokens,
  rankMessagesByTokens
}
export type { ContextMessageCost }
