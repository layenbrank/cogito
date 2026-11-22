import { findTileKind } from '@/features/magnetic-tile/registry.ts'

/** 右键「打开」是否出现：有链接、是集合，或扩展里有对应页面。 */
function canActivate(tile: MagneticTile): boolean {
  if (tile.url) return true
  // 集合走自己的集合页，和网址一样总能打开
  if (tile.component === 'collection') return true
  // 其余看种类表：`path: null` 才是「只有桌面端有能力」
  return findTileKind(tile.component).path !== null
}

export { canActivate }
