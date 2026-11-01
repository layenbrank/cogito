/**
 * Browser 子 webview 让位标记 —— **唯一**配置，用法对齐 `data-region`。
 *
 * - `data-webview="false"`：实体浮层；与浏览器占位区相交时暂停原生 webview
 * - 不写 / 其它值：不触发让位
 *
 * 与穿透用的 `data-region` 无关，不要混用。
 */

const WEBVIEW_COVER_SOLID = 'false' as const

const WEBVIEW_COVER_SELECTOR = `[data-webview='${WEBVIEW_COVER_SOLID}']` as const

function webviewCoverProps(): { 'data-webview': typeof WEBVIEW_COVER_SOLID } {
  return { 'data-webview': WEBVIEW_COVER_SOLID }
}

export { WEBVIEW_COVER_SELECTOR, WEBVIEW_COVER_SOLID, webviewCoverProps }
