/**
 * 代码窗标题栏的设置入口：只负责打开「设置」标签页。
 *
 * 设置本体是编辑器里的独立页（`views/code/workspace/settings-surface.tsx`），
 * 不再是标题栏浮层 —— 浮层面板窄、滚动受限，改完还得点空白处收起。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { cn } from 'cn'

import { useCodeStore } from '@/stores/code'

function SettingsButton() {
  const isActive = useCodeStore(function (state) {
    const active = state.tabs.find(function (tab) {
      return tab.id === state.activeTabId
    })
    return active?.kind === 'settings'
  })

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-region="false"
            aria-label="编辑器设置"
            aria-pressed={isActive}
            className={cn(
              'size-7 rounded-md border-0 shadow-none',
              isActive
                ? 'bg-muted text-foreground hover:bg-muted hover:text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={function () {
              useCodeStore.getState().toOpenSettingsTab()
            }}
          />
        }>
        <Icon
          icon="lucide:settings-2"
          className="size-4"
        />
      </TooltipTrigger>
      <TooltipContent side="bottom">编辑器设置</TooltipContent>
    </Tooltip>
  )
}

export { SettingsButton }
