/**
 * 右栏内联 Diff：默认 HEAD ↔ 工作区；可传入 revs 看某次提交。
 * 小文件 Monaco inline；大重写走 hunks 列表，禁止 DiffEditor LCS。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'

import '@/lib/monaco-environment.ts'
import type { DiffRevs } from '@/lib/workspace-git'
import { useAsideDiffData } from '@/views/agent/chat/components/aside-diff-data'
import { useAsideDiffEditor } from '@/views/agent/chat/components/aside-diff-editor'
import { AsideDiffViewport } from '@/views/agent/chat/components/aside-diff-viewport'

interface AsideDiffProps {
  rootPath: string
  relative: string
  onBack: () => void
  /** 缺省 = 工作区相对 HEAD；提交历史传 parent ↔ oid */
  revs?: DiffRevs | null
  /** 顶栏右侧对照说明，如 `a1b2c3d ↔ e4f5g6h` */
  compareLabel?: string
}

function AsideDiffHeader(props: {
  relative: string
  isHunks: boolean
  compareLabel: string
  onBack: () => void
}) {
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
        aria-label="返回列表"
        title="返回列表"
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
        className="text-muted-foreground hidden max-w-[42%] truncate text-xs sm:inline"
        title={props.relative}>
        {parent}
      </span>
      <span className="text-muted-foreground shrink-0 text-xs">
        {props.isHunks ? 'hunks' : props.compareLabel}
      </span>
    </div>
  )
}

function AsideDiff(props: AsideDiffProps) {
  const data = useAsideDiffData(props.rootPath, props.relative, props.revs)
  const { hostRef, showSide } = useAsideDiffEditor(props.relative, data.side)
  const isHunks = data.meta?.mode === 'hunks'
  const compareLabel = props.compareLabel ?? 'HEAD ↔ 工作区'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AsideDiffHeader
        relative={props.relative}
        isHunks={isHunks}
        compareLabel={compareLabel}
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
export type { AsideDiffProps }
