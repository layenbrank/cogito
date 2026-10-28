/**
 * 知识库窗 Caption 右侧（Decorations.final）：布局开关 + 面板 / 助手开关。
 * 对齐 VS Code 标题栏 Layout Control；应用菜单在 begin 最左侧。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@cogito/design/components/tooltip'
import { cn } from 'cn'

import { useDockStore } from '@/features/agent/dock'

import { useKnowledgeStore } from '@/stores/knowledge'
import { t } from '@/views/knowledge/locale.ts'
import { usePanelStore } from '@/views/knowledge/panel/store.ts'

interface LayoutButtonProps {
  label: string
  icon: string
  isPressed: boolean
  onClick: () => void
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
              'relative z-10 size-7 rounded-md border-0 shadow-none',
              props.isPressed
                ? 'bg-muted text-foreground hover:bg-muted hover:text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={props.onClick}
          />
        }>
        <Icon
          icon={props.icon}
          className="size-4"
        />
      </TooltipTrigger>
      <TooltipContent side="bottom">{props.label}</TooltipContent>
    </Tooltip>
  )
}

function KnowledgeCaptionFinal() {
  const isFocusMode = useKnowledgeStore(function (state) {
    return state.isFocusMode
  })
  const isSidebarOpen = useKnowledgeStore(function (state) {
    return state.isSidebarOpen
  })
  const isOutlineOpen = useKnowledgeStore(function (state) {
    return state.isOutlineOpen
  })
  const toToggleSidebar = useKnowledgeStore(function (state) {
    return state.toToggleSidebar
  })
  const toToggleOutline = useKnowledgeStore(function (state) {
    return state.toToggleOutline
  })
  const isPanelOpen = usePanelStore(function (state) {
    return state.isOpen
  })
  const toTogglePanel = usePanelStore(function (state) {
    return state.toToggle
  })

  if (isFocusMode) return null

  return (
    <div className="relative z-10 flex h-full items-center gap-0.5">
      <LayoutButton
        label={t('SIDEBAR')}
        icon="lucide:panel-left"
        isPressed={isSidebarOpen}
        onClick={toToggleSidebar}
      />
      <LayoutButton
        label={t('OUTLINE')}
        icon="lucide:panel-right"
        isPressed={isOutlineOpen}
        onClick={toToggleOutline}
      />
      <span
        aria-hidden
        className="mx-0.5 h-4 w-px shrink-0 bg-border"
      />
      <LayoutButton
        label="知识库"
        icon="lucide:library-big"
        isPressed={isPanelOpen}
        onClick={function () {
          toTogglePanel()
        }}
      />
      <LayoutButton
        label="AI 助手"
        icon="lucide:sparkles"
        isPressed={false}
        onClick={function () {
          useDockStore.getState().toToggle()
        }}
      />
    </div>
  )
}

export { KnowledgeCaptionFinal }
