/**
 * 审阅列表：五段 + 提交框。
 *
 * 1. 待拉取 —— 上游有、本地没有的文件（拉取会改这些）
 * 2. 待推送 —— 本地有、上游没有的文件（推送会发这些）
 * 3. 暂存的更改（HEAD ↔ 暂存区）
 * 4. 更改（暂存区 ↔ 工作区）
 * 5. 未跟踪 —— 新文件；会话里工具写过但 git 还没感知的路径单列在下
 *
 * 3/4/5 直接复用源码管理面板的 `Changes`（行内暂存 / 取消暂存 / 撤销 / 右键菜单），
 * 提交走同一个 `CommitBar`。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@cogito/design/components/collapsible'
import { Textarea } from '@cogito/design/components/textarea'
import { cn } from 'cn'
import { useState } from 'react'

import type { DiffRevs, ShowFile, StatusEntry, UpstreamResult } from '@/lib/workspace-git'
import { AgentLoading } from '@/views/agent/chat/components/agent-loading'
import { Changes, type GroupKind } from '@/views/code/workspace/scm/changes.tsx'
import { CommitBar } from '@/views/code/workspace/scm/commit-bar.tsx'
import {
  findReviewBaseName,
  findReviewParentLabel,
  type ReviewRows
} from '@/views/agent/chat/components/aside-review-rows'

interface ReviewSelection {
  relative: string
  /** 对比口径；缺省 = HEAD ↔ 工作区 */
  revs?: DiffRevs
  /** 差异标题上的说明 */
  label?: string
}

interface AsideReviewListProps {
  upstream: UpstreamResult | null
  isRepo: boolean
  isPending: boolean
  error: string | null
  rows: ReviewRows
  onSelect: (selection: ReviewSelection) => void
  onOpenFile: (relative: string) => void
  onStage: (paths: string[]) => void
  onUnstage: (paths: string[]) => void
  onDiscard: (paths: string[], isUntracked: boolean) => void
  /** 返回是否提交成功（成功才清空输入框） */
  onCommit: (message: string, isStageAll: boolean) => Promise<boolean>
}

const BADGE_STYLE: Record<string, string> = {
  M: 'text-amber-600 dark:text-amber-400',
  A: 'text-emerald-600 dark:text-emerald-400',
  D: 'text-destructive',
  R: 'text-primary',
  C: 'text-primary',
  T: 'text-amber-600 dark:text-amber-400',
  U: 'text-destructive'
}

function statusLetter(raw: string): string {
  return raw.slice(0, 1).toUpperCase() || 'M'
}

