import { MARKDOWN_LIMIT } from './constants.ts'

/**
 * 与旧弹窗 `toMarkdown` 相同的正文：YAML 头 + 标题 + 引用 + 纯文本。
 * client 落盘时还会再包一层 source frontmatter。
 */
function composeMarkdown(title: string, url: string, text: string, clippedAt: string): string {
  const body = (text || '').trim().slice(0, MARKDOWN_LIMIT)
  const safeTitle = title.replace(/"/g, '\\"')
  return `---\ntitle: "${safeTitle}"\nsource_url: "${url}"\nclipped_at: "${clippedAt}"\n---\n\n# ${title}\n\n> ${url}\n\n${body}\n`
}

export { composeMarkdown }
