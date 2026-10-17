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
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { attachWorkspaceFile } from '@/features/agent/attachment.ts'
import { useActiveWorkspaceID } from '@/features/agent/workspace/client.ts'
import { toIpcMessage } from '@/utils/ipc.errors.ts'

/**
 * 输入框内 `@`（工作区文件）/ `/`（技能）触发层。
 *
 * 挂在 design `ComposerTriggers` 槽；选中后走 `attachWorkspaceFile`，
 * 与 `+` 菜单同一套附件 / `host.references` 管线。
 */

const SEARCH_LIMIT = 40

/**
 * 触发前界：对齐 client `sender-trigger`——行首 / 空白 / CJK 后可触发，
 * ASCII 标识符与 URL 字符后不触发（减轻 `a@b`、`http://`、路径 mid `/`）。
 */
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

/** 把当前 TriggerPopover 的 query 同步给父级，便于 debounce 搜文件 */
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
  const workspaceID = useActiveWorkspaceID()
  const [needle, updateNeedle] = useState('')

  const skillsQuery = useQuery({
    queryKey: ['workspace', 'readSkills', workspaceID],
    queryFn: function () {
      return itc.workspace.readSkills({ workspaceID: workspaceID as string })
    },
    enabled: Boolean(workspaceID)
  })

  const mentionFetch = useQuery({
    queryKey: ['workspace', 'mention', workspaceID, needle],
    queryFn: async function () {
      if (!workspaceID) return [] as Unstable_Mention[]
      if (needle.length === 0) {
        const entries = await itc.workspace.readDir({ workspaceID })
        return toMentionItems(
          entries
            .filter(function (entry) {
              return entry.kind === 'file'
            })
            .slice(0, SEARCH_LIMIT)
        )
      }
      const hits = await itc.workspace.search({
        workspaceID,
        query: needle,
        limit: SEARCH_LIMIT
      })
      return toMentionItems(hits)
    },
    enabled: Boolean(workspaceID),
    placeholderData: function (previous) {
      return previous
    }
  })

  function attachRelative(relative: string) {
    void attachWorkspaceFile(aui, relative).catch(function (error: unknown) {
      toast.error(toIpcMessage(error, '引用失败'))
    })
  }

  const mentionItems = mentionFetch.data ?? []
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
      const rows = skillsQuery.data ?? []
      return rows.map(function (skill) {
        const relative = skill.relative
        return {
          id: skill.id,
          label: skill.name,
          description: skill.description || undefined,
          execute: function () {
            void attachWorkspaceFile(aui, relative).catch(function (error: unknown) {
              toast.error(toIpcMessage(error, '引用失败'))
            })
          }
        }
      })
    },
    [skillsQuery.data, aui]
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
        isLoading={mentionFetch.isFetching}
        className="contents">
        <ComposerPrimitive.Unstable_TriggerPopover.Directive {...mention.directive} />
        <TriggerQuerySync onQuery={updateNeedle} />
        <ComposerPrimitive.Unstable_TriggerPopoverItems>
          {function (items) {
            return (
              <TriggerListShell
                isLoading={mentionFetch.isFetching}
                hasItems={items.length > 0}
                empty={workspaceID ? '没有匹配的文件' : '先在左栏添加工作区'}>
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
        isLoading={skillsQuery.isFetching}
        className="contents">
        <ComposerPrimitive.Unstable_TriggerPopover.Action {...slash.action} />
        <ComposerPrimitive.Unstable_TriggerPopoverItems>
          {function (items) {
            return (
              <TriggerListShell
                isLoading={skillsQuery.isFetching}
                hasItems={items.length > 0}
                empty={workspaceID ? '当前工作区暂无技能' : '先在左栏添加工作区'}>
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
                      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                        <span className="w-full truncate">{item.label}</span>
                        {item.description ? (
                          <span className="text-muted-foreground w-full truncate text-xs">
                            {item.description}
                          </span>
                        ) : null}
                      </span>
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
