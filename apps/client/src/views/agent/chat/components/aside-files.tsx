/**
 * 右栏文件树：浏览 / 搜索工作区，点选后预览正文。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import type { useAui } from '@assistant-ui/react'

import { attachWorkspaceFile } from '@/features/agent/attachment.ts'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { WorkspaceFiles } from '@/lib/workspace-files.ts'
import { WorkspaceFilePicker } from '@/views/agent/chat/components/workspace-file-picker'

type ComposerAui = ReturnType<typeof useAui>

interface AsideFilesProps {
  aui: ComposerAui
  initialRelative?: string | null
  onOpenReview?: (relative: string) => void
}

const PREVIEW_CHAR_LIMIT = 120_000

function findBaseName(relative: string) {
  const slash = relative.lastIndexOf('/')
  return slash < 0 ? relative : relative.slice(slash + 1)
}

function AsideFiles(props: AsideFilesProps) {
  const { primaryPath } = useActiveWorkspace()
  const [previewRelative, updatePreviewRelative] = useState<string | null>(
    props.initialRelative ?? null
  )
  const [seenInitial, updateSeenInitial] = useState(props.initialRelative ?? null)
  const [contentState, updateContent] = useState<string | null>(null)
  const [isPending, updatePending] = useState(false)
  const [errorState, updateError] = useState<string | null>(null)
  const [isTruncated, updateTruncated] = useState(false)

  // 外部指定预览文件时在渲染期同步，不进 effect
  if (props.initialRelative !== seenInitial) {
    updateSeenInitial(props.initialRelative ?? null)
    updatePreviewRelative(props.initialRelative ?? null)
  }

  /** 没有选中文件或没有工作区时按空内容渲染 */
  const content = previewRelative && primaryPath ? contentState : null
  const error = previewRelative && primaryPath ? errorState : null

  useEffect(
    function () {
      if (!previewRelative || !primaryPath) return

      let cancelled = false

      async function load() {
        try {
          updatePending(true)
          updateError(null)
          const result = await WorkspaceFiles.readFile(
            [primaryPath as string],
            previewRelative as string
          )
          if (cancelled) return
          const text = result.content ?? ''
          if (text.length > PREVIEW_CHAR_LIMIT) {
            updateContent(text.slice(0, PREVIEW_CHAR_LIMIT))
            updateTruncated(true)
          } else {
            updateContent(text)
            updateTruncated(false)
          }
        } catch (cause) {
          console.warn('[agent/aside-files] 读取文件失败:', cause)
          if (!cancelled) {
            updateContent(null)
            updateError(cause instanceof Error ? cause.message : '读取失败')
          }
        } finally {
          if (!cancelled) updatePending(false)
        }
      }

      void load()

      return function () {
        cancelled = true
      }
    },
    [previewRelative, primaryPath]
  )

  function handlePick(relative: string) {
    updatePreviewRelative(relative)
  }

  function handleAttach() {
    if (!previewRelative) return
    void attachWorkspaceFile(props.aui, previewRelative)
      .then(function () {
        toast.success(`已引用 ${findBaseName(previewRelative)}`)
      })
      .catch(function (cause: unknown) {
        toast.error(cause instanceof Error ? cause.message : '引用失败')
      })
  }

  if (previewRelative) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-border flex h-9 shrink-0 items-center gap-1 border-b px-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="返回文件树"
            className="size-7"
            onClick={function () {
              updatePreviewRelative(null)
            }}>
            <Icon
              icon="lucide:chevron-left"
              className="size-3.5"
            />
          </Button>
          <Icon
            icon="lucide:file"
            className="text-muted-foreground size-3.5 shrink-0"
          />
          <span
            className="text-foreground min-w-0 flex-1 truncate text-xs"
            title={previewRelative}>
            {previewRelative}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="引用到输入框"
            title="引用到输入框"
            className="size-7"
            onClick={handleAttach}>
            <Icon
              icon="lucide:paperclip"
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
                props.onOpenReview?.(previewRelative)
              }}>
              <Icon
                icon="lucide:git-compare"
                className="size-3.5"
              />
            </Button>
          ) : null}
        </div>

        {isPending ? (
          <p className="text-muted-foreground flex items-center gap-1.5 p-3 text-xs">
            <Icon
              icon="lucide:loader-circle"
              className="size-3.5 animate-spin"
            />
            读取中…
          </p>
        ) : null}

        {error ? <p className="text-destructive p-3 text-xs">{error}</p> : null}

        {!isPending && !error && content !== null ? (
          <div className="min-h-0 flex-1 overflow-auto">
            <pre className="text-foreground p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
              {content || '（空文件）'}
            </pre>
            {isTruncated ? (
              <p className="text-muted-foreground border-border border-t px-3 py-2 text-[11px]">
                内容过长，仅预览前 {PREVIEW_CHAR_LIMIT.toLocaleString()} 字符
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  if (!primaryPath) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center p-4 text-center text-xs">
        先在左栏添加一个工作区
      </div>
    )
  }

  return (
    <WorkspaceFilePicker
      active
      className="flex min-h-0 flex-1 flex-col"
      listClassName="min-h-0"
      onPick={handlePick}
    />
  )
}

export { AsideFiles }
