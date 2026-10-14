/**
 * 输入框内 `@`（工作区文件）/ `/`（技能）触发层。
 */
import {
  ComposerPrimitive,
  unstable_defaultDirectiveFormatter,
  unstable_useMentionAdapter,
  unstable_useSlashCommandAdapter,
  useAui,
  type Unstable_Mention,
  type Unstable_SlashCommand,
  type Unstable_TriggerItem
} from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { attachWorkspaceFile } from '@/features/agent/attachment.ts'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { WorkspaceFiles } from '@/lib/workspace-files.ts'
import { WorkspaceSkills } from '@/lib/workspace-skills.ts'

const SEARCH_LIMIT = 40

function findHasValidTriggerBoundary(text: string, atIndex: number) {
  if (atIndex <= 0) return true
  const prev = text[atIndex - 1]
  if (!prev) return true
  if (/[\s\u00a0]/.test(prev)) return true
  if (/[A-Za-z0-9._~-]/.test(prev)) return false
  return true
}

function matchTriggerToken(
  text: string,
  triggerChar: string,
  cursorPosition: number
): { query: string; offset: number; endOffset: number } | null {
  if (cursorPosition <= 0) return null
  const before = text.slice(0, cursorPosition)
  const escaped = triggerChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matched = before.match(new RegExp(`${escaped}([^\\s]*)$`))
  if (!matched || matched.index === undefined) return null
  if (!findHasValidTriggerBoundary(before, matched.index)) return null

  const query = matched[1] ?? ''
  return {
    query,
    offset: matched.index,
    endOffset: matched.index + triggerChar.length + query.length
  }
}

function TriggerListShell(props: {
  isLoading?: boolean
  empty: string
  children: ReactNode
  hasItems: boolean
}) {
  return (
    <div className="border-border/60 bg-popover absolute bottom-full left-0 z-20 mb-2 w-72 overflow-hidden rounded-lg border shadow-md">
      {props.isLoading ? (
        <p className="text-muted-foreground flex items-center gap-1.5 px-3 py-2.5 text-xs">
          <Icon
            icon="lucide:loader-circle"
            className="size-3.5 animate-spin"
          />
          读取中…
        </p>
      ) : null}
      {!props.isLoading && !props.hasItems ? (
        <p className="text-muted-foreground px-3 py-2.5 text-xs">{props.empty}</p>
      ) : null}
      {!props.isLoading && props.hasItems ? (
        <div className="max-h-64 overflow-y-auto p-1">{props.children}</div>
      ) : null}
    </div>
  )
}

function TriggerQuerySync(props: { onQuery: (query: string) => void }) {
  const scope = ComposerPrimitive.unstable_useTriggerPopoverScopeContext()
  const { onQuery } = props

  useEffect(
    function () {
      onQuery(scope.query.trim())
    },
    [scope.query, onQuery]
  )

  return null
}

function toMentionItems(rows: Array<{ name: string; relative: string }>): Unstable_Mention[] {
  return rows.map(function (row) {
    return {
      id: row.relative,
      type: 'file',
      label: row.name,
      description: row.relative,
      metadata: { relative: row.relative }
    }
  })
}

