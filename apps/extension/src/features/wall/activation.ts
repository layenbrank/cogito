/**
 * 这个磁贴双击能不能打开。
 *
 * 单独一个文件：它是纯谓词，跟 `tile-shell.tsx` 里的渲染组件放一起会触发
 * `react-refresh/only-export-components`（组件文件只该导出组件）。
 */
function canActivate(tile: MagneticTile): boolean {
  if (tile.component === 'clock') return false
  if (tile.url) return true
  return tile.component === 'bookmark' || tile.component === 'settings' || tile.component === 'collection'
}

export { canActivate }
