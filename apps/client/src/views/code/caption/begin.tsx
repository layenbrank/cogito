/**
 * 代码窗 Caption 左侧（Decorations.begin）：窗口标题 + 命令中心入口。
 * 快速打开属于窗口级菜单能力，放标题栏；编辑器工作台留在内容区。
 */
import { cn } from 'cn'

import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { useShowsTileSession } from '@/features/magnetic-tile/session-bar'
import { useCodeStore } from '@/stores/code'
import { findBindingText } from '@/views/code/lib/bindings.ts'

function CodeCaptionBegin() {
  const showsSession = useShowsTileSession()

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
      {showsSession ? null : (
        <span className="shrink-0 truncate px-1 text-sm font-medium">
          {findComponentLabel('code')}
        </span>
      )}
      <button
        type="button"
        data-region="false"
        className={cn(
          'border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
          'mx-auto h-6 w-full max-w-sm min-w-0 truncate rounded-md border px-3 text-center text-xs'
        )}
        onClick={function () {
          useCodeStore.getState().toSetPaletteMode('file')
        }}>
        搜索文件…（{findBindingText('CODE_PALETTE_FILES')}）
      </button>
    </div>
  )
}

export { CodeCaptionBegin }
