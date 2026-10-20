interface DownloadItem {
  id: string
  url: string
  name: string
  status: 'started' | 'done' | 'failed'
  path?: string
}

type BrowserPanel = 'sites' | 'downloads' | 'extensions'
/** 内容槽：网页，或壳层自己的空白页（新标签）。 */
type BrowserSurface = 'blank' | 'page'

/** 浏览窗口内的提示。它只出现在侧栏里：DOM 盖不住原生网页，浮动 toast 在这里必然被盖。 */
interface BrowserNotice {
  tone: 'ok' | 'fail'
  text: string
}

export type { BrowserNotice, BrowserPanel, BrowserSurface, DownloadItem }
