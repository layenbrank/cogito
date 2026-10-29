import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { Icon } from '@iconify/react/offline'
import { useState } from 'react'
import { toast } from 'sonner'

import { editDirectiveExternal, fetchDirective } from '@/lib/directive-ipc.ts'
import type { Caps } from '@/views/directive/run/run-caps'
import { RunMenu } from '@/views/directive/run/run-menu'
import { SurfaceToggle } from '@/views/directive/orchestrator/toolbar-surface-toggle.tsx'
import {
  ToolbarDeleteDialog,
  ToolbarYamlDialog
} from '@/views/directive/orchestrator/toolbar-dialogs.tsx'
import { ToolbarTitle } from '@/views/directive/orchestrator/toolbar-title.tsx'

interface ToolbarProps {
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

function Toolbar(props: ToolbarProps) {
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
        <SurfaceToggle
          open={props.isCatalogOpen}
          openIcon="lucide:panel-left-open"
          closeIcon="lucide:panel-left-close"
          labelOpen="展开动作目录"
          labelClose="收起动作目录"
          onClick={props.onToggleCatalog}
        />
        <ToolbarTitle
          name={props.name}
          description={props.description}
          bucket={props.bucket}
          folder={props.folder}
          stepCount={props.stepCount}
          inputCount={props.inputCount}
          caps={props.caps}
          isDirty={props.isDirty}
        />
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

        <SurfaceToggle
          open={props.isRunOpen}
          openIcon="lucide:panel-bottom-open"
          closeIcon="lucide:panel-bottom-close"
          labelOpen="展开底部面板"
          labelClose="收起底部面板"
          onClick={props.onToggleRun}
        />
        <SurfaceToggle
          open={props.isInspectorOpen}
          openIcon="lucide:panel-right-open"
          closeIcon="lucide:panel-right-close"
          labelOpen="展开检查器"
          labelClose="收起检查器"
          onClick={props.onToggleInspector}
        />
      </div>

      <ToolbarYamlDialog
        name={props.name}
        open={isYamlOpen}
        isLoading={isYamlLoading}
        yamlText={yamlText}
        onOpenChange={setYamlOpen}
      />

      <ToolbarDeleteDialog
        name={props.name}
        open={isDeleteOpen}
        isDeleting={isDeleting}
        onOpenChange={setDeleteOpen}
        onConfirm={function () {
          void confirmDelete()
        }}
      />
    </div>
  )
}

export { Toolbar }
