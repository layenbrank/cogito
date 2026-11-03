/**
 * 代码窗 Caption 左侧（shell begin）：窗口标题 + 搜索胶囊。
 * 快速打开属于窗口级菜单能力，放标题栏；编辑器工作台留在内容区。
 */
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { useShowsTileSession } from '@/features/magnetic-tile/session-bar'
import { SearchPill } from '@/views/code/caption/search-pill.tsx'

function CodeCaptionBegin() {
  const showsSession = useShowsTileSession()

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
      {showsSession ? null : (
        <span className="shrink-0 truncate px-1 text-sm font-medium">
          {findComponentLabel('code')}
        </span>
      )}
      <SearchPill />
    </div>
  )
}

export { CodeCaptionBegin }
