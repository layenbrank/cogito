/**
 * 标题栏搜索胶囊：与主页 Omnibar 同构（h-8 / 全圆角 / popover 底 / 左侧图标 / 快捷键徽标）。
 * 挂 Caption 中列（shell center），宽度吃满中列上限，位置恒在窗口中线。
 * 只做入口，不另造输入态 —— 输入统一在 Ctrl+P 面板里，避免两套 query 源漂移。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'

import { useCodeStore } from '@/stores/code'
import { findBindingText } from '@/views/code/lib/bindings.ts'

function findFolderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function SearchPill() {
  const roots = useCodeStore(function (state) {
    return state.roots
  })

  const label =
    roots.length > 1
      ? `搜索 ${roots.length} 个工作区…`
      : roots[0]
        ? `搜索 ${findFolderName(roots[0])}…`
        : '搜索文件…'

  return (
    <button
      type="button"
      data-region="false"
      aria-label="搜索文件"
      title={`${label}（${findBindingText('CODE_PALETTE_FILES')}）`}
      className={cn(
        'border-border bg-popover/95 text-muted-foreground shadow-sm backdrop-blur-md',
        'hover:border-border hover:text-foreground focus-visible:ring-ring/50 flex h-8 w-full max-w-sm min-w-0 items-center gap-2 rounded-full border px-2.5',
        'focus-visible:ring-3 focus-visible:outline-none'
      )}
      onClick={function () {
        useCodeStore.getState().toSetPaletteMode('file')
      }}>
      <Icon
        icon="lucide:files"
        aria-hidden
        className="size-3.5 shrink-0"
      />
      <span className="min-w-0 flex-1 truncate text-left text-xs">{label}</span>
      <kbd className="bg-muted/70 text-muted-foreground shrink-0 rounded-full px-1.5 py-0.5 font-sans text-[10px] leading-none">
        {findBindingText('CODE_PALETTE_FILES')}
      </kbd>
      <Icon
        icon="lucide:search"
        aria-hidden
        className="size-3.5 shrink-0 opacity-70"
      />
    </button>
  )
}

export { SearchPill }
