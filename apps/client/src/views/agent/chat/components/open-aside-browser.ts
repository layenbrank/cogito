/**
 * 从工具卡等线程外区域打开右栏「浏览器」并可选激活目标 tab。
 * 由 `AgentAside` 订阅；避免把 aside 状态塞进 tool-card props。
 */

const AGENT_OPEN_ASIDE_BROWSER = 'agent:open-aside-browser'

interface AsideBrowserDetail {
  /** webview label（`browser-<uuid>`）；缺省只翻到浏览器页签 */
  label?: string | null
}

function openAsideBrowser(label?: string | null) {
  window.dispatchEvent(
    new CustomEvent<AsideBrowserDetail>(AGENT_OPEN_ASIDE_BROWSER, {
      detail: { label: label ?? null }
    })
  )
}

function subscribeAsideBrowser(handler: (detail: AsideBrowserDetail) => void): () => void {
  function onEvent(event: Event) {
    const custom = event as CustomEvent<AsideBrowserDetail>
    handler(custom.detail ?? {})
  }
  window.addEventListener(AGENT_OPEN_ASIDE_BROWSER, onEvent)
  return function () {
    window.removeEventListener(AGENT_OPEN_ASIDE_BROWSER, onEvent)
  }
}

export { AGENT_OPEN_ASIDE_BROWSER, openAsideBrowser, subscribeAsideBrowser }
export type { AsideBrowserDetail }
