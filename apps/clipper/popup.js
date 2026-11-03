function toMarkdown(title, url, text) {
  const body = (text || '').trim().slice(0, 80_000)
  return `---\ntitle: "${title.replace(/"/g, '\\"')}"\nsource_url: "${url}"\nclipped_at: "${new Date().toISOString()}"\n---\n\n# ${title}\n\n> ${url}\n\n${body}\n`
}

async function clipActiveTab() {
  const status = document.getElementById('status')
  status.textContent = '提取中…'
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) {
    status.textContent = '没有活动标签页'
    return
  }
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: function () {
      const title = document.title || 'untitled'
      const url = location.href
      const text = document.body?.innerText || ''
      return { title, url, text }
    }
  })
  const markdown = toMarkdown(result.title, result.url, result.text)
  chrome.runtime.sendMessage(
    {
      type: 'clip-page',
      payload: {
        title: result.title,
        url: result.url,
        markdown
      }
    },
    function (response) {
      if (chrome.runtime.lastError) {
        status.textContent = chrome.runtime.lastError.message
        return
      }
      status.textContent = response?.ok
        ? `已发送 (${response.status})`
        : `失败：${response?.error || response?.body || 'unknown'}`
    }
  )
}

document.getElementById('clip')?.addEventListener('click', function () {
  void clipActiveTab()
})
