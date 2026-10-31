/**
 * 右栏内联 Diff：HEAD ↔ 工作区。
 * 小文件 Monaco inline；大重写走 hunks 列表，禁止 DiffEditor LCS。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'

import '@/lib/monaco-environment.ts'
import { useAsideDiffData } from '@/views/agent/chat/components/aside-diff-data'
import { useAsideDiffEditor } from '@/views/agent/chat/components/aside-diff-editor'
import { AsideDiffViewport } from '@/views/agent/chat/components/aside-diff-viewport'

interface AsideDiffProps {
  rootPath: string
  relative: string
  onBack: () => void
}

function AsideDiffHeader(props: { relative: string; isHunks: boolean; onBack: () => void }) {
  const fileName = props.relative.includes('/')
    ? props.relative.slice(props.relative.lastIndexOf('/') + 1)
    : props.relative
  const parent = props.relative.includes('/')
    ? props.relative.slice(0, props.relative.lastIndexOf('/'))
    : '工作区'

  return (
    <div className="border-border flex h-9 shrink-0 items-center gap-1 border-b px-1.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="返回变更列表"
        title="返回变更列表"
        className="size-7"
        onClick={props.onBack}>
        <Icon
          icon="lucide:chevron-left"
          className="size-3.5"
        />
      </Button>
      <Icon
        icon="lucide:git-compare"
        className="text-muted-foreground size-3.5 shrink-0"
      />
      <span
        className="text-foreground min-w-0 flex-1 truncate text-xs font-medium"
        title={props.relative}>
        {fileName}
      </span>
      <span
        className="text-muted-foreground hidden max-w-[42%] truncate text-[10px] sm:inline"
        title={props.relative}>
        {parent}
      </span>
      <span className="text-muted-foreground shrink-0 text-[10px]">
        {props.isHunks ? 'hunks' : 'HEAD ↔ 工作区'}
      </span>
    </div>
  )
}

function AsideDiff(props: AsideDiffProps) {
  const data = useAsideDiffData(props.rootPath, props.relative)
  const { hostRef, showSide } = useAsideDiffEditor(props.relative, data.side)
  const isHunks = data.meta?.mode === 'hunks'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AsideDiffHeader
        relative={props.relative}
        isHunks={isHunks}
        onBack={props.onBack}
      />
      <AsideDiffViewport
        hostRef={hostRef}
        showSide={showSide}
        isPending={data.isPending}
        isHunks={isHunks}
        meta={data.meta}
        error={data.error}
        hunks={data.hunks}
        hunkTotal={data.hunkTotal}
        isHunksLoading={data.isHunksLoading}
        onMoreHunks={function () {
          void data.onMoreHunks()
        }}
      />
    </div>
  )
}

export { AsideDiff }
