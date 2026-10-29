/**
 * 源码管理的变更列表：分组 + 行内操作 + 右键菜单。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'
import { useCallback } from 'react'

import { ContextMenu, type MenuItem } from '@/components/contextmenu'
import type { StatusEntry } from '@/lib/workspace-git'
import { findStatusBadge } from '@/views/code/lib/git-status.ts'

type GroupKind = 'staged' | 'changed' | 'untracked'

interface ChangesProps {
  groups: { kind: GroupKind; title: string; entries: StatusEntry[] }[]
  onOpenDiff: (relative: string) => void
  onOpenFile: (relative: string) => void
  onStage: (paths: string[]) => void
  onUnstage: (paths: string[]) => void
  onDiscard: (paths: string[], isUntracked: boolean) => void
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

function findParentLabel(relative: string): string {
  const slash = relative.lastIndexOf('/')
  return slash < 0 ? '' : relative.slice(0, slash)
}

function findName(relative: string): string {
  const slash = relative.lastIndexOf('/')
  return slash < 0 ? relative : relative.slice(slash + 1)
}

function RowAction(props: {
  icon: string
  label: string
  isDanger?: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      type="button"
      aria-label={props.label}
      title={props.label}
      className={cn(
        'hover:bg-muted text-muted-foreground flex size-5 items-center justify-center rounded-sm',
        props.isDanger ? 'hover:text-destructive' : 'hover:text-foreground'
      )}
      onClick={props.onClick}>
      <Icon
        icon={props.icon}
        className="size-3"
      />
    </Button>
  )
}

function ChangeRow(props: {
  entry: StatusEntry
  kind: GroupKind
  onOpenDiff: (relative: string) => void
  onOpenFile: (relative: string) => void
  onStage: (paths: string[]) => void
  onUnstage: (paths: string[]) => void
  onDiscard: (paths: string[], isUntracked: boolean) => void
}) {
  const badge = findStatusBadge(props.entry)
  const parent = findParentLabel(props.entry.path)
  const isUntracked = props.kind === 'untracked'
  const isDeleted = badge === 'D'
  const stageLabel = isUntracked || props.kind === 'changed' ? '暂存更改' : '取消暂存'

  function onStageToggle() {
    if (props.kind === 'staged') {
      props.onUnstage([props.entry.path])
      return
    }
    props.onStage([props.entry.path])
  }

  return (
    <li
      data-git-path={props.entry.path}
      data-git-kind={props.kind}
      data-git-badge={badge}
      className="group/row hover:bg-muted/60 relative flex items-center gap-1 rounded-sm py-0.5 pr-1 pl-3">
      <Button
        variant="ghost"
        type="button"
        className="h-auto min-w-0 flex-1 shrink justify-start gap-1.5 rounded-sm px-0 text-left text-xs font-normal"
        title={`${props.entry.path}（点击查看差异）`}
        onClick={function () {
          props.onOpenDiff(props.entry.path)
        }}>
        <span className="text-foreground min-w-0 truncate text-xs">{findName(props.entry.path)}</span>
        {parent ? (
          <span className="text-muted-foreground min-w-0 truncate text-[11px] opacity-70">{parent}</span>
        ) : null}
      </Button>
      <div className="bg-muted absolute right-6 hidden items-center gap-0.5 rounded-sm group-hover/row:flex">
        {isDeleted ? null : (
          <RowAction
            icon="lucide:square-arrow-out-up-right"
            label="打开文件"
            onClick={function () {
              props.onOpenFile(props.entry.path)
            }}
          />
        )}
        <RowAction
          icon="lucide:undo-2"
          label={isUntracked ? '删除文件' : '撤销更改'}
          isDanger
          onClick={function () {
            props.onDiscard([props.entry.path], isUntracked)
          }}
        />
        <RowAction
          icon={isUntracked || props.kind === 'changed' ? 'lucide:plus' : 'lucide:minus'}
          label={stageLabel}
          onClick={onStageToggle}
        />
      </div>
      <span
        className={cn(
          'w-4 shrink-0 text-center font-mono text-[11px] font-medium',
          BADGE_STYLE[badge]
        )}>
        {badge}
      </span>
    </li>
  )
}

function Changes(props: ChangesProps) {
  const findMenuItems = useCallback(
    function (trigger: Element): MenuItem[] {
      const path = trigger.getAttribute('data-git-path')
      const kind = trigger.getAttribute('data-git-kind') as GroupKind | null
      const badge = trigger.getAttribute('data-git-badge')
      if (!path || !kind) return []
      const isUntracked = kind === 'untracked'
      const items: MenuItem[] = []
      if (badge !== 'D') {
        items.push({
          key: 'open-file',
          label: '打开文件',
          onSelect() {
            props.onOpenFile(path)
          }
        })
      }
      if (kind === 'staged') {
        items.push({
          key: 'unstage',
          label: '取消暂存',
          onSelect() {
            props.onUnstage([path])
          }
        })
      } else {
        items.push({
          key: 'stage',
          label: '暂存更改',
          onSelect() {
            props.onStage([path])
          }
        })
      }
      items.push({
        key: 'open',
        label: '查看差异',
        onSelect() {
          props.onOpenDiff(path)
        }
      })
      items.push({
        key: 'discard',
        label: isUntracked ? '删除文件' : '撤销更改',
        danger: true,
        onSelect() {
          props.onDiscard([path], isUntracked)
        }
      })
      return items
    },
    [props]
  )

  return (
    <ContextMenu
      trigger="[data-git-path]"
      findItems={findMenuItems}>
      <div className="flex flex-col">
        {props.groups.map(function (group) {
          if (group.entries.length === 0) return null
          return (
            <section
              key={group.kind}
              className="mb-1">
              <div className="group/header text-muted-foreground hover:bg-muted/60 flex h-6 items-center gap-1 px-3 text-[11px] font-medium">
                <span className="min-w-0 flex-1 truncate">{group.title}</span>
                <div className="ml-auto flex shrink-0 items-center gap-0.5">
                  <div className="hidden items-center gap-0.5 group-hover/header:flex">
                    {group.kind === 'staged' ? null : (
                      <RowAction
                        icon="lucide:undo-2"
                        label={group.kind === 'untracked' ? '删除全部未跟踪文件' : '撤销全部更改'}
                        isDanger
                        onClick={function () {
                          const paths = group.entries.map(function (entry) {
                            return entry.path
                          })
                          props.onDiscard(paths, group.kind === 'untracked')
                        }}
                      />
                    )}
                    <RowAction
                      icon={group.kind === 'staged' ? 'lucide:minus' : 'lucide:plus'}
                      label={group.kind === 'staged' ? '全部取消暂存' : '全部暂存'}
                      onClick={function () {
                        const paths = group.entries.map(function (entry) {
                          return entry.path
                        })
                        if (group.kind === 'staged') props.onUnstage(paths)
                        else props.onStage(paths)
                      }}
                    />
                  </div>
                  <span className="bg-muted text-muted-foreground flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium">
                    {group.entries.length}
                  </span>
                </div>
              </div>
              <ul className="list-none">
                {group.entries.map(function (entry) {
                  return (
                    <ChangeRow
                      key={`${group.kind}:${entry.path}`}
                      entry={entry}
                      kind={group.kind}
                      onOpenDiff={props.onOpenDiff}
                      onOpenFile={props.onOpenFile}
                      onStage={props.onStage}
                      onUnstage={props.onUnstage}
                      onDiscard={props.onDiscard}
                    />
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>
    </ContextMenu>
  )
}

export { Changes }
export type { GroupKind }
