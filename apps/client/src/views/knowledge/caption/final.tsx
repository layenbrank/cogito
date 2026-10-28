/**
 * Markdown 窗 Caption 右侧（Decorations.final）：布局开关 + 偏好。
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
import { useState } from 'react'

import { useDockStore } from '@/features/agent/dock'

import { useKnowledgeStore } from '@/stores/knowledge'
import { t } from '@/views/knowledge/locale.ts'
import { KnowledgeHub } from '@/views/knowledge/hub/knowledge-hub.tsx'

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
  const toSetPrefsOpen = useKnowledgeStore(function (state) {
    return state.toSetPrefsOpen
  })
  // 知识库面板是「库级」操作（列表/检索/待发布草稿），与编辑器偏好分开入口
  const [isHubOpen, setIsHubOpen] = useState(false)

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
        isPressed={isHubOpen}
        onClick={function () {
          setIsHubOpen(true)
        }}
      />
      <LayoutButton
        label={t('PREFERENCES')}
        icon="lucide:settings-2"
        isPressed={false}
        onClick={function () {
          toSetPrefsOpen(true)
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
      <KnowledgeHub
        open={isHubOpen}
        onOpenChange={setIsHubOpen}
      />
    </div>
  )
}

export { KnowledgeCaptionFinal }
