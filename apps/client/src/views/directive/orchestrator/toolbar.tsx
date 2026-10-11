import { Badge } from '@i-thinking/design/components/badge'
import { Button } from '@i-thinking/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@i-thinking/design/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@i-thinking/design/components/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@i-thinking/design/components/alert-dialog'
import { ScrollArea } from '@i-thinking/design/components/scroll-area'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useState } from 'react'
import { toast } from 'sonner'

import { editDirectiveExternal, fetchDirective } from '@/lib/directive-ipc.ts'
import type { Caps } from '@/views/directive/run/run-caps'
import { RunMenu } from '@/views/directive/run/run-menu'

interface OrchestratorToolbarProps {
  name: string
  description?: string
  bucket?: string | null
  folder?: string | null
  stepCount: number
  inputCount: number
  caps: Caps
  isDirty: boolean
  isSaving: boolean
  isPending: boolean
  canUndo: boolean
  canRedo: boolean
  isCatalogOpen: boolean
  isInspectorOpen: boolean
  isRunOpen: boolean
  onToggleCatalog: () => void
  onToggleInspector: () => void
  onToggleRun: () => void
  onBack: () => void
  onSave: () => void | Promise<void>
  onUndo: () => void
  onRedo: () => void
  onValidate: () => void
  onOnce: () => void | Promise<void>
  beforeGuard?: () => Promise<string | null>
  onDeleted: () => void
  onDelete: () => Promise<void>
}

function PanelToggle(props: {
  open: boolean
  openIcon: string
  closeIcon: string
  labelOpen: string
  labelClose: string
  onClick: () => void
}) {
  return (
    <Button
      size="sm"
      variant={props.open ? 'secondary' : 'ghost'}
      onClick={props.onClick}
      aria-label={props.open ? props.labelClose : props.labelOpen}
      aria-pressed={props.open}
      className="transition-[background-color,color,transform] duration-200">
      <Icon
        key={props.open ? props.closeIcon : props.openIcon}
        icon={props.open ? props.closeIcon : props.openIcon}
        className={cn(
          'size-4 transition-[transform,opacity] duration-200 ease-out',
          props.open ? 'scale-100 opacity-100' : 'scale-95 opacity-80'
        )}
      />
    </Button>
  )
}

