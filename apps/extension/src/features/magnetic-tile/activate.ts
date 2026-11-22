import { notify } from '@/features/shell/notice-state.ts'
import { openSite } from '@/features/shell/open-site.ts'

type Tile = Pick<MagneticTile, 'component' | 'url' | 'id' | 'title'>

const PAGE: Partial<Record<MagneticTile.Component, string>> = {
  agent: '/agent/chat',
  bookmark: '/bookmarks',
  settings: '/settings',
  marketplace: '/marketplace',
  calendar: '/calendar',
  clock: '/clock',
  countdown: '/countdown',
  wallpaper: '/wallpaper',
  gallery: '/gallery'
}

/** 双击磁贴：网址交给浏览器，已有页面走 hash 路由。 */
async function activateTile(tile: Tile): Promise<void> {
  if (tile.component === 'navigation') {
    const url = tile.url?.trim()
    if (!url) {
      notify('这个磁贴还没有设置链接')
      return
    }
    openSite(url, 'tab')
    return
  }

  if (tile.component === 'collection') {
    window.location.hash = `#/collection/${tile.id}`
    return
  }

  if (tile.component === 'wallpaper') {
    const params = new URLSearchParams()
    const url = tile.url?.trim()
    const title = tile.title?.trim()
    if (url) params.set('url', url)
    if (title) params.set('title', title)
    const query = params.toString()
    window.location.hash = query ? `#/wallpaper?${query}` : '#/wallpaper'
    return
  }

  const path = PAGE[tile.component]
  if (!path) return
  window.location.hash = `#${path}`
}

export { activateTile }
export type { Tile }
