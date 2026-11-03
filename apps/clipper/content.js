/**
 * 轻量正文抽取：标题 + 可见文本 → 简易 markdown。
 */
function extractPageMarkdown() {
  const title = document.title.trim()
  const url = location.href
  const clone = document.body.cloneNode(true)
  clone.querySelectorAll('script, style, noscript, nav, footer, iframe').forEach(function (node) {
    node.remove()
  })
  const text = (clone.textContent || '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const markdown = `# ${title}\n\n${text.slice(0, 120_000)}`
  return { title, url, markdown }
}

chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  if (message?.type !== 'cogito-extract') return
  sendResponse(extractPageMarkdown())
})