function OrchestratorToolbar(props: OrchestratorToolbarProps) {
  const [isYamlOpen, setYamlOpen] = useState(false)
  const [yamlText, setYamlText] = useState('')
  const [isYamlLoading, setYamlLoading] = useState(false)
  const [isDeleteOpen, setDeleteOpen] = useState(false)
  const [isDeleting, setDeleting] = useState(false)

  async function openYaml() {
    if (!props.name || props.isPending) return
    setYamlOpen(true)
    setYamlLoading(true)
    try {
      const document = await fetchDirective(props.name)
      setYamlText(document.yaml || '')
    } catch (error) {
      setYamlText('')
      toast.error('无法读取 YAML', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setYamlLoading(false)
    }
  }

  async function openExternal() {
    if (!props.name || props.isDirty || props.isPending) return
    try {
      await editDirectiveExternal(props.name)
      toast.message('已请求外部编辑器')
    } catch (error) {
      toast.error('无法打开外部编辑器', {
        description: error instanceof Error ? error.message : String(error)
      })
    }
  }

  async function confirmDelete() {
    setDeleting(true)
    try {
      await props.onDelete()
      setDeleteOpen(false)
      props.onDeleted()
    } catch (error) {
      toast.error('删除失败', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setDeleting(false)
    }
  }

  const title = props.description?.trim() || undefined

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div className="flex min-w-0 items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={props.onBack}
          aria-label="返回指令库">
          <Icon
            icon="lucide:arrow-left"
            className="size-4"
          />
        </Button>
        <PanelToggle
          open={props.isCatalogOpen}
          openIcon="lucide:panel-left-open"
          closeIcon="lucide:panel-left-close"
          labelOpen="展开动作目录"
          labelClose="收起动作目录"
          onClick={props.onToggleCatalog}
        />
        <div className="min-w-0 px-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1
              title={title}
              className="truncate text-sm font-semibold">
              {props.name || '未命名指令'}
            </h1>
            {props.isDirty ? (
              <Badge
                variant="outline"
                className="shrink-0 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                未保存
              </Badge>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">已同步</span>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {props.stepCount} 步 · {props.inputCount} 输入
            </span>
            {props.bucket ? (
              <Badge
                variant="outline"
                className="h-5 px-1.5 py-0 font-normal">
                {props.bucket}
              </Badge>
            ) : null}
            {props.folder ? (
              <Badge
                variant="secondary"
                className="h-5 px-1.5 py-0 font-normal">
                {props.folder}
              </Badge>
            ) : null}
            {props.caps.hasCron ? (
              <Badge
                variant="outline"
                className="h-5 gap-1 px-1.5 py-0 font-normal text-primary">
                <Icon
                  icon="mdi:clock-outline"
                  className="size-3"
                />
                cron
              </Badge>
            ) : null}
            {props.caps.hasWatch ? (
              <Badge
                variant="outline"
                className="h-5 gap-1 px-1.5 py-0 font-normal text-primary">
                <Icon
                  icon="mdi:eye-outline"
                  className="size-3"
                />
                watch
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={!props.canUndo}
          onClick={props.onUndo}>
          <Icon
            icon="lucide:undo-2"
            className="size-4"
          />
          撤销
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!props.canRedo}
          onClick={props.onRedo}>
          <Icon
            icon="lucide:redo-2"
            className="size-4"
          />
          重做
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={props.onValidate}>
          校验
        </Button>
        <Button
          size="sm"
          disabled={!props.isDirty || props.isSaving}
          onClick={function () {
            void props.onSave()
          }}>
          <Icon
            icon="lucide:save"
            className="size-4"
          />
          {props.isSaving ? '保存中…' : '保存'}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="更多操作"
                title="更多操作"
              />
            }>
            <Icon
              icon="lucide:ellipsis"
              className="size-4"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="cursor-pointer"
              disabled={props.isPending || !props.name}
              onClick={function () {
                void openYaml()
              }}>
              <Icon
                icon="mdi:code-json"
                className="size-4"
              />
              查看 YAML
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer"
              disabled={props.isPending || props.isDirty || !props.name}
              onClick={function () {
                void openExternal()
              }}>
              <Icon
                icon="mdi:pencil-outline"
                className="size-4"
              />
              外部编辑器
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              className="cursor-pointer"
              disabled={props.isPending || !props.name}
              onClick={function () {
                setDeleteOpen(true)
              }}>
              <Icon
                icon="mdi:trash-can-outline"
                className="size-4"
              />
              删除指令
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <RunMenu
          name={props.name}
          caps={props.caps}
          disabled={!props.name || props.isPending}
          onOnce={props.onOnce}
          beforeGuard={props.beforeGuard}
        />

        <PanelToggle
          open={props.isRunOpen}
          openIcon="lucide:panel-bottom-open"
          closeIcon="lucide:panel-bottom-close"
          labelOpen="展开运行台"
          labelClose="收起运行台"
          onClick={props.onToggleRun}
        />
        <PanelToggle
          open={props.isInspectorOpen}
          openIcon="lucide:panel-right-open"
          closeIcon="lucide:panel-right-close"
          labelOpen="展开检查器"
          labelClose="收起检查器"
          onClick={props.onToggleInspector}
        />
      </div>

      <Dialog
        open={isYamlOpen}
        onOpenChange={setYamlOpen}>
        <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col gap-3">
          <DialogHeader>
            <DialogTitle>YAML · {props.name}</DialogTitle>
            <DialogDescription>corex 落库的只读副本；未保存的本地修改不会出现在这里。</DialogDescription>
          </DialogHeader>
          <ScrollArea className="min-h-0 flex-1 rounded-md border bg-muted/30">
            <pre className="m-0 whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5">
              {isYamlLoading ? '读取中…' : yamlText || '（空）'}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={isDeleteOpen}
        onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{props.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              指令将从 corex 库中永久删除，无法在此恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isDeleting}
              onClick={function (event) {
                event.preventDefault()
                void confirmDelete()
              }}>
              {isDeleting ? '删除中…' : '删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { OrchestratorToolbar }
