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

function ChangeRow(props: {
  entry: StatusEntry
  kind: GroupKind
  onOpenDiff: (relative: string) => void
  onStage: (paths: string[]) => void
  onUnstage: (paths: string[]) => void
  onDiscard: (paths: string[], isUntracked: boolean) => void
}) {
  const badge = findStatusBadge(props.entry)
  const parent = findParentLabel(props.entry.path)
  const isUntracked = props.kind === 'untracked'

  function onPrimaryAction() {
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
      className="group hover:bg-muted/60 flex items-center gap-1.5 rounded-sm py-0.5 pr-1 pl-3">
      <Button
        variant="ghost"
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        title={`${props.entry.path}（点击查看差异）`}
        onClick={function () {
          props.onOpenDiff(props.entry.path)
        }}>
        <span className={cn('w-3 shrink-0 text-center font-mono text-[11px]', BADGE_STYLE[badge])}>
          {badge}
        </span>
        <span className="text-foreground truncate text-xs">{findName(props.entry.path)}</span>
        {parent ? (
          <span className="text-muted-foreground truncate text-[11px] opacity-70">{parent}</span>
        ) : null}
      </Button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          aria-label={isUntracked || props.kind === 'changed' ? '暂存' : '取消暂存'}
          title={isUntracked || props.kind === 'changed' ? '暂存' : '取消暂存'}
          className="hover:bg-muted text-muted-foreground hover:text-foreground flex size-5 items-center justify-center rounded-sm"
          onClick={onPrimaryAction}>
          <Icon
            icon={isUntracked || props.kind === 'changed' ? 'lucide:plus' : 'lucide:minus'}
            className="size-3"
          />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          aria-label="撤销更改"
          title="撤销更改"
          className="hover:bg-muted text-muted-foreground hover:text-destructive flex size-5 items-center justify-center rounded-sm"
          onClick={function () {
            props.onDiscard([props.entry.path], isUntracked)
          }}>
          <Icon
            icon="lucide:undo-2"
            className="size-3"
          />
        </Button>
      </div>
    </li>
  )
}

function Changes(props: ChangesProps) {
  const findMenuItems = useCallback(
    function (trigger: Element): MenuItem[] {
      const path = trigger.getAttribute('data-git-path')
      const kind = trigger.getAttribute('data-git-kind') as GroupKind | null
      if (!path || !kind) return []
      const isUntracked = kind === 'untracked'
      const items: MenuItem[] = []
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
              <div className="text-muted-foreground flex h-6 items-center gap-1 px-3 text-[11px] font-semibold tracking-wider uppercase">
                <span className="truncate">{group.title}</span>
                <span className="opacity-70">{group.entries.length}</span>
                <div className="ml-auto flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    aria-label={group.kind === 'staged' ? '全部取消暂存' : '全部暂存'}
                    title={group.kind === 'staged' ? '全部取消暂存' : '全部暂存'}
                    className="hover:bg-muted hover:text-foreground flex size-5 items-center justify-center rounded-sm"
                    onClick={function () {
                      const paths = group.entries.map(function (entry) {
                        return entry.path
                      })
                      if (group.kind === 'staged') props.onUnstage(paths)
                      else props.onStage(paths)
                    }}>
                    <Icon
                      icon={group.kind === 'staged' ? 'lucide:minus' : 'lucide:plus'}
                      className="size-3"
                    />
                  </Button>
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
