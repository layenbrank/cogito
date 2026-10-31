/**
 * 主窗应用页已有 TileSessionBar（回墙）；独立设置磁贴窗关窗即可。
 * 仅「非主窗应用内同窗切入设置」时在侧栏提供返回（history.back）。
 */
function findShowsShellBack(showsSession: boolean, windowLabel: string) {
  if (showsSession) return false
  if (windowLabel.startsWith('settings:')) return false
  return true
}

export { findShowsShellBack }
