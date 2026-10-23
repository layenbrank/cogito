import { Icon } from '@iconify/react/offline'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { useState } from 'react'

import { useChangePatch, useSessionChanges, useUndoChanges } from '@/features/agent/changes.ts'
import type { ChangeEntry } from '@/shared/ipc/specs/workspace.ts'
import { AsideCard, AsideHint } from './aside-ui.tsx'
import { DiffView } from './diff-view.tsx'

/**
 * 变更段 —— 本会话改了哪些文件、每个文件差在哪、以及逐文件 / 整体撤销。
 *
 * 数据来自 opencode 的 `session.diff`（不是 git status：agent 也可能改到工作区外的临时文件，
 * 而 git 看不到未跟踪之外的差异）。文件清单只在右栏画一次，消息流里的汇总卡只说数量。
 *
 * diff 正文**点开才拉**（`useChangePatch` 的 `enabled`）：清单是 1.2s 一轮的轮询，
 * 把每个文件的 patch 塞进清单等于每轮都白搬一遍几万字符。
 */

interface ChangeRowProps {
  sessionID: string | null
  entry: ChangeEntry
  isUndoing: boolean
  onUndo: () => void
}

function ChangeRow(props: ChangeRowProps) {
  const { entry } = props
  const [isOpen, updateOpen] = useState(false)
  const patch = useChangePatch(props.sessionID, entry.id, isOpen)

  return (
    <li className="flex flex-col">
      <div className="hover:bg-muted/30 flex items-center gap-1 rounded py-1 text-xs">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground shrink-0"
          aria-label={isOpen ? `收起 ${entry.path} 的差异` : `查看 ${entry.path} 的差异`}
          title={isOpen ? '收起差异' : '查看差异'}
          onClick={function () {
            updateOpen(!isOpen)
          }}>
          <Icon icon="lucide:chevron-right"
            data-open={isOpen ? 'true' : 'false'}
            className="transition-transform data-[open=true]:rotate-90" />
        </Button>
        <Icon icon="lucide:file-pen-line" className="text-muted-foreground size-3.5 shrink-0" />
        <span
          className={
            entry.undone
              ? 'text-muted-foreground min-w-0 flex-1 truncate font-mono line-through'
              : 'min-w-0 flex-1 truncate font-mono'
          }
          title={entry.path}>
          {entry.path}
        </span>
        <span className="text-success shrink-0">+{entry.added}</span>
        <span className="text-destructive shrink-0">−{entry.removed}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={entry.undone ? `${entry.path} 已撤销` : `撤销 ${entry.path}`}
          title={entry.undone ? '已撤销' : '撤销这个文件'}
          disabled={entry.undone || props.isUndoing}
          onClick={props.onUndo}>
          <Icon icon="lucide:rotate-ccw" />
        </Button>
      </div>

      {isOpen ? (
        <div className="ps-6 pb-1.5">
          {patch.isPending ? (
            <AsideHint>读取差异…</AsideHint>
          ) : patch.isError ? (
            <div className="flex items-center justify-between gap-2">
              <AsideHint>差异读取失败。</AsideHint>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={function () {
                  void patch.refetch()
                }}>
                重试
              </Button>
            </div>
          ) : (
            <DiffView patch={patch.data?.patch ?? ''} />
          )}
        </div>
      ) : null}
    </li>
  )
}

export function AsideChanges(props: { sessionID: string | null; isRunning: boolean }) {
  const { sessionID, isRunning } = props
  const changes = useSessionChanges(sessionID, isRunning)
  const undo = useUndoChanges(sessionID)

  const entries = changes.data?.entries ?? []
  const added = changes.data?.added ?? 0
  const removed = changes.data?.removed ?? 0

  return (
    <AsideCard
      id="changes"
      label="变更"
      count={entries.length}
      action={
        entries.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={undo.isPending}
            onClick={function () {
              undo.mutate(undefined)
            }}>
            <Icon icon="lucide:rotate-ccw" className="size-3" />
            全部撤销
          </Button>
        ) : null
      }>
      {sessionID === null ? (
        <AsideHint>会话落库后可以查看文件变更。</AsideHint>
      ) : changes.isPending ? (
        <AsideHint>读取中…</AsideHint>
      ) : changes.isError ? (
        <div className="flex items-center justify-between gap-2">
          <AsideHint>变更读取失败。</AsideHint>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={function () {
              void changes.refetch()
            }}>
            重试
          </Button>
        </div>
      ) : entries.length === 0 ? (
        <AsideHint>本次会话还没有改动文件。</AsideHint>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-success/40 text-success">
              +{added}
            </Badge>
            <Badge
              variant="outline"
              className="border-destructive/40 text-destructive">
              −{removed}
            </Badge>
            <span className="text-muted-foreground text-xs">共 {entries.length} 个文件</span>
          </div>

          <ul className="flex flex-col">
            {entries.map(function (entry) {
              return (
                <ChangeRow
                  key={entry.id}
                  sessionID={sessionID}
                  entry={entry}
                  isUndoing={undo.isPending}
                  onUndo={function () {
                    undo.mutate(entry.id)
                  }}
                />
              )
            })}
          </ul>

          <AsideHint>撤销只还原这些文件，命令与网络请求等外部副作用不受影响。</AsideHint>
        </>
      )}
    </AsideCard>
  )
}
