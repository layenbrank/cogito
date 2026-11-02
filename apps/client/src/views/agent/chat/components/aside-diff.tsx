/**
 * 右栏内联 Diff：按 revs 决定对比口径（HEAD↔工作区 / HEAD↔暂存区 /
 * 暂存区↔工作区 / 两个提交 / HEAD↔上游）。
 * 小文件 Monaco inline；大重写走 hunks 列表，禁止 DiffEditor LCS。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'

import type { DiffRevs } from '@/lib/workspace-git'
import '@/lib/monaco-environment.ts'
import { useAsideDiffData } from '@/views/agent/chat/components/aside-diff-data'
import { useAsideDiffEditor } from '@/views/agent/chat/components/aside-diff-editor'
import { AsideDiffViewport } from '@/views/agent/chat/components/aside-diff-viewport'

interface AsideDiffProps {
  rootPath: string
  relative: string
  /** 对比口径；缺省 = HEAD ↔ 工作区 */
  revs?: DiffRevs
  /** 覆盖状态栏文案（例如「HEAD ↔ origin/main」） */
  label?: string
  onBack: () => void
}

function shortOid(oid: string | null | undefined): string {
  if (!oid) return '空树'
  return oid.slice(0, 7)
}

/** 无外部 label 时按 revs 推导对比口径文案。 */
function resolveLabel(revs?: DiffRevs, label?: string): string {
  if (label) return label
  if (!revs) return 'HEAD ↔ 工作区'
  const { oldOid, newOid, side } = revs
  const hasOids =
    (oldOid !== null && oldOid !== undefined) || (newOid !== null && newOid !== undefined)
  if (hasOids) {
    return `${shortOid(oldOid)} ↔ ${shortOid(newOid)}`
  }
  if (side === 'staged') return 'HEAD ↔ 暂存区'
  if (side === 'unstaged') return '暂存区 ↔ 工作区'
  return 'HEAD ↔ 工作区'
}

function AsideDiffHeader(props: {
  relative: string
  isHunks: boolean
  label: string
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
        className="text-muted-foreground hidden max-w-[30%] truncate text-[10px] sm:inline"
        title={props.relative}>
        {parent}
      </span>
      <span
        className="text-muted-foreground shrink-0 text-[10px]"
        title={props.label}>
        {props.label}
      </span>
      {props.isHunks ? (
        <span className="text-muted-foreground bg-muted shrink-0 rounded px-1 text-[10px]">
          hunks
        </span>
      ) : null}
    </div>
  )
}

function AsideDiff(props: AsideDiffProps) {
  const data = useAsideDiffData(props.rootPath, props.relative, props.revs)
  const { hostRef, showSide } = useAsideDiffEditor(props.relative, data.side)
  const isHunks = data.meta?.mode === 'hunks'
  const label = resolveLabel(props.revs, props.label)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AsideDiffHeader
        relative={props.relative}
        isHunks={isHunks}
        label={label}
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
