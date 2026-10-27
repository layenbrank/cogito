import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@cogito/design/components/tooltip'
import { cn } from 'cn'

import { formatBindingText } from '@/keyboard/binding'
import { SHORTCUT_COMMAND, resolveBinding } from '@/keyboard/definitions'
import { useKnowledgeStore } from '@/stores/knowledge'
import type { KnowledgeViewMode } from '@/views/knowledge/lib/types.ts'
import { t } from '@/views/knowledge/locale.ts'
import styles from '@/views/knowledge/workspace/overlay/utility.module.scss'

interface UtilityProps {
  onToggleFind: () => void
}

function ModeButton(props: {
  mode: KnowledgeViewMode
  current: KnowledgeViewMode
  label: string
  onPick: (mode: KnowledgeViewMode) => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={props.current === props.mode ? 'secondary' : 'ghost'}
      className="h-7 rounded-md px-2 text-xs"
      onClick={function () {
        props.onPick(props.mode)
      }}>
      {props.label}
    </Button>
  )
}

/** 内容区编辑工具条：模式 / 专注 / 文档内查找。文件操作在 Caption 菜单，搜文件在侧栏。 */
function Utility(props: UtilityProps) {
  const viewMode = useKnowledgeStore(function (state) {
    return state.viewMode
  })
  const isFocusMode = useKnowledgeStore(function (state) {
    return state.isFocusMode
  })
  const toSetViewMode = useKnowledgeStore(function (state) {
    return state.toSetViewMode
  })
  const toPatchPreferences = useKnowledgeStore(function (state) {
    return state.toPatchPreferences
  })

  return (
    <TooltipProvider delay={200}>
      <div
        className={cn(
          styles.utility,
          styles.root,
          'justify-end border-b border-border/50 bg-background/75 px-1 backdrop-blur-md'
        )}>
        <div className="flex items-center gap-0.5">
          <ModeButton
            mode="live"
            current={viewMode}
            label={t('MODE_LIVE')}
            onPick={toSetViewMode}
          />
          <ModeButton
            mode="source"
            current={viewMode}
            label={t('MODE_SOURCE')}
            onPick={toSetViewMode}
          />
          <ModeButton
            mode="split"
            current={viewMode}
            label={t('MODE_SPLIT')}
            onPick={toSetViewMode}
          />

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant={isFocusMode ? 'secondary' : 'ghost'}
                  size="icon"
                  className="size-8 rounded-md"
                  aria-label={`${t('FOCUS')} ${formatBindingText(
                    resolveBinding(SHORTCUT_COMMAND.KNOWLEDGE_FOCUS_TOGGLE)
                  )}`}
                  onClick={function () {
                    toPatchPreferences({ isFocusMode: !isFocusMode })
                  }}
                />
              }>
              <Icon
                icon="lucide:focus"
                className="size-4"
              />
            </TooltipTrigger>
            <TooltipContent>
              {t('FOCUS')} · {t('FOCUS_HINT')}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-md"
                  aria-label={t('FIND')}
                  onClick={props.onToggleFind}
                />
              }>
              <Icon
                icon="lucide:text-search"
                className="size-4"
              />
            </TooltipTrigger>
            <TooltipContent>{t('FIND')}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}

export default Utility
