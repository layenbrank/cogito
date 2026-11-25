/**
 * 从编辑器复制出去的纯文本。
 *
 * **一条块 = 一个换行**，空块直接丢：本应用的段落边界就是一个块，所以连续换行
 * 只可能是「空段落」或 ProseMirror 在 `white-space: pre-wrap` 下抄走的占位 `<br>`，
 * 两者都没有语义。以前只把 3 个以上换行压成 2 个，粘到微信 / Word / 钉钉里仍是一大段
 * 大空行；现在一律压成 1 个，保证「复制 — 粘贴」不产生需要手动删的空白。
 */
function normalizeCopiedText(text: string): string {
  return text
    .replace(/\u200b|\ufeff/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/^\n+|\n+$/g, '')
    .replace(/[ \t]+$/gm, '')
}

/** 纯文本 → 粘贴用的 HTML：用 `<br>` 而不是一段一个 `<p>`，避免目标编辑器再加段距。 */
function toCopiedHtml(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<div>${escaped.replace(/\n/g, '<br>')}</div>`
}

export { normalizeCopiedText, toCopiedHtml }
