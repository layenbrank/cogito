/**
 * 代码窗 Caption 右侧（Decorations.final）：窗口级布局开关 + 菜单动作。
 * 对齐 VS Code 标题栏 Layout Control —— 侧栏/底栏展开收缩放这里，不进内容区。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@cogito/design/components/tooltip'
import { cn } from 'cn'

import { useCodeStore } from '@/stores/code'

interface LayoutButtonProps {
  label: string
  shortcut?: string
  icon: string
  isPressed: boolean
  onClick(): void
}

function LayoutButton(props: LayoutButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-region="false"
            aria-label={props.label}
            aria-pressed={props.isPressed}
            className={cn(
              'size-7 rounded-md border-0 shadow-none',
              props.isPressed
                ? 'bg-muted text-foreground hover:bg-muted hover:text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={function () {
              props.onClick()
            }}
          />
        }>
        <Icon
          icon={props.icon}
          className="size-4"
        />
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span>{props.label}</span>
        {props.shortcut ? (
          <span className="text-background/70 ml-2">{props.shortcut}</span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

function CodeCaptionFinal() {
  const isSidebarOpen = useCodeStore(function (state) {
    return state.isSidebarOpen
  })
  const isPanelOpen = useCodeStore(function (state) {
    return state.isPanelOpen
  })

  return (
    <div className="flex h-full items-center gap-1">
      {/* 布局控制组：对齐 VS Code title bar layout controls */}
      <div className="flex items-center gap-0.5">
        <LayoutButton
          label="切换主侧栏"
          shortcut="Ctrl+B"
          icon="lucide:panel-left"
          isPressed={isSidebarOpen}
          onClick={function () {
            useCodeStore.getState().toToggleSidebar()
          }}
        />
        <LayoutButton
          label="切换底栏面板"
          shortcut="Ctrl+`"
          icon="lucide:panel-bottom"
          isPressed={isPanelOpen}
          onClick={function () {
            useCodeStore.getState().toTogglePanel('terminal')
          }}
        />
      </div>

      <span
        aria-hidden
        className="bg-border mx-0.5 h-4 w-px shrink-0"
      />

      {/* 菜单动作 */}
      <LayoutButton
        label="命令面板"
        shortcut="Ctrl+Shift+P"
        icon="lucide:command"
        isPressed={false}
        onClick={function () {
          useCodeStore.getState().toSetPaletteMode('command')
        }}
      />
    </div>
  )
}

export { CodeCaptionFinal }
