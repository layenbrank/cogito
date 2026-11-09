/**
 * 右栏文件预览：文本用 Monaco 完整打开并可保存（Ctrl/Cmd+S），
 * 图片 / 音视频用 asset 协议直接渲染，其余二进制只给「用默认应用打开」。
 *
 * 类型分流见 `aside-files-preview-kind.ts` —— 以前这里一律交给 Monaco，
 * 点开图片只会得到一句「这是二进制文件，无法在编辑器中打开」。
 *
 * 三种预览各自是一个组件（而不是在同一个组件里分支）：Monaco 只在文本预览里挂载，
 * 看图片时不会白建一个编辑器。
 */
import { Icon } from '@iconify/react/offline'
import { convertFileSrc } from '@tauri-apps/api/core'
import { openPath } from '@tauri-apps/plugin-opener'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { bumpWorkspaceRevision } from '@/features/agent/workspace/revision.ts'
import type { AsidePreviewKind } from '@/views/agent/chat/components/aside-files-preview-kind.ts'
import { useAsideFilesEditor } from '@/views/agent/chat/components/use-aside-files-editor'
import {
  findBaseName,
  findParentRelative
} from '@/views/agent/chat/components/workspace-relative-path.ts'
import { writeCodeFile } from '@/views/code/lib/fs.ts'

type SaveStatus = 'idle' | 'saving' | 'saved'

interface PreviewShellProps {
  relative: string
  isDirty?: boolean
  status?: { label: string; className: string } | null
  /** 文本预览的「格式化 / 保存」等按钮；图片与二进制没有 */
  actions?: ReactNode
  onClose: () => void
  onAttach: () => void
  onOpenReview?: (relative: string) => void
  children: ReactNode
}

/** 三种预览共用的顶栏：返回 / 脏点 / 文件名 / 所属目录 / 状态 / 动作 */
function PreviewShell(props: PreviewShellProps) {
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
          onClick={props.onClose}>
          <Icon
            icon="lucide:chevron-left"
            className="size-3.5"
          />
        </Button>
        {props.isDirty ? (
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
          title={props.relative}>
          {findBaseName(props.relative)}
        </span>
        <span
          className="text-muted-foreground hidden max-w-[36%] truncate text-xs sm:inline"
          title={props.relative}>
          {findParentRelative(props.relative) || '工作区'}
        </span>
        {props.status ? (
          <span
            className={clsx(
              'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
              props.status.className
            )}
            aria-live="polite">
            {props.status.label}
          </span>
        ) : null}
        {props.actions}
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
              props.onOpenReview?.(props.relative)
            }}>
            <Icon
              icon="lucide:git-compare"
              className="size-3.5"
            />
          </Button>
        ) : null}
      </div>
      {props.children}
    </div>
  )
}

