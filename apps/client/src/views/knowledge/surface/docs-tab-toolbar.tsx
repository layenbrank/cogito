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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Spinner } from '@cogito/design/components/spinner'

import { BaseCombobox } from '@/views/knowledge/surface/base-combobox.tsx'
import type { useDocsTab } from '@/views/knowledge/surface/use-docs-tab.ts'
import { WIKI_TEMPLATES } from '@/views/knowledge/lib/wiki-templates.ts'

type DocsTabState = ReturnType<typeof useDocsTab>

function DocsTabToolbar(props: DocsTabState) {
  const isEmpty = props.bases.length === 0

  return (
    <>
      <div className="flex items-center gap-1">
        <BaseCombobox
          bases={props.bases}
          value={props.activeBaseID ?? null}
          onValueChange={function (baseID) {
            void props.selectBase(baseID)
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          title="新建知识库"
          onClick={function () {
            props.toSetCreating(!props.isCreating)
          }}>
          <Icon
            icon="lucide:plus"
            className="size-3.5"
          />
        </Button>
      </div>

      {isEmpty && !props.isCreating ? (
        <div className="rounded-md border border-dashed border-border/70 bg-muted/20 px-2 py-2 text-[11px] text-muted-foreground">
          <p className="mb-1.5">还没有知识库。选场景模板新建，或导入示例库。</p>
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              className="h-6 text-[11px]"
              onClick={function () {
                props.toSetCreating(true)
              }}>
              新建知识库
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[11px]"
              onClick={function () {
                void props.importExample()
              }}>
              导入示例库
            </Button>
          </div>
        </div>
      ) : null}

      {props.isCreating ? (
        <div className="flex flex-col gap-1">
          <Input
            autoFocus
            value={props.newName}
            placeholder="知识库名称"
            className="h-7 text-xs"
            onChange={function (event) {
              props.setNewName(event.target.value)
            }}
            onKeyDown={function (event) {
              if (event.key !== 'Enter' || !props.newName.trim()) return
              void props.insert(props.newName.trim()).then(function (ok) {
                if (ok) {
                  props.setNewName('')
                  props.toSetCreating(false)
                }
              })
            }}
          />
          <Select
            value={props.templateId}
            items={WIKI_TEMPLATES.map(function (template) {
              return { value: template.id, label: template.name }
            })}
            onValueChange={function (value) {
              if (typeof value === 'string') props.setTemplateId(value)
            }}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="场景模板" />
            </SelectTrigger>
            <SelectContent>
              {WIKI_TEMPLATES.map(function (template) {
                return (
                  <SelectItem
                    key={template.id}
                    value={template.id}
                    className="text-xs">
                    {template.name}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              disabled={!props.newName.trim()}
              onClick={function () {
                void props.insert(props.newName.trim()).then(function (ok) {
                  if (ok) {
                    props.setNewName('')
                    props.toSetCreating(false)
                  }
                })
              }}>
              建
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={function () {
                void props.importExample().then(function (ok) {
                  if (ok) props.toSetCreating(false)
                })
              }}>
              导入示例
            </Button>
          </div>
        </div>
      ) : null}

      <form
        className="flex items-center gap-1"
        onSubmit={function (event) {
          event.preventDefault()
          void props.runSearch()
        }}>
        <Input
          value={props.query}
          placeholder="检索…"
          title="全文检索；1–2 字中文也能命中"
          className="h-7 text-xs"
          disabled={!props.activeBaseID}
          onChange={function (event) {
            props.writeQuery(event.target.value)
          }}
        />
        {props.hits.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={props.clearSearch}>
            清除
          </Button>
        ) : null}
      </form>

      {props.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
          {props.error}
        </p>
      ) : null}

      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-1.5 text-[11px] font-normal"
          title="让助手按主题写一篇新文档"
          disabled={!props.activeBaseID}
          onClick={props.openNewDocDock}>
          <Icon
            icon="lucide:sparkles"
            className="size-3"
          />
          生成
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 px-0"
                title="库操作"
              />
            }>
            <Icon
              icon="lucide:ellipsis"
              className="size-3.5"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-32">
            <DropdownMenuItem
              onClick={function () {
                void props.importExample()
              }}>
              <Icon
                icon="lucide:package-open"
                className="size-3.5"
              />
              导入示例库
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={props.isLoading || !props.activeBaseID}
              onClick={function () {
                void props.rescan()
              }}>
              <Icon
                icon="lucide:refresh-cw"
                className="size-3.5"
              />
              重扫
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!props.activeBase || props.docs.length === 0}
              onClick={function () {
                void props.exportBundle()
              }}>
              <Icon
                icon="lucide:archive"
                className="size-3.5"
              />
              导出
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {props.isLoading ? <Spinner className="ml-auto size-3" /> : null}
      </div>
    </>
  )
}

export { DocsTabToolbar }
