import { useAui } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useCallback } from 'react'
import { toast } from 'sonner'

import { ContextMenu } from '@/components/contextmenu'
import { attachWorkspaceFile } from '@/features/agent/attachment.ts'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import {
  ASIDE_PATH_TRIGGER,
  buildAsidePathMenuItems,
  findAsidePathAttrs,
  toastAttached
} from '@/views/agent/chat/components/aside-path-menu'
import type { ReviewRow } from '@/views/agent/chat/components/aside-review-rows'
import {
  findReviewBaseName,
  findReviewParentLabel
} from '@/views/agent/chat/components/aside-review-rows'
import { CODE_MENU_CLASS_NAMES } from '@/views/code/lib/context-menu.ts'

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
  const aui = useAui()
  const { rootPath } = useActiveWorkspace()

  function attachRelative(relative: string) {
    void attachWorkspaceFile(aui, relative)
      .then(function () {
        toastAttached(relative)
      })
      .catch(function (cause: unknown) {
        toast.error(cause instanceof Error ? cause.message : '引用失败')
      })
  }

  const findPathMenuItems = useCallback(
    function (trigger: Element) {
      if (!rootPath) return []
      const attrs = findAsidePathAttrs(trigger)
      if (!attrs) return []
      return buildAsidePathMenuItems({
        rootPath,
        relative: attrs.relative,
        onAddToComposer: attachRelative
      })
    },
    [rootPath, aui]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain">
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
              className="h-5 px-1.5 text-xs">
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
        <ContextMenu
          trigger={ASIDE_PATH_TRIGGER}
          classNames={CODE_MENU_CLASS_NAMES}
          findItems={findPathMenuItems}>
          <ul className="flex flex-col gap-0.5 p-1.5">
            {props.rows.map(function (row) {
              const parent = findReviewParentLabel(row.path)
              return (
                <li key={row.path}>
                  <Button
                    type="button"
                    variant="ghost"
                    data-aside-path={row.path}
                    data-aside-kind="file"
                    className="h-auto w-full justify-start gap-2 px-2 py-2 text-[13px] font-normal"
                    onClick={function () {
                      props.onSelect(row.path)
                    }}>
                    <span
                      className={clsx(
                        'w-3.5 shrink-0 text-center font-mono text-xs font-semibold',
                        row.badge ? BADGE_STYLE[row.badge] : 'text-muted-foreground'
                      )}>
                      {row.badge ?? '·'}
                    </span>
                    <span className="min-w-0 flex-1 text-start">
                      <span className="text-foreground block truncate leading-snug">
                        {findReviewBaseName(row.path)}
                      </span>
                      {parent ? (
                        <span className="text-muted-foreground block truncate text-xs opacity-70">
                          {parent}
                        </span>
                      ) : null}
                    </span>
                    {row.source === 'tool' ? (
                      <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                        会话
                      </span>
                    ) : null}
                  </Button>
                </li>
              )
            })}
          </ul>
        </ContextMenu>
      ) : null}
    </div>
  )
}

export { AsideReviewList }
