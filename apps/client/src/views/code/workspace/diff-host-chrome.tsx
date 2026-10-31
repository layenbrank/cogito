import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'
import type { RefObject } from 'react'

import type { useCodeGitStore } from '@/stores/code-git'
import { HunksView } from '@/views/code/workspace/diff-hunks-view.tsx'
import type { DiffLayout } from '@/views/code/workspace/diff-host-layout.ts'

function DiffHostToolbar(props: {
  title: string
  modeHint: string
  isLoading: boolean
  onOpenInEditor: () => void
  onCloseDiffTab: () => void
}) {
  return (
    <div className="border-border bg-background flex h-7 shrink-0 items-center gap-2 border-b px-2 text-xs">
      <Icon
        icon="lucide:git-compare"
        className="text-muted-foreground size-3.5 shrink-0"
      />
      <span className="text-foreground truncate">{props.title}</span>
      <span className="text-muted-foreground shrink-0 text-[11px]">{props.modeHint}</span>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          disabled={props.isLoading}
          onClick={props.onOpenInEditor}>
          打开文件
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          onClick={props.onCloseDiffTab}>
          关闭
        </Button>
      </div>
    </div>
  )
}

function DiffHostOverlays(props: {
  isLoading: boolean
  isBinary: boolean
  isIdentical: boolean
  hasDiff: boolean
}) {
  return (
    <>
      {props.isLoading ? (
        <div className="bg-background/80 text-muted-foreground absolute inset-0 flex items-center justify-center gap-2 text-xs backdrop-blur-[1px]">
          <Icon
            icon="lucide:loader-circle"
            className="size-3.5 animate-spin"
          />
          正在读取差异…
        </div>
      ) : null}
      {props.isBinary ? (
        <div className="bg-background text-muted-foreground absolute inset-0 flex items-center justify-center text-xs">
          这是二进制文件，无法对比内容
        </div>
      ) : null}
      {props.hasDiff && !props.isLoading && props.isIdentical ? (
        <div className="bg-background/80 text-muted-foreground absolute inset-0 flex items-center justify-center text-xs">
          归一换行后内容相同，没有可展示的差异
        </div>
      ) : null}
    </>
  )
}

function DiffHostContent(props: {
  isOpen: boolean
  contentRef: RefObject<HTMLDivElement | null>
  sideHostRef: RefObject<HTMLDivElement | null>
  layout: DiffLayout
  isHunks: boolean
  isLoading: boolean
  hideMonaco: boolean
  diff: ReturnType<typeof useCodeGitStore.getState>['diff']
}) {
  const { diff } = props
  return (
    <div
      ref={props.contentRef}
      className="relative isolate min-h-0 flex-1 overflow-hidden">
      <div
        ref={props.sideHostRef}
        className={cn('size-full', props.hideMonaco && 'hidden')}
      />
      {props.isHunks && !props.isLoading && !diff?.isBinary ? (
        <HunksView layout={props.layout} />
      ) : null}
      <DiffHostOverlays
        isLoading={props.isLoading}
        isBinary={Boolean(diff?.isBinary)}
        isIdentical={Boolean(diff?.isIdentical)}
        hasDiff={Boolean(diff)}
      />
    </div>
  )
}

export { DiffHostContent, DiffHostToolbar }
