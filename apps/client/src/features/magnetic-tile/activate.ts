import { openUrl } from '@tauri-apps/plugin-opener'
import { toast } from 'sonner'

import { findTileRoute } from '@/constants/magnetic-tile/window'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { admitSession } from '@/features/magnetic-tile/session'
import { parseOriginRect, useCollectionStore } from '@/stores/collection'

type Tile = Pick<MagneticTile, 'component' | 'url' | 'id'>

type ActivateHandler = (tile: Tile) => void | Promise<void>

/**
 * 旧磁贴窗的 label：`<component>:<磁贴 id>`。
 * 新开的磁贴不再建窗，这个名字只留给还没关掉的旧窗口。
 */
function findTileWindowLabel(tile: Tile) {
  return `${tile.component}:${tile.id}`
}

/** 记录上的 url 经查询串传入（窗口拿不到磁贴记录） */
function findTileWindowUrl(tile: Tile) {
  const route = findTileRoute(tile.component)
  if (!tile.url) return route
  return `${route}?url=${encodeURIComponent(tile.url)}`
}

function findCollectionOriginRect(id: string) {
  const node = document.querySelector<HTMLElement>(`.magnetic-tile[data-id="${id}"]`)
  if (!node) return null
  return parseOriginRect(node.getBoundingClientRect())
}

/** 特殊组件：走专属激活；未登记的组件走 `activateRoute` */
const ACTIVATE: Partial<Record<MagneticTile.Component, ActivateHandler>> = {
  async collection(tile) {
    const rect = findCollectionOriginRect(tile.id)
    if (!rect) {
      toast.error('无法定位集合磁贴')
      return
    }
    useCollectionStore.getState().toOpen({ id: tile.id, rect })
  },

  async navigation(tile) {
    const url = tile.url?.trim()
    if (!url) {
      toast.error('网址为空')
      return
    }
    await openUrl(url)
  }
}

/** 默认：主窗口开对应路由并记入会话 */
async function activateRoute(tile: Tile) {
  const path = findTileWindowUrl(tile)
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
 * - `collection` → 主镜内 FLIP scale 展开（不开页）
 * - `navigation` → 系统默认浏览器打开网址
 * - 其它组件 → 主窗口里打开对应路由，并记入会话名单
 */
async function activateTile(tile: Tile): Promise<void> {
  const run = ACTIVATE[tile.component] ?? activateRoute
  try {
    await run(tile)
  } catch (error) {
    console.error('[magnetic-tile] 打开应用失败', error)
    toast.error(`${findComponentLabel(tile.component)}打开失败`)
  }
}

export { activateTile, findTileWindowLabel, findTileWindowUrl }
export type { Tile }
