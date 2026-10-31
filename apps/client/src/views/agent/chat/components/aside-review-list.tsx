import { Icon } from '@iconify/react/offline'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'

import type { ReviewRow } from '@/views/agent/chat/components/aside-review-rows'
import { findReviewBaseName, findReviewParentLabel } from '@/views/agent/chat/components/aside-review-rows'

const BADGE_STYLE: Record<string, string> = {
  M: 'text-amber-600 dark:text-amber-400',
  A: 'text-emerald-600 dark:text-emerald-400',
  D: 'text-destructive',
  R: 'text-primary',
  C: 'text-primary',
  T: 'text-amber-600 dark:text-amber-400',
  U: 'text-destructive',
  '?': 'text-muted-foreground'
}

function AsideReviewList(props: {
  rows: ReviewRow[]
  isPending: boolean
  error: string | null
  isRepo: boolean
  onRefresh: () => void
  onSelect: (path: string) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
          <Icon
            icon="lucide:git-compare"
            className="size-3.5 shrink-0"
          />
          <span className="truncate">未提交变更</span>
          {props.rows.length > 0 ? (
            <Badge
              variant="secondary"
              className="h-5 px-1.5 text-[10px]">
              {props.rows.length}
            </Badge>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="刷新变更"
          title="刷新"
          className="size-6"
          disabled={props.isPending}
          onClick={props.onRefresh}>
          <Icon
            icon="lucide:refresh-cw"
            className={clsx('size-3.5', props.isPending && 'animate-spin')}
          />
        </Button>
      </div>

      {props.isPending && props.rows.length === 0 ? (
        <p className="text-muted-foreground flex items-center gap-1.5 p-3 text-xs">
          <Icon
            icon="lucide:loader-circle"
            className="size-3.5 animate-spin"
          />
          读取中…
        </p>
      ) : null}

      {props.error ? <p className="text-destructive p-3 text-xs">{props.error}</p> : null}

      {!props.isPending && !props.error && !props.isRepo ? (
        <p className="text-muted-foreground p-3 text-xs">
          当前工作区不是 Git 仓库。仍可从下方「本会话改动」打开文件对比。
        </p>
      ) : null}

      {!props.isPending && !props.error && props.isRepo && props.rows.length === 0 ? (
        <p className="text-muted-foreground p-3 text-xs">暂无未提交变更</p>
      ) : null}

      {props.rows.length > 0 ? (
        <ul className="flex flex-col gap-0.5 p-1.5">
          {props.rows.map(function (row) {
            const parent = findReviewParentLabel(row.path)
            return (
              <li key={row.path}>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start gap-1.5 px-2 py-1.5 text-xs font-normal"
                  onClick={function () {
                    props.onSelect(row.path)
                  }}>
                  <span
                    className={clsx(
                      'w-3 shrink-0 text-center font-mono text-[11px]',
                      row.badge ? BADGE_STYLE[row.badge] : 'text-muted-foreground'
                    )}>
                    {row.badge ?? '·'}
                  </span>
                  <span className="text-foreground min-w-0 truncate">{findReviewBaseName(row.path)}</span>
                  {parent ? (
                    <span className="text-muted-foreground min-w-0 truncate text-[11px] opacity-70">
                      {parent}
                    </span>
                  ) : null}
                  {row.source === 'tool' ? (
                    <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">会话</span>
                  ) : null}
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

export { AsideReviewList }