function ComposerTriggers() {
  const aui = useAui()
  const { primaryPath } = useActiveWorkspace()
  const [needle, updateNeedle] = useState('')
  const [mentionItemsState, updateMentionItems] = useState<Unstable_Mention[]>([])
  const [isMentionLoading, updateMentionLoading] = useState(false)
  const [skillsState, updateSkills] = useState<
    Array<{ id: string; name: string; description: string; relative: string }>
  >([])
  /** 没有工作区时按空列表渲染：不在 effect 里同步清 state */
  const skills = primaryPath ? skillsState : []
  const mentionItems = primaryPath ? mentionItemsState : []

  useEffect(
    function () {
      if (!primaryPath) return
      let cancelled = false
      void WorkspaceSkills.fetchSkills([primaryPath])
        .then(function (rows) {
          if (!cancelled) updateSkills(rows)
        })
        .catch(function (error) {
          console.warn('[composer-triggers] 读取技能失败:', error)
          if (!cancelled) updateSkills([])
        })
      return function () {
        cancelled = true
      }
    },
    [primaryPath]
  )

  useEffect(
    function () {
      if (!primaryPath) return
      let cancelled = false

      async function load() {
        updateMentionLoading(true)
        try {
          const items =
            needle.length === 0
              ? toMentionItems(
                  (await WorkspaceFiles.listDir(primaryPath as string))
                    .filter(function (entry) {
                      return entry.kind === 'file'
                    })
                    .slice(0, SEARCH_LIMIT)
                    .map(function (entry) {
                      return { name: entry.name, relative: entry.relative }
                    })
                )
              : toMentionItems(
                  (await WorkspaceFiles.search([primaryPath as string], needle, SEARCH_LIMIT)).map(
                    function (hit) {
                      return { name: hit.name, relative: hit.relative }
                    }
                  )
                )
          if (!cancelled) updateMentionItems(items)
        } catch (error) {
          console.warn('[composer-triggers] 搜索文件失败:', error)
          if (!cancelled) updateMentionItems([])
        } finally {
          if (!cancelled) updateMentionLoading(false)
        }
      }

      void load()

      return function () {
        cancelled = true
      }
    },
    [primaryPath, needle]
  )

  function attachRelative(relative: string) {
    void attachWorkspaceFile(aui, relative).catch(function (error: unknown) {
      toast.error(error instanceof Error ? error.message : '引用失败')
    })
  }

  const mention = unstable_useMentionAdapter({
    items: mentionItems,
    includeModelContextTools: false,
    formatter: unstable_defaultDirectiveFormatter,
    onInserted: function (item: Unstable_TriggerItem) {
      const relative =
        typeof item.metadata?.relative === 'string' ? item.metadata.relative : item.id
      if (relative) attachRelative(relative)
    }
  })

  const slashCommands = useMemo(
    function (): Unstable_SlashCommand[] {
      return skills.map(function (skill) {
        return {
          id: skill.id,
          label: skill.name,
          description: skill.description || undefined,
          execute: function () {
            attachRelative(skill.relative)
          }
        }
      })
    },
    // attachRelative 闭包读最新 aui；技能列表变化时重建即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [skills]
  )

  const slash = unstable_useSlashCommandAdapter({
    commands: slashCommands,
    removeOnExecute: true
  })

  return (
    <>
      <ComposerPrimitive.Unstable_TriggerPopover
        char="@"
        matcher={matchTriggerToken}
        adapter={mention.adapter}
        isLoading={isMentionLoading}
        className="contents">
        <ComposerPrimitive.Unstable_TriggerPopover.Directive {...mention.directive} />
        <TriggerQuerySync onQuery={updateNeedle} />
        <ComposerPrimitive.Unstable_TriggerPopoverItems>
          {function (items) {
            return (
              <TriggerListShell
                isLoading={isMentionLoading}
                hasItems={items.length > 0}
                empty={primaryPath ? '没有匹配的文件' : '先在左栏添加工作区'}>
                {items.map(function (item, index) {
                  return (
                    <ComposerPrimitive.Unstable_TriggerPopoverItem
                      key={item.id}
                      item={item}
                      index={index}
                      className="data-highlighted:bg-muted hover:bg-muted flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs outline-none">
                      <Icon
                        icon="lucide:file"
                        className="text-muted-foreground size-3.5 shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.description ? (
                        <span className="text-muted-foreground max-w-[40%] truncate text-xs">
                          {item.description}
                        </span>
                      ) : null}
                    </ComposerPrimitive.Unstable_TriggerPopoverItem>
                  )
                })}
              </TriggerListShell>
            )
          }}
        </ComposerPrimitive.Unstable_TriggerPopoverItems>
      </ComposerPrimitive.Unstable_TriggerPopover>

      <ComposerPrimitive.Unstable_TriggerPopover
        char="/"
        matcher={matchTriggerToken}
        adapter={slash.adapter}
        className="contents">
        <ComposerPrimitive.Unstable_TriggerPopover.Action {...slash.action} />
        <ComposerPrimitive.Unstable_TriggerPopoverItems>
          {function (items) {
            return (
              <TriggerListShell
                hasItems={items.length > 0}
                empty={primaryPath ? '当前工作区暂无技能' : '先在左栏添加工作区'}>
                {items.map(function (item, index) {
                  return (
                    <ComposerPrimitive.Unstable_TriggerPopoverItem
                      key={item.id}
                      item={item}
                      index={index}
                      className="data-highlighted:bg-muted hover:bg-muted flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs outline-none">
                      <Icon
                        icon="lucide:wrench"
                        className="text-muted-foreground size-3.5 shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    </ComposerPrimitive.Unstable_TriggerPopoverItem>
                  )
                })}
              </TriggerListShell>
            )
          }}
        </ComposerPrimitive.Unstable_TriggerPopoverItems>
      </ComposerPrimitive.Unstable_TriggerPopover>
    </>
  )
}

export { ComposerTriggers }
