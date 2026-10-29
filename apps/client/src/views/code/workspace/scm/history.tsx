/**
 * SCM 侧栏「提交」线性历史（二期）：最近提交列表，点选打开提交页并聚焦。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@cogito/design/components/collapsible'
import { cn } from 'cn'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import type { CommitHit } from '@/lib/workspace-git'
import { useCodeGitStore } from '@/stores/code-git'
import { useCodeStore } from '@/stores/code'

function formatRelativeTime(unixSeconds: number): string {
  if (!unixSeconds) return ''
  const delta = Math.max(0, Date.now() / 1000 - unixSeconds)
  if (delta < 60) return '刚刚'
  if (delta < 3600) return `${Math.floor(delta / 60)} 分钟前`
  if (delta < 86400) return `${Math.floor(delta / 3600)} 小时前`
  if (delta < 86400 * 30) return `${Math.floor(delta / 86400)} 天前`
  const date = new Date(unixSeconds * 1000)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function HistoryRow(props: {
  hit: CommitHit
  isActive: boolean
  onOpen: (oid: string) => void
  onCopy: (oid: string) => void
}) {
  const { hit, isActive } = props
  return (
    <li className="group/hist relative">
      <button
        type="button"
        aria-current={isActive ? 'true' : undefined}
        title={hit.subject || '(无说明)'}
        className={cn(
          'hover:bg-muted/60 focus-visible:ring-ring flex w-full items-start gap-2 rounded-sm py-2 pr-8 pl-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset',
          isActive && 'bg-accent/50'
        )}
        onClick={function () {
          props.onOpen(hit.oid)
        }}>
        <Icon
          icon={hit.isHead ? 'lucide:home' : 'lucide:git-commit-horizontal'}
          className={cn(
            'mt-0.5 size-4 shrink-0',
            hit.isHead ? 'text-primary' : 'text-muted-foreground'
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="text-foreground line-clamp-1 text-sm leading-5 font-medium">
            {hit.subject || '(无说明)'}
          </span>
          <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs leading-4">
            <span className="truncate">{hit.authorName}</span>
            <span className="opacity-40">·</span>
            <span className="shrink-0">{formatRelativeTime(hit.committedAt)}</span>
            <span className="text-foreground/70 ml-auto shrink-0 font-mono text-xs tabular-nums">
              {hit.short}
            </span>
          </span>
        </span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="复制完整 SHA"
        title="复制完整 SHA"
        className="text-muted-foreground absolute top-1.5 right-1 size-7 opacity-0 group-hover/hist:opacity-100"
        onClick={function (event) {
          event.stopPropagation()
          props.onCopy(hit.oid)
        }}>
        <Icon
          icon="lucide:copy"
          className="size-3.5"
        />
      </Button>
    </li>
  )
}

function ScmHistory() {
  const recentHits = useCodeGitStore(function (state) {
    return state.recentHits
  })
  const isRecentLoading = useCodeGitStore(function (state) {
    return state.isRecentLoading
  })
  const selectedOid = useCodeGitStore(function (state) {
    return state.selectedOid
  })
  const isRepo = useCodeGitStore(function (state) {
    return state.isRepo
  })
  const [isOpen, updateOpen] = useState(true)

  useEffect(
    function () {
      if (!isRepo) return
      if (useCodeGitStore.getState().recentHits.length > 0) return
      void useCodeGitStore.getState().toLoadRecentCommits()
    },
    [isRepo]
  )

  function onOpen(oid: string) {
    useCodeStore.getState().toOpenCommitsTab()
    void useCodeGitStore.getState().toFocusCommit(oid)
  }

  function onCopy(oid: string) {
    void navigator.clipboard.writeText(oid).then(
      function () {
        toast.success('已复制 SHA')
      },
      function (error) {
        console.error('[code] copy sha failed', error)
        toast.error('复制失败')
      }
    )
  }

  if (!isRepo) return null

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={updateOpen}
      className="flex min-h-0 flex-col">
      <div className="group/header text-muted-foreground hover:bg-muted/60 flex h-7 shrink-0 items-center gap-0.5 px-1 text-xs font-medium">
        <CollapsibleTrigger className="hover:text-foreground flex min-w-0 flex-1 items-center gap-1 rounded-sm px-2 py-0.5 text-left outline-none">
          <Icon
            icon="lucide:chevron-right"
            className={cn(
              'size-3.5 shrink-0 transition-transform duration-150',
              isOpen && 'rotate-90'
            )}
          />
          <span className="truncate">提交</span>
          {recentHits.length > 0 ? (
            <span className="bg-muted text-muted-foreground ml-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums">
              {recentHits.length}
            </span>
          ) : null}
          {isRecentLoading ? (
            <Icon
              icon="lucide:loader-circle"
              className="ml-1 size-3.5 animate-spin opacity-60"
            />
          ) : null}
        </CollapsibleTrigger>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="在标签页中搜索提交"
          title="搜索提交"
          className="text-muted-foreground size-6 shrink-0 opacity-0 group-hover/header:opacity-100"
          onClick={function () {
            useCodeStore.getState().toOpenCommitsTab()
          }}>
          <Icon
            icon="lucide:search"
            className="size-3.5"
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="刷新提交列表"
          title="刷新"
          className="text-muted-foreground mr-1 size-6 shrink-0 opacity-0 group-hover/header:opacity-100"
          disabled={isRecentLoading}
          onClick={function () {
            void useCodeGitStore.getState().toLoadRecentCommits()
          }}>
          <Icon
            icon="lucide:refresh-cw"
            className={cn('size-3.5', isRecentLoading && 'animate-spin')}
          />
        </Button>
      </div>
      <CollapsibleContent>
        <div className="max-h-52 overflow-y-auto">
          {recentHits.length === 0 && !isRecentLoading ? (
            <p className="text-muted-foreground px-3 py-2 text-xs">暂无提交记录</p>
          ) : (
            <ul className="list-none pb-1">
              {recentHits.map(function (hit) {
                return (
                  <HistoryRow
                    key={hit.oid}
                    hit={hit}
                    isActive={hit.oid === selectedOid}
                    onOpen={onOpen}
                    onCopy={onCopy}
                  />
                )
              })}
            </ul>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export { ScmHistory }
