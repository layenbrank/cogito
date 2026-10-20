import { emit } from '@tauri-apps/api/event'
import { toast } from 'sonner'

import { findTileRoute } from '@/constants/magnetic-tile/window'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { NAVIGATION_OPEN_URL } from '@/features/magnetic-tile/open-url'
import { admitSession } from '@/features/magnetic-tile/session'
import { parseOriginRect, useCollectionStore } from '@/stores/collection'

type Tile = Pick<MagneticTile, 'component' | 'url' | 'id'>

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

async function openNavigation(url: string) {
  await emit(NAVIGATION_OPEN_URL, { url })
}

function findCollectionOriginRect(id: string) {
  const node = document.querySelector<HTMLElement>(`.magnetic-tile[data-id="${id}"]`)
  if (!node) return null
  return parseOriginRect(node.getBoundingClientRect())
}

/**
 * 激活磁贴：
 * - `collection` → 主镜内 FLIP scale 展开（不开页）
 * - `navigation` → 主窗口打开或聚焦对应标签
 * - 其它组件 → 主窗口里打开对应路由，并记入会话名单
 */
async function activateTile(tile: Tile): Promise<void> {
  if (tile.component === 'collection') {
    const rect = findCollectionOriginRect(tile.id)
    if (!rect) {
      toast.error('无法定位集合磁贴')
      return
    }
    useCollectionStore.getState().toOpen({ id: tile.id, rect })
    return
  }

  try {
    if (tile.component === 'navigation') {
      await openNavigation(tile.url ?? '')
      return
    }
    const path = findTileWindowUrl(tile)
    admitSession({
      component: tile.component,
      id: tile.id,
      url: tile.url ?? '',
      path
    })
    const { router } = await import('@/routers')
    await router.navigate(path)
  } catch (error) {
    console.error('[magnetic-tile] 打开应用失败', error)
    toast.error(`${findComponentLabel(tile.component)}打开失败`)
  }
}

export { activateTile, findTileWindowLabel, findTileWindowUrl }
export type { Tile }
