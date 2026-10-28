/**
 * 知识库窗 Caption 右侧（Decorations.final）：左栏 / 大纲 / AI。
 * 右栏大纲与 AI 共用一列（tabs），不再各占一列。
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
import { useSurfaceStore } from '@/views/knowledge/surface/store.ts'

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
  const isAsideOpen = useKnowledgeStore(function (state) {
    return state.isOutlineOpen
  })
  const toToggleSidebar = useKnowledgeStore(function (state) {
    return state.toToggleSidebar
  })
  const asideTab = useSurfaceStore(function (state) {
    return state.asideTab
  })
  const toToggleAside = useSurfaceStore(function (state) {
    return state.toToggleAside
  })
  const isDockOpen = useDockStore(function (state) {
    return state.isOpen
  })

  if (isFocusMode) return null

  const isOutlinePressed = isAsideOpen && asideTab === 'outline'
  const isAssistantPressed = isAsideOpen && asideTab === 'assistant' && isDockOpen

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
        icon="lucide:list-tree"
        isPressed={isOutlinePressed}
        onClick={function () {
          toToggleAside('outline')
        }}
      />
      <LayoutButton
        label="AI 助手（Ctrl+J）"
        icon="lucide:sparkles"
        isPressed={isAssistantPressed}
        onClick={function () {
          toToggleAside('assistant')
        }}
      />
    </div>
  )
}

export { KnowledgeCaptionFinal }
