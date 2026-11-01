/**
 * 右栏文件编辑：Monaco 完整打开，可保存（Ctrl/Cmd+S）。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { bumpWorkspaceRevision } from '@/features/agent/workspace/revision.ts'
import { useAsideFilesEditor } from '@/views/agent/chat/components/use-aside-files-editor'
import {
  findBaseName,
  findParentRelative
} from '@/views/agent/chat/components/workspace-relative-path.ts'
import { writeCodeFile } from '@/views/code/lib/fs.ts'

type SaveStatus = 'idle' | 'saving' | 'saved'

function AsideFilesPreview(props: {
  rootPath: string | null
  previewRelative: string
  absolutePath: string | null
  isPending: boolean
  error: string | null
  content: string | null
  isReadonly: boolean
  onClose: () => void
  onAttach: () => void
  onOpenReview?: (relative: string) => void
}) {
  const savePathRef = useRef(props.absolutePath)
  const isReadonlyRef = useRef(props.isReadonly)
  savePathRef.current = props.absolutePath
  isReadonlyRef.current = props.isReadonly
  const [saveStatus, updateSaveStatus] = useState<SaveStatus>('idle')

  const editorApiRef = useRef<{
    findValue: () => string
    markSaved: (value: string) => void
    formatDocument: () => void
  } | null>(null)

  useEffect(
    function () {
      updateSaveStatus('idle')
    },
    [props.previewRelative, props.absolutePath]
  )

  function save() {
    const absolute = savePathRef.current
    const api = editorApiRef.current
    if (!absolute || !api) return
    if (isReadonlyRef.current) {
      toast.message('文件过大，已以只读方式打开')
      return
    }
    const value = api.findValue()
    updateSaveStatus('saving')
    void writeCodeFile(absolute, value)
      .then(function () {
        api.markSaved(value)
        bumpWorkspaceRevision()
        updateSaveStatus('saved')
        toast.success('已保存')
      })
      .catch(function (cause: unknown) {
        console.warn('[agent/aside-files] 保存失败:', cause)
        updateSaveStatus('idle')
        toast.error(cause instanceof Error ? cause.message : '保存失败')
      })
  }

  const editor = useAsideFilesEditor({
    rootPath: props.rootPath,
    absolutePath: props.absolutePath,
    relative: props.previewRelative,
    content: props.content,
    isPending: props.isPending,
    isReadonly: props.isReadonly,
    onSave: save
  })
  editorApiRef.current = {
    findValue: editor.findValue,
    markSaved: editor.markSaved,
    formatDocument: editor.formatDocument
  }

  useEffect(
    function () {
      if (editor.isDirty && saveStatus === 'saved') updateSaveStatus('idle')
    },
    [editor.isDirty, saveStatus]
  )

  function handleClose() {
    if (editor.isDirty) {
      toast.message('未保存的更改已丢弃')
    }
    props.onClose()
  }

  const canEdit = !props.isReadonly && !props.isPending && props.content !== null && !props.error
  const statusLabel = props.isReadonly
    ? '只读'
    : saveStatus === 'saving'
      ? '保存中…'
      : editor.isDirty
        ? '未保存'
        : canEdit
          ? '已保存'
          : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border flex h-9 shrink-0 items-center gap-1 border-b px-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="返回文件树"
          title="返回所在目录"
          className="size-7"
          onClick={handleClose}>
          <Icon
            icon="lucide:chevron-left"
            className="size-3.5"
          />
        </Button>
        {editor.isDirty ? (
          <span
            className="size-1.5 shrink-0 rounded-full bg-amber-500"
            title="未保存"
            aria-label="未保存"
          />
        ) : (
          <Icon
            icon="lucide:file"
            className="text-muted-foreground size-3.5 shrink-0"
          />
        )}
        <span
          className="text-foreground min-w-0 flex-1 truncate text-xs font-medium"
          title={props.previewRelative}>
          {findBaseName(props.previewRelative)}
        </span>
        <span
          className="text-muted-foreground hidden max-w-[36%] truncate text-xs sm:inline"
          title={props.previewRelative}>
          {findParentRelative(props.previewRelative) || '工作区'}
        </span>
        {statusLabel ? (
          <span
            className={clsx(
              'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
              props.isReadonly && 'bg-muted text-muted-foreground',
              saveStatus === 'saving' && 'bg-muted text-muted-foreground',
              editor.isDirty &&
                !props.isReadonly &&
                'bg-amber-500/15 text-amber-700 dark:text-amber-400',
              !editor.isDirty &&
                !props.isReadonly &&
                saveStatus !== 'saving' &&
                'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            )}
            aria-live="polite">
            {statusLabel}
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="格式化"
          title="格式化文档 (Shift+Alt+F)"
          className="size-7"
          disabled={props.isReadonly || props.isPending || props.content === null}
          onClick={function () {
            editor.formatDocument()
          }}>
          <Icon
            icon="lucide:align-left"
            className="size-3.5"
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="保存"
          title={editor.isDirty ? '保存 (Ctrl+S)' : '已保存'}
          className={clsx('size-7', editor.isDirty && 'text-amber-600 dark:text-amber-400')}
          disabled={props.isReadonly || props.isPending || !editor.isDirty || saveStatus === 'saving'}
          onClick={save}>
          <Icon
            icon={saveStatus === 'saving' ? 'lucide:loader-circle' : 'lucide:save'}
            className={clsx('size-3.5', saveStatus === 'saving' && 'animate-spin')}
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="添加到对话"
          title="添加到对话"
          className="size-7"
          onClick={props.onAttach}>
          <Icon
            icon="lucide:message-square-plus"
            className="size-3.5"
          />
        </Button>
        {props.onOpenReview ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="对比差异"
            title="对比差异"
            className="size-7"
            onClick={function () {
              props.onOpenReview?.(props.previewRelative)
            }}>
            <Icon
              icon="lucide:git-compare"
              className="size-3.5"
            />
          </Button>
        ) : null}
      </div>

      {props.isPending ? (
        <p className="text-muted-foreground flex items-center gap-1.5 p-3 text-xs">
          <Icon
            icon="lucide:loader-circle"
            className="size-3.5 animate-spin"
          />
          读取中…
        </p>
      ) : null}

      {props.error ? <p className="text-destructive p-3 text-xs">{props.error}</p> : null}

      <div
        ref={editor.hostRef}
        className={clsx(
          'min-h-0 flex-1',
          (props.isPending || props.error || props.content === null) && 'hidden'
        )}
      />
    </div>
  )
}

export { AsideFilesPreview }
