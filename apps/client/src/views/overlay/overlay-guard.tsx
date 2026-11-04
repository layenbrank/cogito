import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'
import { ErrorBoundary } from '@/components/fallback/ErrorBoundary.tsx'
import Overlay from '@/views/overlay/overlay'

/**
 * overlay 窗口的**最外层**兜底。
 *
 * `overlay.tsx` 自己的 hooks（store selector、`useOverlayHostGuards`）在它内部，
 * 原来那个 `OverlayBoundary` 也在内部 —— 于是 shell 自己抛错时无人接住，
 * 全屏透明置顶窗变成僵尸：用户点哪都没反应。
 *
 * 这一层挂在路由上（`/overlay`），一旦接住错误就 **park（真隐藏）**：
 * 窗口都不显示了，也就不可能再吃点击。`OverlayBoundary` 仍然留着，
 * 负责「局部崩了还能自己恢复」的正常路径。
 */
function OverlayGuard() {
  const park = useCallback(function () {
    void invoke(CHANNELS.OVERLAY.PARK).catch(function (error) {
      console.error('[overlay.guard] park 失败', error)
    })
  }, [])

  return (
    <ErrorBoundary
      compact
      boundaryId="overlay.guard"
      title="浮层出错，已收起"
      onError={park}>
      <Overlay />
    </ErrorBoundary>
  )
}

export { OverlayGuard }
export default OverlayGuard
