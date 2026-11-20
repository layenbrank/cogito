interface PageSnapshot {
  title: string
  url: string
  text: string
}

interface ArticleExtract {
  title: string
  url: string
  markdown: string
}

/**
 * 注入到标签页的函数。必须自包含：`executeScript` 只序列化函数自身。
 * 行为对齐旧弹窗：标题、地址、`body.innerText`。
 */
function readPageSnapshot(): PageSnapshot {
  const title = document.title || 'untitled'
  const url = location.href
  const body = document.body
  const text = body ? body.innerText : ''
  return { title: title, url: url, text: text }
}

/**
 * 去掉导航和脚本后再收正文。
 * 只抽取、不投递（`MESSAGE_EXTRACT`），弹窗流程用的是 `readPageSnapshot`。
 */
function readArticleExtract(): ArticleExtract {
  const title = (document.title || '').trim()
  const url = location.href
  const source = document.body
  if (!source) {
    return { title: title, url: url, markdown: '# ' + title + '\n\n' }
  }
  const clone = source.cloneNode(true) as HTMLElement
  const nodes = clone.querySelectorAll('script, style, noscript, nav, footer, iframe')
  nodes.forEach(function (node) {
    node.remove()
  })
  const raw = clone.textContent || ''
  const text = raw.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const markdown = '# ' + title + '\n\n' + text.slice(0, 120000)
  return { title: title, url: url, markdown: markdown }
}

function isSnapshot(value: unknown): value is PageSnapshot {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.title === 'string' && typeof record.url === 'string' && typeof record.text === 'string'
}

function isArticle(value: unknown): value is ArticleExtract {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.title === 'string' && typeof record.url === 'string' && typeof record.markdown === 'string'
}

export { isArticle, isSnapshot, readArticleExtract, readPageSnapshot }
export type { ArticleExtract, PageSnapshot }