function RemoteSection(props: {
  title: string
  hint: string
  icon: string
  files: ShowFile[]
  isTruncated: boolean
  onOpen: (file: ShowFile) => void
}) {
  const [isOpen, updateOpen] = useState(true)
  if (props.files.length === 0) return null

  const isPull = props.title.includes('拉取')
  return (
    <Collapsible
      open={isOpen}
      onOpenChange={updateOpen}
      className={cn(
        'border-b',
        isPull
          ? 'border-sky-500/30 bg-sky-500/5'
          : 'border-amber-500/30 bg-amber-500/5'
      )}>
      <div className="hover:bg-muted/40 flex h-8 items-center gap-0.5 px-1 text-[13px] font-medium">
        <CollapsibleTrigger className="hover:text-foreground flex min-w-0 flex-1 items-center gap-1 rounded-sm px-2 py-0.5 text-left outline-none">
          <Icon
            icon="lucide:chevron-right"
            className={cn(
              'size-3.5 shrink-0 transition-transform duration-150',
              isOpen && 'rotate-90'
            )}
          />
          <Icon
            icon={props.icon}
            className={cn(
              'size-3.5 shrink-0',
              isPull ? 'text-sky-600 dark:text-sky-400' : 'text-amber-600 dark:text-amber-400'
            )}
          />
          <span
            className={cn(
              'truncate',
              isPull ? 'text-sky-800 dark:text-sky-200' : 'text-amber-800 dark:text-amber-200'
            )}>
            {props.title}
          </span>
          <span
            className={cn(
              'ml-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums',
              isPull
                ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
            )}>
            {props.files.length}
          </span>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <ul className="list-none">
          {props.files.map(function (file) {
            const parent = findReviewParentLabel(file.path)
            const letter = statusLetter(file.status)
            return (
              <li key={`${props.title}:${file.path}`}>
                <button
                  type="button"
                  title={`${file.path}（${props.hint}）`}
                  onClick={function () {
                    props.onOpen(file)
                  }}
                  className="hover:bg-muted/60 flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors">
                  <span className="text-foreground min-w-0 flex-1 truncate text-[13px] leading-snug">
                    {findReviewBaseName(file.path)}
                  </span>
                  {parent ? (
                    <span className="text-muted-foreground min-w-0 truncate text-xs opacity-70">
                      {parent}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      'ml-auto w-4 shrink-0 text-center font-mono text-xs font-semibold',
                      BADGE_STYLE[letter] ?? 'text-muted-foreground'
                    )}>
                    {letter}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        {props.isTruncated ? (
          <p className="text-muted-foreground px-3 pb-1.5 text-[11px]">文件过多，仅显示前 200 个</p>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  )
}

function ToolPaths(props: { paths: string[]; onOpen: (relative: string) => void }) {
  const [isOpen, updateOpen] = useState(true)
  if (props.paths.length === 0) return null

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={updateOpen}
      className="border-border/60 border-b">
      <div className="text-muted-foreground hover:bg-muted/50 flex h-8 items-center gap-0.5 px-1 text-[13px] font-medium">
        <CollapsibleTrigger className="hover:text-foreground flex min-w-0 flex-1 items-center gap-1 rounded-sm px-2 py-0.5 text-left outline-none">
          <Icon
            icon="lucide:chevron-right"
            className={cn(
              'size-3.5 shrink-0 transition-transform duration-150',
              isOpen && 'rotate-90'
            )}
          />
          <Icon
            icon="lucide:bot"
            className="size-3.5 shrink-0 opacity-70"
          />
          <span className="truncate">本会话改动</span>
          <span className="bg-muted text-muted-foreground ml-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums">
            {props.paths.length}
          </span>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <ul className="list-none">
          {props.paths.map(function (path) {
            const parent = findReviewParentLabel(path)
            return (
              <li key={`tool:${path}`}>
                <button
                  type="button"
                  title={`${path}（与 HEAD 对比）`}
                  onClick={function () {
                    props.onOpen(path)
                  }}
                  className="hover:bg-muted/60 flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors">
                  <span className="text-foreground min-w-0 flex-1 truncate text-[13px] leading-snug">
                    {findReviewBaseName(path)}
                  </span>
                  {parent ? (
                    <span className="text-muted-foreground min-w-0 truncate text-xs opacity-70">
                      {parent}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">会话</span>
                </button>
              </li>
            )
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

function AsideReviewList(props: AsideReviewListProps) {
  const [message, updateMessage] = useState('')
  const [isCommitting, updateCommitting] = useState(false)

  const upstream = props.upstream
  const hasRevs = Boolean(upstream?.headOid && upstream?.upstreamOid)
  const upstreamName = upstream?.upstream ?? '上游'
  const stagedCount = props.rows.staged.length
  const hasMessage = message.trim().length > 0

  const groups: { kind: GroupKind; title: string; entries: StatusEntry[] }[] = [
    { kind: 'staged', title: '暂存的更改', entries: props.rows.staged },
    { kind: 'changed', title: '更改（未暂存）', entries: props.rows.changed },
    { kind: 'untracked', title: '未跟踪', entries: props.rows.untracked }
  ]

  async function commit(isStageAll: boolean) {
    if (isCommitting) return
    updateCommitting(true)
    try {
      const ok = await props.onCommit(message.trim(), isStageAll)
      if (ok) updateMessage('')
    } finally {
      updateCommitting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {props.isPending && props.rows.total === 0 ? (
          <div className="p-3">
            <AgentLoading label="正在读取工作区状态" />
          </div>
        ) : null}

        {props.error ? <p className="text-destructive p-3 text-xs">{props.error}</p> : null}

        {!props.isRepo && !props.error ? (
          <p className="text-muted-foreground p-3 text-xs">
            当前文件夹不是 Git 仓库。下方「本会话改动」仍可打开与 HEAD 的对比。
          </p>
        ) : null}

        {props.isRepo && hasRevs && upstream ? (
          <>
            <RemoteSection
              title="待拉取"
              hint={`拉取后本地会变成 ${upstreamName} 的样子`}
              icon="lucide:arrow-down-to-line"
              files={upstream.behindFiles}
              isTruncated={upstream.behindTruncated}
              onOpen={function (file) {
                props.onSelect({
                  relative: file.path,
                  revs: { oldOid: upstream.headOid ?? '', newOid: upstream.upstreamOid ?? '' },
                  label: `HEAD ↔ ${upstreamName}`
                })
              }}
            />
            <RemoteSection
              title="待推送"
              hint={`推送后 ${upstreamName} 会收到这些改动`}
              icon="lucide:arrow-up-from-line"
              files={upstream.aheadFiles}
              isTruncated={upstream.aheadTruncated}
              onOpen={function (file) {
                props.onSelect({
                  relative: file.path,
                  revs: { oldOid: upstream.upstreamOid ?? '', newOid: upstream.headOid ?? '' },
                  label: `${upstreamName} ↔ HEAD`
                })
              }}
            />
          </>
        ) : null}

        {props.isRepo && (props.rows.changed.length > 0 || props.rows.untracked.length > 0 || stagedCount > 0) ? (
          <div className="border-border/60 flex items-center gap-1.5 border-b px-2 py-1.5">
            <span className="text-muted-foreground text-xs">改动</span>
            <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-[11px] tabular-nums">
              {props.rows.total}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {props.rows.changed.length + props.rows.untracked.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground hover:text-foreground h-6 gap-1 px-1.5 text-xs"
                  title="把全部未暂存改动加入暂存区"
                  onClick={function () {
                    props.onStage(
                      [...props.rows.changed, ...props.rows.untracked].map(function (entry) {
                        return entry.path
                      })
                    )
                  }}>
                  <Icon
                    icon="lucide:plus"
                    className="size-3"
                  />
                  全部暂存
                </Button>
              ) : null}
              {stagedCount > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground hover:text-foreground h-6 gap-1 px-1.5 text-xs"
                  title="把暂存区全部退回未暂存"
                  onClick={function () {
                    props.onUnstage(
                      props.rows.staged.map(function (entry) {
                        return entry.path
                      })
                    )
                  }}>
                  <Icon
                    icon="lucide:minus"
                    className="size-3"
                  />
                  全部取消暂存
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <Changes
          groups={groups}
          onOpenDiff={function (relative, kind) {
            props.onSelect({
              relative,
              revs:
                kind === 'staged'
                  ? { side: 'staged' }
                  : kind === 'changed'
                    ? { side: 'unstaged' }
                    : undefined
            })
          }}
          onOpenFile={props.onOpenFile}
          onStage={props.onStage}
          onUnstage={props.onUnstage}
          onDiscard={props.onDiscard}
        />

        <ToolPaths
          paths={props.rows.toolPaths}
          onOpen={function (relative) {
            props.onSelect({ relative })
          }}
        />

        {!props.isPending &&
        !props.error &&
        props.rows.total === 0 &&
        props.rows.toolPaths.length === 0 &&
        (upstream?.behindFiles.length ?? 0) === 0 &&
        (upstream?.aheadFiles.length ?? 0) === 0 ? (
          <p className="text-muted-foreground p-3 text-xs">
            {props.isRepo ? '工作区干净，与上游没有差异' : '没有可对比的改动'}
          </p>
        ) : null}
      </div>

      {props.isRepo ? (
        <div className="border-border flex shrink-0 flex-col gap-1.5 border-t p-2">
          <Textarea
            value={message}
            placeholder="提交说明（提交暂存的更改）"
            aria-label="提交说明"
            rows={2}
            className="max-h-24 min-h-14 resize-none overflow-y-auto text-sm"
            onChange={function (event) {
              updateMessage(event.target.value)
            }}
          />
          <CommitBar
            canCommitStaged={hasMessage && stagedCount > 0}
            canCommitAll={hasMessage && props.rows.total > 0}
            onCommitStaged={function () {
              void commit(false)
            }}
            onCommitAll={function () {
              void commit(true)
            }}
          />
        </div>
      ) : null}
    </div>
  )
}

export { AsideReviewList }
export type { ReviewSelection }
