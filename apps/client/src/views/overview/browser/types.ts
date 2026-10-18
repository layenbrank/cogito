interface DownloadItem {
  id: string
  url: string
  name: string
  status: 'started' | 'done' | 'failed'
  path?: string
}

type BrowserPanel = 'sites' | 'downloads' | 'extensions'
type BrowserSurface = 'tiles' | 'page'

export type { BrowserPanel, BrowserSurface, DownloadItem }
