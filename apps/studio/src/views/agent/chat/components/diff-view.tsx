import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { useMemo, useState } from 'react'

import { DIFF_PREVIEW_LIMIT, toDiffPreview } from './diff-lines.ts'
import type { DiffFile, DiffLine } from './diff-lines.ts'

/**
 * unified diff 的展示件：双行号 + 绿/红/灰行。
 *
 * 刻意不引第三方 diff 组件：这里只需要「能看清改了什么」，
 * 排版与配色跟着右栏走反而更统一，也少一份依赖要跟着 React 大版本升。
 *
 * 横向不折行（`whitespace-pre` + 横向滚动）：折行会把缩进弄乱，代码看不成样子。
 */

/** 展开后不再裁剪 */
const ALL_LINES = Number.MAX_SAFE_INTEGER

const LINE_CLASSES: Readonly<Record<DiffLine['kind'], string>> = {
  add: 'bg-success/10 text-success',
  remove: 'bg-destructive/10 text-destructive',
  context: 'text-foreground'
}

const MARKERS: Readonly<Record<DiffLine['kind'], string>> = {
  add: '+',
  remove: '-',
  context: ' '
}

function DiffRow(props: { line: DiffLine }) {
  const { line } = props

  return (
    <div
      className={`flex w-max min-w-full font-mono text-xs leading-relaxed ${LINE_CLASSES[line.kind]}`}>
      <span className="text-muted-foreground w-8 shrink-0 select-none pe-1.5 text-end">
        {line.oldLine ?? ''}
      </span>
      <span className="text-muted-foreground w-8 shrink-0 select-none pe-1.5 text-end">
        {line.newLine ?? ''}
      </span>
      <span className="w-3.5 shrink-0 select-none text-center">{MARKERS[line.kind]}</span>
      <span className="pe-2 whitespace-pre">{line.text}</span>
    </div>
  )
}

function DiffFileSection(props: { file: DiffFile }) {
  const { file } = props

  return (
    <div className="border-border/60 flex flex-col border-b last:border-b-0">
      <div className="bg-muted/40 flex items-center gap-2 px-2 py-1">
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs font-medium"
          title={file.path}>
          {file.path}
        </span>
        <span className="text-success shrink-0 text-xs">+{file.added}</span>
        <span className="text-destructive shrink-0 text-xs">−{file.removed}</span>
      </div>

      {file.hunks.map(function (hunk) {
        return (
          <div key={hunk.header}>
            <div className="text-muted-foreground bg-muted/20 px-2 py-0.5 font-mono text-xs">
              {hunk.header}
            </div>
            {hunk.lines.map(function (line, index) {
              // diff 里同一行内容会重复出现（上下文行尤其多），只靠内容做 key 会串行
              return (
                <DiffRow
                  key={`${hunk.header}-${index}`}
                  line={line}
                />
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/** `patch` → 预览。传空串（例如变更已被撤销）时给一句说明而不是一片空白 */
export function DiffView(props: { patch: string }) {
  const [isFull, updateFull] = useState(false)
  const preview = useMemo(
    function () {
      return toDiffPreview(props.patch, isFull ? ALL_LINES : DIFF_PREVIEW_LIMIT)
    },
    [props.patch, isFull]
  )

  if (preview.files.length === 0) {
    return <p className="text-muted-foreground px-2 py-1 text-xs">没有可展示的差异。</p>
  }

  return (
    <div className="border-border/70 overflow-hidden rounded-md border">
      <div className="max-h-96 overflow-auto">
        {preview.files.map(function (file) {
          return (
            <DiffFileSection
              key={file.path}
              file={file}
            />
          )
        })}
      </div>

      {preview.hidden > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-muted-foreground w-full rounded-none border-t"
          onClick={function () {
            updateFull(true)
          }}>
          <Icon icon="lucide:chevron-down" className="size-3" />
          展开剩余 {preview.hidden} 行
        </Button>
      ) : null}
    </div>
  )
}
