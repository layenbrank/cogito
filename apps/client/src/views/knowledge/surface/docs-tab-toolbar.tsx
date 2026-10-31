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

import type { useDocsTab } from '@/views/knowledge/surface/use-docs-tab.ts'

type DocsTabState = ReturnType<typeof useDocsTab>

function DocsTabToolbar(props: DocsTabState) {
  return (
    <>
      <div className="flex items-center gap-1">
        <Select
          value={props.activeBaseID ?? undefined}
          onValueChange={function (value) {
            if (typeof value === 'string') void props.selectBase(value)
          }}>
          <SelectTrigger
            size="sm"
            className="min-w-0 flex-1">
            <SelectValue placeholder="选择知识库" />
          </SelectTrigger>
          <SelectContent>
            {props.bases.map(function (base) {
              return (
                <SelectItem
                  key={base.id}
                  value={base.id}>
                  {base.name}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
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

      {props.isCreating ? (
        <div className="flex items-center gap-1">
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
          title="1–2 字也能命中"
          className="h-7 text-xs"
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
              disabled={props.isSyncingCloud || !props.activeBase || props.docs.length === 0}
              onClick={function () {
                void props.syncCloud()
              }}>
              <Icon
                icon="lucide:cloud-upload"
                className="size-3.5"
              />
              上云
            </DropdownMenuItem>
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