function AsideTextPreview(props: {
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
  const status = props.isReadonly
    ? { label: '只读', className: 'bg-muted text-muted-foreground' }
    : saveStatus === 'saving'
      ? { label: '保存中…', className: 'bg-muted text-muted-foreground' }
      : editor.isDirty
        ? { label: '未保存', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' }
        : canEdit
          ? { label: '已保存', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' }
          : null

  return (
    <PreviewShell
      relative={props.previewRelative}
      isDirty={editor.isDirty}
      status={status}
      onClose={handleClose}
      onAttach={props.onAttach}
      onOpenReview={props.onOpenReview}
      actions={
        <>
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
            disabled={
              props.isReadonly || props.isPending || !editor.isDirty || saveStatus === 'saving'
            }
            onClick={save}>
            <Icon
              icon={saveStatus === 'saving' ? 'lucide:loader-circle' : 'lucide:save'}
              className={clsx('size-3.5', saveStatus === 'saving' && 'animate-spin')}
            />
          </Button>
        </>
      }>
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
    </PreviewShell>
  )
}

/**
 * 透明像素的棋盘格底。
 *
 * 挂在 `<img>` 自己的背景上（不是整块面板）：只有图片真的有透明区域时才看得到，
 * 不透明的图片会整片盖住它，不会在四周留白处误标成「透明」。
 *
 * 两格都从设计 token 现算 —— `--background` 是白 / 近黑，`--foreground` 是近黑 / 近白，
 * 所以亮暗两套主题各自动成立，不用写两份颜色。
 * 12% 是目视试出来的：8% 在亮色下太淡、16% 在暗色下太吵，12% 两侧都清楚又不抢图。
 */
const CHECKER_STYLE = {
  backgroundImage:
    'repeating-conic-gradient(color-mix(in oklab, var(--foreground) 12%, var(--background)) 0% 25%, var(--background) 0% 50%)',
  backgroundSize: '16px 16px'
}

/** 图片 / 音视频：不读文本，走 `asset:` 协议（作用域已放开到 `**`，工作区文件可直读） */
function AsideMediaPreview(props: {
  kind: 'image' | 'audio' | 'video'
  absolutePath: string
  relative: string
  onClose: () => void
  onAttach: () => void
  onOpenReview?: (relative: string) => void
}) {
  const src = convertFileSrc(props.absolutePath)

  return (
    <PreviewShell
      relative={props.relative}
      onClose={props.onClose}
      onAttach={props.onAttach}
      onOpenReview={props.onOpenReview}>
      {props.kind === 'image' ? (
        <div className="bg-muted/30 flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
          <img
            src={src}
            alt={findBaseName(props.relative)}
            title={props.relative}
            draggable={false}
            style={CHECKER_STYLE}
            className="ring-border max-h-full max-w-full object-contain ring-1"
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4">
          {props.kind === 'video' ? (
            <video
              src={src}
              controls
              className="max-h-full w-full rounded-md bg-black"
            />
          ) : (
            <audio
              src={src}
              controls
              className="w-full"
            />
          )}
          <span
            className="text-muted-foreground w-full truncate text-center text-xs"
            title={props.relative}>
            {findBaseName(props.relative)}
          </span>
        </div>
      )}
    </PreviewShell>
  )
}

/** 预览不了的二进制：给出「用默认应用打开」，别假装能渲染 */
function AsideBinaryPreview(props: {
  absolutePath: string | null
  relative: string
  onClose: () => void
  onAttach: () => void
  onOpenReview?: (relative: string) => void
}) {
  function openWithSystem() {
    if (!props.absolutePath) return
    void openPath(props.absolutePath).catch(function (cause: unknown) {
      console.warn('[agent/aside-files] 用默认应用打开失败:', cause)
      toast.error(cause instanceof Error ? cause.message : '打开失败')
    })
  }

  return (
    <PreviewShell
      relative={props.relative}
      onClose={props.onClose}
      onAttach={props.onAttach}
      onOpenReview={props.onOpenReview}>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <Icon
          icon="lucide:file-box"
          className="text-muted-foreground/70 size-8"
        />
        <p
          className="text-muted-foreground max-w-full truncate text-xs"
          title={props.relative}>
          {props.relative}
        </p>
        <p className="text-muted-foreground text-xs leading-relaxed">这种文件不能在这里预览</p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-1 gap-1.5"
          onClick={openWithSystem}>
          <Icon
            icon="lucide:external-link"
            className="size-3.5"
          />
          用默认应用打开
        </Button>
      </div>
    </PreviewShell>
  )
}

function AsideFilesPreview(props: {
  rootPath: string | null
  previewRelative: string
  absolutePath: string | null
  kind: AsidePreviewKind
  isPending: boolean
  error: string | null
  content: string | null
  isReadonly: boolean
  onClose: () => void
  onAttach: () => void
  onOpenReview?: (relative: string) => void
}) {
  if (props.kind === 'image' || props.kind === 'audio' || props.kind === 'video') {
    // 绝对路径还没算出来时先不挂载 <img>，避免 src 为空触发一次失败请求
    if (!props.absolutePath) return null
    return (
      <AsideMediaPreview
        kind={props.kind}
        absolutePath={props.absolutePath}
        relative={props.previewRelative}
        onClose={props.onClose}
        onAttach={props.onAttach}
        onOpenReview={props.onOpenReview}
      />
    )
  }

  if (props.kind === 'binary') {
    return (
      <AsideBinaryPreview
        absolutePath={props.absolutePath}
        relative={props.previewRelative}
        onClose={props.onClose}
        onAttach={props.onAttach}
        onOpenReview={props.onOpenReview}
      />
    )
  }

  return (
    <AsideTextPreview
      rootPath={props.rootPath}
      previewRelative={props.previewRelative}
      absolutePath={props.absolutePath}
      isPending={props.isPending}
      error={props.error}
      content={props.content}
      isReadonly={props.isReadonly}
      onClose={props.onClose}
      onAttach={props.onAttach}
      onOpenReview={props.onOpenReview}
    />
  )
}

export { AsideFilesPreview }
