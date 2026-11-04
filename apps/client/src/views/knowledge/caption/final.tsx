/**
 * 知识库窗 Caption 右侧：左栏 / 大纲 / AI / 研究（打开右栏对应 tab）。
 * 左轨不再放「研究」，避免与标题栏双入口。
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
              'relative z-10 size-7 rounded-md border-0 shadow-none transition-colors',
              props.isPressed
                ? 'bg-primary/10 text-primary hover:bg-primary/12 hover:text-primary'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
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
  const toToggleResearch = useSurfaceStore(function (state) {
    return state.toToggleResearch
  })
  const isDockOpen = useDockStore(function (state) {
    return state.isOpen
  })
  const railTab = useSurfaceStore(function (state) {
    return state.tab
  })
  const showWikiChrome = railTab === 'wiki'
  const isResearchPressed = isAsideOpen && asideTab === 'research'

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
      {showWikiChrome ? (
        <>
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
        </>
      ) : null}
      <LayoutButton
        label="深度研究"
        icon="lucide:microscope"
        isPressed={isResearchPressed}
        onClick={toToggleResearch}
      />
    </div>
  )
}

export { KnowledgeCaptionFinal }
