import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@i-thinking/design/components/tooltip'
import { cn } from 'cn'

import { useMarkdownStore } from '@/stores/markdown'
import { SHORTCUTS } from '@/views/markdown/lib/shortcuts.ts'
import type { MarkdownViewMode } from '@/views/markdown/lib/types.ts'
import { t } from '@/views/markdown/locale.ts'
import styles from '@/views/markdown/workspace/overlay/utility.module.scss'

interface UtilityProps {
  fileQuery: string
  onFileQuery(value: string): void
  onOpen(): void
  onNew(): void
  onSave(): void
  onToggleFind(): void
  onExportHtml?(): void
}

function ModeButton(props: {
  mode: MarkdownViewMode
  current: MarkdownViewMode
  label: string
  onPick(mode: MarkdownViewMode): void
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

function Utility(props: UtilityProps) {
  const viewMode = useMarkdownStore(function (state) {
    return state.viewMode
  })
  const isFocusMode = useMarkdownStore(function (state) {
    return state.isFocusMode
  })
  const toToggleSidebar = useMarkdownStore(function (state) {
    return state.toToggleSidebar
  })
  const toToggleOutline = useMarkdownStore(function (state) {
    return state.toToggleOutline
  })
  const toSetViewMode = useMarkdownStore(function (state) {
    return state.toSetViewMode
  })
  const toSetPrefsOpen = useMarkdownStore(function (state) {
    return state.toSetPrefsOpen
  })
  const toPatchPreferences = useMarkdownStore(function (state) {
    return state.toPatchPreferences
  })

  return (
    <TooltipProvider delay={200}>
      <div
        data-region="true"
        className={cn(
          styles.utility,
          styles.root,
          'border-b border-border bg-background px-1'
        )}>
        <div className="flex min-w-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-md"
                  aria-label={t('SIDEBAR')}
                  onClick={toToggleSidebar}
                />
              }>
              <Icon
                icon="lucide:panel-left"
                className="size-4"
              />
            </TooltipTrigger>
            <TooltipContent>{t('SIDEBAR')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-md"
                  aria-label={t('OPEN')}
                  onClick={props.onOpen}
                />
              }>
              <Icon
                icon="lucide:folder-open"
                className="size-4"
              />
            </TooltipTrigger>
            <TooltipContent>{t('OPEN')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-md"
                  aria-label={t('NEW')}
                  onClick={props.onNew}
                />
              }>
              <Icon
                icon="lucide:file-plus-2"
                className="size-4"
              />
            </TooltipTrigger>
            <TooltipContent>{t('NEW')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-md"
                  aria-label={`${t('SAVE')} ${SHORTCUTS.SAVE.label}`}
                  onClick={props.onSave}
                />
              }>
              <Icon
                icon="lucide:save"
                className="size-4"
              />
            </TooltipTrigger>
            <TooltipContent>
              {t('SAVE')} · {SHORTCUTS.SAVE.label}
            </TooltipContent>
          </Tooltip>

          <div className="relative ml-1 hidden min-w-0 sm:block">
            <Icon
              icon="lucide:search"
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={props.fileQuery}
              placeholder={t('SEARCH')}
              className="h-7 w-56 rounded-md pl-7 text-xs"
              onChange={function (event) {
                props.onFileQuery(event.target.value)
              }}
            />
          </div>
        </div>

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
                  aria-label={`${t('FOCUS')} ${SHORTCUTS.FOCUS_TOGGLE.label}`}
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

          {props.onExportHtml ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-md"
                    aria-label={t('EXPORT_HTML')}
                    onClick={props.onExportHtml}
                  />
                }>
                <Icon
                  icon="lucide:file-down"
                  className="size-4"
                />
              </TooltipTrigger>
              <TooltipContent>{t('EXPORT_HTML')}</TooltipContent>
            </Tooltip>
          ) : null}

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-md"
                  aria-label={t('OUTLINE')}
                  onClick={toToggleOutline}
                />
              }>
              <Icon
                icon="lucide:list-tree"
                className="size-4"
              />
            </TooltipTrigger>
            <TooltipContent>{t('OUTLINE')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-md"
                  aria-label={t('PREFERENCES')}
                  onClick={function () {
                    toSetPrefsOpen(true)
                  }}
                />
              }>
              <Icon
                icon="lucide:settings-2"
                className="size-4"
              />
            </TooltipTrigger>
            <TooltipContent>{t('PREFERENCES')}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}

export default Utility
