const CLIP_ENDPOINT = 'http://127.0.0.1:19828/clip'

chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  if (message?.type !== 'clip-page') return false
  void fetch(CLIP_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(message.payload)
  })
    .then(async function (response) {
      const text = await response.text()
      sendResponse({
        ok: response.ok,
        status: response.status,
        body: text
      })
    })
    .catch(function (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    })
  return true
})
