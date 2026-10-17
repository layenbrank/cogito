import { emit } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'

import { findTileRoute, findTileWindowOptions } from '@/constants/magnetic-tile/window'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { openWindow } from '@/features/window/open'
import { parseOriginRect, useCollectionStore } from '@/stores/collection'

type Tile = Pick<MagneticTile, 'component' | 'url' | 'id'>

const NAVIGATION_LABEL = 'navigation'
const NAVIGATION_OPEN_URL = 'navigation://open-url'

/**
 * 窗口 label：`<component>:<磁贴 id>`。
 *
 * 一个组件可以有多个磁贴记录（各自 url / 标题），按记录建窗才能一窗对一记录。
 * 网址磁贴共用一个壳窗口，标签在壳里管理。
 */
function findTileWindowLabel(tile: Tile) {
  if (tile.component === 'navigation') return NAVIGATION_LABEL
  return `${tile.component}:${tile.id}`
}

/** 记录上的 url 经查询串传入（窗口拿不到磁贴记录） */
function findTileWindowUrl(tile: Tile) {
  const route = findTileRoute(tile.component)
  if (!tile.url) return route
  return `${route}?url=${encodeURIComponent(tile.url)}`
}

async function openNavigation(url: string) {
  const route = url ? `/navigation?url=${encodeURIComponent(url)}` : '/navigation'
  const existing = await WebviewWindow.getByLabel(NAVIGATION_LABEL)
  if (existing) {
    if (url) await emit(NAVIGATION_OPEN_URL, { url })
    await existing.setFocus()
    return existing
  }
  return openWindow(
    NAVIGATION_LABEL,
    route,
    findComponentLabel('navigation'),
    findTileWindowOptions('navigation')
  )
}

function findCollectionOriginRect(id: string) {
  const node = document.querySelector<HTMLElement>(`.magnetic-tile[data-id="${id}"]`)
  if (!node) return null
  return parseOriginRect(node.getBoundingClientRect())
}

/**
 * 激活磁贴：
 * - `collection` → 主镜内 FLIP scale 展开（不开独立窗）
 * - `navigation` → 共用网址窗口，并打开或聚焦对应标签
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
    if (tile.component === 'navigation') {
      await openNavigation(tile.url ?? '')
      return
    }
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
