/**
 * 代码窗 Caption 左侧（shell begin）：窗口标题。
 * 搜索胶囊走中列（shell center），标题只在左列，二者互不挤位。
 */
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { useShowsTileSession } from '@/features/magnetic-tile/session-bar'

function CodeCaptionBegin() {
  const showsSession = useShowsTileSession()

  if (showsSession) return null

  return (
    <span className="min-w-0 truncate px-1 text-sm font-medium">{findComponentLabel('code')}</span>
  )
}

export { CodeCaptionBegin }
