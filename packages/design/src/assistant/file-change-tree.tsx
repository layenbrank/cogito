/**
 * File tree（对齐 assistant-ui `elements/file-tree`）
 *
 * 「这一轮动过哪些文件」按目录收成一张小卡：表头 `4 files changed` + 净增删 `+78 −9`，
 * 下面一行一个文件，缩进在目录表头底下，每行自带 `+24 −6`。
 *
 * 与元素页对齐的三处行为（都是写的时候容易做错的）：
 * - 目录表头是**静态的**：不是真父节点、不可折叠、点不动，只用来给下面几行一个归属；
 * - 表头只数 `kind: 'file'` 的行，目录不算「文件」；净增删**永远渲染**，哪怕是 `+0 −0`；
 * - 某个文件缺 `additions` / `deletions` 或为 0 时，那一半**不显示**，不是显示 0。
 *
 * 名称说明：本仓 `file-tree.tsx` 是另一套东西（目录列举的交互树：可折叠、可选中的
 * `FileTree` / `FileTreeFolder` / `FileTreeFile`，用在工具明细里）。这里是「改动文件树」，
 * 数据是扁平的增删列表，没有交互，所以另起一个模块，别混用。
 *
 * 元素本体是收费产物，结构与行为按官网渲染出的 DOM 自写；字号走本仓档位
 * （正文 `text-sm`、增删走 `mono` 即 `text-xs`），不照搬元素页的 13.5px / 11px。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useMemo } from 'react'

import { rowEnter, mono } from './elements/surfaces'
import {
  formatChangedFilesLabel,
  resolveVisibleRows,
  summarizeChangeNodes,
  type FileChangeNode
} from './file-change-tree-state'
import { useAssistantLabels } from './labels'

/** 每档缩进（元素页的 `depth × 0.85rem`） */
const INDENT_REM = 0.85

interface FileChangeTreeProps {
  /** 树行：目录表头 + 文件行，顺序即渲染顺序（`buildChangeNodes` 生成） */
  nodes: readonly FileChangeNode[]
  /** 露出前几行（默认全出）；向下取整并钳进 `0…nodes.length`，用于渐进揭示 */
  visibleCount?: number
  /** 净增删；不传则按 `nodes` 现算（目录行不计） */
  totalAdditions?: number
  totalDeletions?: number
  /** 跳过入场动画（一次铺开几十行时用） */
  instant?: boolean
  className?: string
}

/** 文件行右侧的 `+N −M`：缺一半就不写，不补 0 */
function Churn(props: { additions?: number; deletions?: number }) {
  const additions = props.additions ?? 0
  const deletions = props.deletions ?? 0
  if (additions <= 0 && deletions <= 0) return null
  return (
    <span data-slot="file-change-tree-churn" className={cn(mono, 'shrink-0 tabular-nums')}>
      {additions > 0 ? <span className="text-success">+{additions}</span> : null}
      {additions > 0 && deletions > 0 ? ' ' : null}
      {deletions > 0 ? <span className="text-destructive">−{deletions}</span> : null}
    </span>
  )
}

function FileChangeTree({
  nodes,
  visibleCount,
  totalAdditions,
  totalDeletions,
  instant = false,
  className
}: FileChangeTreeProps) {
  const labels = useAssistantLabels()
  const summary = useMemo(
    function () {
      return summarizeChangeNodes(nodes)
    },
    [nodes]
  )
  const visible = resolveVisibleRows(visibleCount, nodes.length)
  const shown = nodes.slice(0, visible)
  const added = totalAdditions ?? summary.additions
  const removed = totalDeletions ?? summary.deletions

  return (
    <div
      data-slot="file-change-tree"
      className={cn(
        'border-border/60 bg-background dark:bg-popover flex w-full max-w-sm flex-col gap-2 rounded-2xl border p-3.5',
        className
      )}>
      <div data-slot="file-change-tree-header" className="flex items-baseline justify-between px-1">
        <span className="text-sm font-medium">{formatChangedFilesLabel(summary.files, labels)}</span>
        {/* 净增删永远渲染：表头是「一共改了多少」，没有改动时写 +0 −0 也比空白诚实 */}
        <span data-slot="file-change-tree-totals" className={cn(mono, 'tabular-nums')}>
          <span className="text-success">+{added}</span>{' '}
          <span className="text-destructive">−{removed}</span>
        </span>
      </div>

      <div className="flex flex-col">
        {shown.map(function (node) {
          const isFolder = node.kind === 'folder'
          return (
            <div
              key={`${node.kind}:${node.path}`}
              data-slot="file-change-tree-row"
              data-kind={node.kind}
              data-depth={node.depth}
              // 缩进用 padding-inline-start（不是 margin-left）：RTL 下自动翻边
              style={{ paddingInlineStart: `${node.depth * INDENT_REM}rem` }}
              className={cn(
                'hover:bg-foreground/[0.03] flex items-center gap-2 rounded-lg px-1 py-1 text-sm transition-colors',
                !instant && rowEnter
              )}>
              {isFolder ? (
                <>
                  <Icon
                    icon="lucide:chevron-down"
                    aria-hidden
                    className="text-muted-foreground size-3 shrink-0"
                  />
                  <Icon
                    icon="lucide:folder"
                    aria-hidden
                    className="text-muted-foreground size-3.5 shrink-0"
                  />
                  <span className="text-muted-foreground min-w-0 flex-1 truncate">{node.name}</span>
                </>
              ) : (
                <>
                  <Icon
                    icon="lucide:file"
                    aria-hidden
                    className="text-muted-foreground ms-3 size-3.5 shrink-0"
                  />
                  <span className="text-foreground/85 min-w-0 flex-1 truncate" title={node.path}>
                    {node.name}
                  </span>
                  <Churn additions={node.additions} deletions={node.deletions} />
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { FileChangeTree }
export type { FileChangeTreeProps, FileChangeNode }
