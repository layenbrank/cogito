/**
 * 侧栏工具栏：搜索 + 新建文档 + 少量操作。
 *
 * 空间切换在 SpaceSwitcher，新建空间在弹窗；这里只留「在这片空间里找东西 / 写字」。
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
import { Input } from '@cogito/design/components/input'
import { Spinner } from '@cogito/design/components/spinner'

import { runCommand } from '@/keyboard/commands'
import { SHORTCUT_COMMAND } from '@/keyboard/definitions'
import { t } from '@/views/knowledge/locale.ts'
import { useSurfaceStore } from '@/views/knowledge/surface/store.ts'
import type { useDocsTab } from '@/views/knowledge/surface/use-docs-tab.ts'

type DocsTabState = ReturnType<typeof useDocsTab>

function DocsTabToolbar(props: DocsTabState) {
  const toSetNewSpaceOpen = useSurfaceStore(function (state) {
    return state.toSetNewSpaceOpen
  })
  const toSetTab = useSurfaceStore(function (state) {
    return state.toSetTab
  })
  const hasSpace = props.spaces.length > 0

  return (
    <>
      <form
        className="relative flex items-center"
        onSubmit={function (event) {
          event.preventDefault()
          void props.runSearch()
        }}>
        <Icon
          icon="lucide:search"
          className="text-muted-foreground pointer-events-none absolute left-2.5 size-3.5"
        />
        <Input
          value={props.query}
          placeholder={t('DOC_SEARCH')}
          title="全文检索；1–2 字中文也能命中"
          className="bg-muted/40 focus-visible:bg-background h-9 border-transparent pl-8 text-[13px]"
          disabled={!props.activeSpaceID}
          onChange={function (event) {
            props.writeQuery(event.target.value)
          }}
        />
        {props.hits.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-muted-foreground absolute right-1 h-7 px-2 text-xs"
            onClick={props.clearSearch}>
            清除
          </Button>
        ) : null}
      </form>

      {hasSpace ? (
        <div className="flex items-center gap-1.5">
          <Button
            className="h-9 flex-1 gap-1.5 text-[13px] font-medium"
            disabled={!props.activeSpaceID}
            onClick={function () {
              void runCommand(SHORTCUT_COMMAND.KNOWLEDGE_NEW)
            }}>
            <Icon
              icon="lucide:square-pen"
              className="size-4"
            />
            {t('DOC_NEW')}
          </Button>
          <Button
            variant="ghost"
            className="text-muted-foreground hover:text-foreground h-9 shrink-0 gap-1.5 px-2 text-xs font-medium"
            title="让助手按主题起草，先进待发布区"
            disabled={!props.activeSpaceID}
            onClick={props.openNewDocDock}>
            <Icon
              icon="lucide:sparkles"
              className="size-4"
            />
            起草
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground size-9 shrink-0 px-0"
                  title="更多操作"
                />
              }>
              <Icon
                icon="lucide:ellipsis-vertical"
                className="size-4"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-40">
              <DropdownMenuItem
                disabled={props.isLoading || !props.activeSpaceID}
                onClick={function () {
                  void props.rescan()
                }}>
                <Icon
                  icon="lucide:refresh-cw"
                  className="size-3.5"
                />
                重新扫描
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!props.activeSpace || props.docs.length === 0}
                onClick={function () {
                  void props.exportBundle()
                }}>
                <Icon
                  icon="lucide:archive"
                  className="size-3.5"
                />
                导出空间
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={function () {
                  toSetTab('staging')
                }}>
                <Icon
                  icon="lucide:inbox"
                  className="size-3.5"
                />
                待发布
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={function () {
                  toSetNewSpaceOpen(true)
                }}>
                <Icon
                  icon="lucide:plus"
                  className="size-3.5"
                />
                {t('SPACE_NEW')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {props.isLoading ? <Spinner className="size-3 shrink-0" /> : null}
        </div>
      ) : (
        <div className="border-border/70 bg-muted/20 flex flex-col items-start gap-2 rounded-lg border border-dashed px-3 py-3">
          <p className="text-[13px] font-medium">{t('SPACE_EMPTY')}</p>
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            空间就是文档的容器，新建后就是一个可写的编辑器。
          </p>
          <Button
            className="h-9 w-full gap-1.5 text-[13px]"
            onClick={function () {
              toSetNewSpaceOpen(true)
            }}>
            <Icon
              icon="lucide:plus"
              className="size-4"
            />
            {t('SPACE_NEW')}
          </Button>
        </div>
      )}

      {props.error ? (
        <p className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-2 py-1 text-[11px]">
          {props.error}
        </p>
      ) : null}
    </>
  )
}

export { DocsTabToolbar }
