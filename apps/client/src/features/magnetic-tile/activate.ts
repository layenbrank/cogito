import { toast } from 'sonner'

import { findTileRoute, findTileWindowOptions } from '@/constants/magnetic-tile/window'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { openWindow } from '@/features/window/open'
import { parseOriginRect, useCollectionStore } from '@/stores/collection'

type Tile = Pick<MagneticTile, 'component' | 'url' | 'id'>

/**
 * 窗口 label：`<component>:<磁贴 id>`。
 *
 * 一个组件可以有多个磁贴记录（各自 url / 标题），按记录建窗才能一窗对一记录。
 */
function findTileWindowLabel(tile: Tile) {
  return `${tile.component}:${tile.id}`
}

/** 记录上的 url 只能经 URL 传递（窗口是独立 webview，拿不到磁贴记录） */
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

/**
 * 激活磁贴：
 * - `collection` → 主镜内 FLIP scale 展开（不开独立窗）
 * - 其它组件 → 独立窗口（`views/<component>`）；同 label 只聚焦
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
    await openWindow(
      findTileWindowLabel(tile),
      findTileWindowUrl(tile),
      findComponentLabel(tile.component),
      findTileWindowOptions(tile.component)
    )
  } catch (error) {
    console.error('[magnetic-tile] 打开窗口失败', error)
    toast.error(`${findComponentLabel(tile.component)}窗口打开失败`)
  }
}

export { activateTile, findTileWindowLabel, findTileWindowUrl }
export type { Tile }
