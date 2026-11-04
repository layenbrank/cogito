/**
 * Markdown 窗 Caption 左侧（shell begin）：
 * 应用菜单靠左；工具名或文件名居中；有 previewReturn 时显示「返回」。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { cn } from 'cn'

import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { useShowsTileSession } from '@/features/magnetic-tile/session-bar'
import { runCommand } from '@/keyboard/commands'
import { SHORTCUT_COMMAND } from '@/keyboard/definitions'
import { useKnowledgeStore } from '@/stores/knowledge'
import { t } from '@/views/knowledge/locale.ts'
import { useSurfaceStore, type PreviewReturnTab } from '@/views/knowledge/surface/store.ts'

const RETURN_LABEL: Record<NonNullable<PreviewReturnTab>, string> = {
  sources: '来源',
  search: '检索',
  graph: '图谱',
  lint: 'Lint',
  review: '审阅'
}

function KnowledgeCaptionBegin() {
  const isDirty = useKnowledgeStore(function (state) {
    return state.isDirty
  })
  const activePath = useKnowledgeStore(function (state) {
    return state.activePath
  })
  const hasOpened = useKnowledgeStore(function (state) {
    return state.hasOpened
  })
  const railTab = useSurfaceStore(function (state) {
    return state.tab
  })
  const previewReturnTab = useSurfaceStore(function (state) {
    return state.previewReturnTab
  })
  const toReturnFromPreview = useSurfaceStore(function (state) {
    return state.toReturnFromPreview
  })
  const toolTitles: Partial<Record<typeof railTab, string>> = {
    settings: 'Wiki 设置',
    sources: '来源',
    search: '检索',
    graph: '图谱',
    lint: 'Lint',
    review: '审阅'
  }
  const toolTitle = toolTitles[railTab]

  const showsSession = useShowsTileSession()
  const fileTitle = !hasOpened
    ? findComponentLabel('knowledge')
    : (activePath?.split(/[/\\]/).pop() ?? t('UNTITLED'))
  const title = toolTitle ?? fileTitle
  const showsTitle = Boolean(toolTitle) || hasOpened || !showsSession
  const returnLabel =
    railTab === 'wiki' && previewReturnTab ? RETURN_LABEL[previewReturnTab] : null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-region="false"
              aria-label={t('OPEN')}
              className="relative z-10 size-7 shrink-0 rounded-md border-0 text-muted-foreground shadow-none"
            />
          }>
          <Icon
            icon="lucide:menu"
            className="size-4"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-44">
          <DropdownMenuItem
            onClick={function () {
              void runCommand(SHORTCUT_COMMAND.KNOWLEDGE_OPEN_FILE)
            }}>
            <Icon
              icon="lucide:file-text"
              className="size-4"
            />
            {t('OPEN_FILE')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={function () {
              void runCommand(SHORTCUT_COMMAND.KNOWLEDGE_OPEN_FOLDER)
            }}>
            <Icon
              icon="lucide:folder"
              className="size-4"
            />
            {t('OPEN_FOLDER')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={function () {
              void runCommand(SHORTCUT_COMMAND.KNOWLEDGE_NEW)
            }}>
            <Icon
              icon="lucide:file-plus-2"
              className="size-4"
            />
            {t('NEW')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={function () {
              void runCommand(SHORTCUT_COMMAND.KNOWLEDGE_SAVE)
            }}>
            <Icon
              icon="lucide:save"
              className="size-4"
            />
            {t('SAVE')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={function () {
              void runCommand(SHORTCUT_COMMAND.KNOWLEDGE_EXPORT_HTML)
            }}>
            <Icon
              icon="lucide:file-down"
              className="size-4"
            />
            {t('EXPORT_HTML')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={function () {
              void runCommand(SHORTCUT_COMMAND.KNOWLEDGE_COPY_MARKDOWN)
            }}>
            <Icon
              icon="lucide:clipboard-copy"
              className="size-4"
            />
            {t('COPY_MD')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={function () {
              void runCommand(SHORTCUT_COMMAND.KNOWLEDGE_COPY_HTML)
            }}>
            <Icon
              icon="lucide:code-xml"
              className="size-4"
            />
            {t('COPY_HTML')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {returnLabel ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-region="false"
          className="relative z-10 h-7 shrink-0 gap-1 px-1.5 text-[11px] text-muted-foreground"
          onClick={toReturnFromPreview}>
          <Icon
            icon="lucide:arrow-left"
            className="size-3.5"
          />
          返回{returnLabel}
        </Button>
      ) : null}

      {showsTitle ? (
        <span className="pointer-events-none absolute inset-x-0 top-0 bottom-0 z-0 flex items-center justify-center px-28">
          <span
            className={cn(
              'max-w-full truncate text-center text-sm font-medium',
              !toolTitle && isDirty && 'text-amber-700 dark:text-amber-400'
            )}
            title={toolTitle ? title : (activePath ?? title)}>
            {!toolTitle && isDirty ? `• ${title}` : title}
          </span>
        </span>
      ) : null}
    </>
  )
}

export { KnowledgeCaptionBegin }
