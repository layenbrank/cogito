/**
 * Netscape Bookmark File（Chrome「导出书签」HTML）解析。
 */
import type { BookmarkNode } from '@/views/bookmark/import/types'

let nodeSeq = 0

function nextId(prefix: string) {
  nodeSeq += 1
  return `${prefix}-${nodeSeq}`
}

function decodeHtml(text: string) {
  return text
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
}

function parseAttributes(tag: string) {
  const attrs: Record<string, string> = {}
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(tag))) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return attrs
}

/** 从 open `<DL` 之后起，找到与之配对的 `</DL>`，返回内部正文 */
function extractDlInner(source: string, fromIndex: number): { inner: string; end: number } | null {
  const open = source.slice(fromIndex).match(/^<DL\b[^>]*>/i)
  if (!open) return null
  let depth = 1
  let i = fromIndex + open[0].length
  const openRe = /<DL\b[^>]*>/gi
  const closeRe = /<\/DL>/gi

  while (i < source.length && depth > 0) {
    openRe.lastIndex = i
    closeRe.lastIndex = i
    const nextOpen = openRe.exec(source)
    const nextClose = closeRe.exec(source)
    if (!nextClose) return null

    const openAt = nextOpen?.index ?? Number.POSITIVE_INFINITY
    const closeAt = nextClose.index

    if (openAt < closeAt) {
      depth += 1
      i = openAt + nextOpen![0].length
    } else {
      depth -= 1
      if (depth === 0) {
        return {
          inner: source.slice(fromIndex + open[0].length, closeAt),
          end: closeAt + nextClose[0].length
        }
      }
      i = closeAt + nextClose[0].length
    }
  }
  return null
}

/**
 * 解析 `<DL>` 块内的 `<DT>` 项（文件夹 / 链接）。
 * 用括号深度切分嵌套 DL，避免正则吞跨层内容。
 */
function parseDlBody(body: string): BookmarkNode[] {
  const nodes: BookmarkNode[] = []
  let cursor = 0

  while (cursor < body.length) {
    const dtMatch = body.slice(cursor).match(/<DT\b[^>]*>/i)
    if (!dtMatch || dtMatch.index === undefined) break
    cursor += dtMatch.index + dtMatch[0].length
    const rest = body.slice(cursor)

    const folderMatch = rest.match(/^\s*<H3\b([^>]*)>([\s\S]*?)<\/H3>/i)
    if (folderMatch) {
      const title = decodeHtml(folderMatch[2].replace(/<[^>]+>/g, '').trim()) || '未命名文件夹'
      cursor += folderMatch[0].length
      const afterH3 = body.slice(cursor)
      const dlStart = afterH3.search(/<DL\b/i)
      let children: BookmarkNode[] = []
      if (dlStart >= 0) {
        const extracted = extractDlInner(afterH3, dlStart)
        if (extracted) {
          children = parseDlBody(extracted.inner)
          cursor += extracted.end
        }
      }
      nodes.push({
        id: nextId('folder'),
        title,
        children
      })
      continue
    }

    const linkMatch = rest.match(/^\s*<A\b([^>]*)>([\s\S]*?)<\/A>/i)
    if (linkMatch) {
      const attrs = parseAttributes(linkMatch[1])
      const href = attrs.href?.trim()
      cursor += linkMatch[0].length
      if (!href || /^(javascript|data|vbscript):/i.test(href)) continue
      const title = decodeHtml(linkMatch[2].replace(/<[^>]+>/g, '').trim()) || href
      nodes.push({
        id: nextId('url'),
        title,
        url: href
      })
      continue
    }

    // 无法识别的 DT：跳过到下一个 DT 或结束，避免死循环
    const nextDt = body.slice(cursor).search(/<DT\b/i)
    if (nextDt < 0) break
    cursor += nextDt
  }

  return nodes
}

function parseBookmarkHtml(html: string): BookmarkNode[] {
  nodeSeq = 0
  const start = html.search(/<DL\b/i)
  if (start < 0) return []
  const extracted = extractDlInner(html, start)
  if (!extracted) return []
  return parseDlBody(extracted.inner)
}

export { parseBookmarkHtml }
