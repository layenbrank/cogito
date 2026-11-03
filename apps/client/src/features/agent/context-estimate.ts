/**
 * 上下文窗口分段估算（字符启发式，非精确 tokenizer）。
 * 供 composer Context breakdown：系统 / 历史 / 工具 / 附件。
 */
import type { ThreadMessage } from '@assistant-ui/react'
import type { ModelUsageBreakdown } from '@cogito/design/assistant/context'

/** ~4 字符 ≈ 1 token（中英混合粗估） */
function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(0, Math.ceil(text.length / 4))
}

function collectPartText(part: ThreadMessage['content'][number]): {
  history: string
  tool: string
  attachment: string
} {
  if (part.type === 'text') {
    return { history: part.text, tool: '', attachment: '' }
  }
  if (part.type === 'reasoning') {
    return { history: part.text ?? '', tool: '', attachment: '' }
  }
  if (part.type === 'tool-call') {
    const args = part.argsText ?? JSON.stringify(part.args ?? {})
    const result =
      part.result === undefined
        ? ''
        : typeof part.result === 'string'
          ? part.result
          : JSON.stringify(part.result)
    return { history: '', tool: `${part.toolName}\n${args}\n${result}`, attachment: '' }
  }
  if (part.type === 'image' || part.type === 'file' || part.type === 'audio') {
    const name = 'filename' in part && typeof part.filename === 'string' ? part.filename : part.type
    return { history: '', tool: '', attachment: name }
  }
  return { history: '', tool: '', attachment: '' }
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
      const collected = collectPartText(part)
      historyLen += collected.history.length
      toolLen += collected.tool.length
      attachmentLen += collected.attachment.length
    }
  }

  return {
    systemTokens: estimateTokens(input.systemText ?? ''),
    historyTokens: Math.ceil(historyLen / 4),
    toolTokens: Math.ceil(toolLen / 4),
    attachmentTokens: Math.ceil(attachmentLen / 4)
  }
}

export { estimateContextBreakdown, estimateTokens }
