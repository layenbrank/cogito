/**
 * Markdown 窗 Caption 左侧（Decorations.begin）：
 * 应用菜单（打开/新建/保存/导出）靠左；当前文件名居中。
 * 搜文件在侧栏；打开等勿再堆到内容区工具条。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@i-thinking/design/components/dropdown-menu'
import { cn } from 'cn'

import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { runCommand } from '@/keyboard/commands'
import { SHORTCUT_COMMAND } from '@/keyboard/definitions'
import { useMarkdownStore } from '@/stores/markdown'
import { t } from '@/views/markdown/locale.ts'

function MarkdownCaptionBegin() {
  const isDirty = useMarkdownStore(function (state) {
    return state.isDirty
  })
  const activePath = useMarkdownStore(function (state) {
    return state.activePath
  })
  const hasOpened = useMarkdownStore(function (state) {
    return state.hasOpened
  })

  const title = !hasOpened
    ? findComponentLabel('markdown')
    : (activePath?.split(/[/\\]/).pop() ?? t('UNTITLED'))

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
              void runCommand(SHORTCUT_COMMAND.MARKDOWN_OPEN_FILE)
            }}>
            <Icon
              icon="lucide:file-text"
              className="size-4"
            />
            {t('OPEN_FILE')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={function () {
              void runCommand(SHORTCUT_COMMAND.MARKDOWN_OPEN_FOLDER)
            }}>
            <Icon
              icon="lucide:folder"
              className="size-4"
            />
            {t('OPEN_FOLDER')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={function () {
              void runCommand(SHORTCUT_COMMAND.MARKDOWN_NEW)
            }}>
            <Icon
              icon="lucide:file-plus-2"
              className="size-4"
            />
            {t('NEW')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={function () {
              void runCommand(SHORTCUT_COMMAND.MARKDOWN_SAVE)
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
              void runCommand(SHORTCUT_COMMAND.MARKDOWN_EXPORT_HTML)
            }}>
            <Icon
              icon="lucide:file-down"
              className="size-4"
            />
            {t('EXPORT_HTML')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={function () {
              void runCommand(SHORTCUT_COMMAND.MARKDOWN_COPY_MARKDOWN)
            }}>
            <Icon
              icon="lucide:clipboard-copy"
              className="size-4"
            />
            {t('COPY_MD')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={function () {
              void runCommand(SHORTCUT_COMMAND.MARKDOWN_COPY_HTML)
            }}>
            <Icon
              icon="lucide:code-xml"
              className="size-4"
            />
            {t('COPY_HTML')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 相对 Caption（relative）整栏居中，不挡拖拽 */}
      <span
        className="pointer-events-none absolute inset-x-0 top-0 bottom-0 z-0 flex items-center justify-center px-28">
        <span
          className={cn(
            'max-w-full truncate text-center text-sm font-medium',
            isDirty && 'text-amber-700 dark:text-amber-400'
          )}
          title={activePath ?? title}>
          {isDirty ? `• ${title}` : title}
        </span>
      </span>
    </>
  )
}

export { MarkdownCaptionBegin }
