import { openUrl } from '@tauri-apps/plugin-opener'
import { toast } from 'sonner'

import { findTileRoute } from '@/constants/magnetic-tile/window'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { admitSession } from '@/features/magnetic-tile/session'
import { ensureTilePrefs, findSessionPath } from '@/features/magnetic-tile/tile-prefs'
import { reportCaught } from '@/utils/exception-report'

type Tile = Pick<MagneticTile, 'component' | 'url' | 'id'>

type ActivateHandler = (tile: Tile) => void | Promise<void>

/**
 * 旧磁贴窗的 label：`<component>:<磁贴 id>`。
 * 新开的磁贴不再建窗，这个名字只留给还没关掉的旧窗口。
 */
function findTileWindowLabel(tile: Tile) {
  return `${tile.component}:${tile.id}`
}

/** 记录上的 url / 集合 id 经查询串传入（窗口拿不到磁贴记录） */
function findTileWindowUrl(tile: Tile) {
  const route = findTileRoute(tile.component)
  if (tile.component === 'collection') {
    return `${route}?id=${encodeURIComponent(tile.id)}`
  }
  if (!tile.url) return route
  return `${route}?url=${encodeURIComponent(tile.url)}`
}

/** 特殊组件：走专属激活；未登记的组件走 `activateRoute` */
const ACTIVATE: Partial<Record<MagneticTile.Component, ActivateHandler>> = {
  async navigation(tile) {
    const url = tile.url?.trim()
    if (!url) {
      toast.error('网址为空')
      return
    }
    await openUrl(url)
  }
}

/** 默认：主窗口开对应路由并记入会话；无 tile.url 时恢复上次路径 */
async function activateRoute(tile: Tile) {
  await ensureTilePrefs()
  let path = findTileWindowUrl(tile)
  // 集合每块磁贴对应不同文件夹，不能用组件级「上次路径」覆盖当前 id
  if (!tile.url && tile.component !== 'collection') {
    const remembered = findSessionPath(tile.component)
    if (remembered) path = remembered
  }
  admitSession({
    component: tile.component,
    id: tile.id,
    url: tile.url ?? '',
    path
  })
  const { router } = await import('@/routers')
  await router.navigate(path)
}

/**
 * 激活磁贴：
 * - `navigation` → 系统默认浏览器打开网址
 * - 其它组件（含 `collection`）→ 主窗口打开对应路由，并记入会话名单
 */
async function activateTile(tile: Tile): Promise<void> {
  const run = ACTIVATE[tile.component] ?? activateRoute
  try {
    await run(tile)
  } catch (error) {
    reportCaught('magnetic-tile.activate', error)
    toast.error(`${findComponentLabel(tile.component)}打开失败`)
  }
}

export { activateTile, findTileWindowLabel, findTileWindowUrl }
export type { Tile }
