import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'

import {
  findBaseName,
  findParentRelative
} from '@/views/agent/chat/components/workspace-relative-path.ts'

function AsideFilesPreview(props: {
  previewRelative: string
  isPending: boolean
  error: string | null
  content: string | null
  isTruncated: boolean
  charLimit: number
  onClose: () => void
  onAttach: () => void
  onOpenReview?: (relative: string) => void
}) {
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
        <Icon
          icon="lucide:file"
          className="text-muted-foreground size-3.5 shrink-0"
        />
        <span
          className="text-foreground min-w-0 flex-1 truncate text-xs"
          title={props.previewRelative}>
          {findBaseName(props.previewRelative)}
        </span>
        <span
          className="text-muted-foreground hidden max-w-[40%] truncate text-[10px] sm:inline"
          title={props.previewRelative}>
          {findParentRelative(props.previewRelative) || '工作区'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="引用到输入框"
          title="引用到输入框"
          className="size-7"
          onClick={props.onAttach}>
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

      {!props.isPending && !props.error && props.content !== null ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <pre className="text-foreground p-3 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">
            {props.content || '（空文件）'}
          </pre>
          {props.isTruncated ? (
            <p className="text-muted-foreground border-border border-t px-3 py-2 text-[11px]">
              内容过长，仅预览前 {props.charLimit.toLocaleString()} 字符
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export { AsideFilesPreview }
