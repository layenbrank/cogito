/**
 * 从消息 part / content 聚合成可复制 / 导出的 Markdown 正文。
 *
 * 只收 `type === 'text'` 且有内容的块，按出现顺序用空行拼接 ——
 * 与 assistant-ui `getThreadMessageText` 口径一致，但优先读 `parts`
 *（UI 渲染同源），避免只拿到截断预览或末段。
 */

interface TextLike {
  readonly type: string
  readonly text?: string
}

interface MessageMarkdownSource {
  readonly parts?: readonly TextLike[]
  readonly content?: readonly TextLike[]
}

function findMessageMarkdown(source: MessageMarkdownSource): string
function findMessageMarkdown(parts: readonly TextLike[]): string
function findMessageMarkdown(source: MessageMarkdownSource | readonly TextLike[]): string {
  const items = isPartArray(source) ? source : (source.parts ?? source.content ?? [])

  const chunks: string[] = []
  for (const part of items) {
    if (part.type !== 'text') continue
    const text = part.text?.trimEnd()
    if (!text) continue
    chunks.push(text)
  }
  return chunks.join('\n\n')
}

function isPartArray(
  source: MessageMarkdownSource | readonly TextLike[]
): source is readonly TextLike[] {
  return Array.isArray(source)
}

export { findMessageMarkdown }
export type { MessageMarkdownSource }
