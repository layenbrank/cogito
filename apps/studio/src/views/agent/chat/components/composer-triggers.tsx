/**
 * studio 的 composer 触发器：`@` 工作区文件、`/` 技能。
 *
 * 与 client 版结构相同（配置 + 列表），数据源换成 studio 的 `itc.workspace.*` IPC。
 * 候选项直接进 `ComposerTrigger.resolve`，不再经过 assistant-ui 的 mention adapter。
 */
import {
  useComposerTrigger,
  type ComposerTrigger,
  type ComposerTriggerItem,
  type ComposerTriggerListProps
} from '@cogito/design/assistant/composer-trigger'
import { OVERLAY_ELEVATION } from '@cogito/design/lib/surface'
import { Icon } from '@iconify/react/offline'
import { useMemo } from 'react'

import { useActiveWorkspaceID } from '@/features/agent/workspace/client.ts'
import { cn } from 'cn'

const SEARCH_LIMIT = 40

interface FileData {
  readonly relative: string
}

interface SkillData {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly relative: string
}

function findFileData(item: ComposerTriggerItem): FileData | null {
  const data = item.data
  if (typeof data !== 'object' || data === null) return null
  const candidate = data as FileData
  return typeof candidate.relative === 'string' ? candidate : null
}

function findSkillData(item: ComposerTriggerItem): SkillData | null {
  const data = item.data
  if (typeof data !== 'object' || data === null) return null
  const candidate = data as SkillData
  return typeof candidate.relative === 'string' ? candidate : null
}

function useComposerTriggers(): readonly ComposerTrigger[] {
  const workspaceID = useActiveWorkspaceID()

  return useMemo(
    function () {
      const mention: ComposerTrigger = {
        id: 'mention',
        token: '@',
        resolve: async function ({ query, signal }) {
          if (!workspaceID) return []
          const needle = query.trim()
          try {
            const rows =
              needle.length === 0
                ? (await itc.workspace.readDir({ workspaceID }))
                    .filter(function (entry) {
                      return entry.kind === 'file'
                    })
                    .slice(0, SEARCH_LIMIT)
                : await itc.workspace.search({ workspaceID, query: needle, limit: SEARCH_LIMIT })
            if (signal.aborted) return []
            return rows.map(function (row) {
              return {
                id: row.relative,
                label: row.name,
                description: row.relative,
                data: { relative: row.relative } satisfies FileData
              }
            })
          } catch (error) {
            console.warn('[composer-triggers] 搜索文件失败:', error)
            return []
          }
        },
        onSelect: function (item, api) {
          const fileData = findFileData(item)
          if (fileData === null) return
          // 展示只用末段名；id 保留相对路径给 agent
          const slash = Math.max(fileData.relative.lastIndexOf('/'), fileData.relative.lastIndexOf('\\'))
          const baseName = slash < 0 ? fileData.relative : fileData.relative.slice(slash + 1)
          api.insertChip({ type: 'file', label: baseName, id: fileData.relative })
        }
      }

      const skill: ComposerTrigger = {
        id: 'skill',
        token: '/',
        resolve: async function ({ query, signal }) {
          if (!workspaceID) return []
          try {
            const rows = await itc.workspace.readSkills({ workspaceID })
            if (signal.aborted) return []
            const needle = query.trim().toLowerCase()
            return rows
              .filter(function (row) {
                if (needle.length === 0) return true
                return (
                  row.name.toLowerCase().includes(needle) ||
                  row.id.toLowerCase().includes(needle) ||
                  row.relative.toLowerCase().includes(needle)
                )
              })
              .map(function (row) {
                return {
                  id: row.id,
                  label: row.name,
                  description: row.description || undefined,
                  data: row satisfies SkillData
                }
              })
          } catch (error) {
            console.warn('[composer-triggers] 读取技能失败:', error)
            return []
          }
        },
        onSelect: function (item, api) {
          const skillData = findSkillData(item)
          if (skillData === null) return
          // 技能也只进文本流：`:skill[名称]{name=相对路径}`
          api.insertChip({ type: 'skill', label: skillData.name, id: skillData.relative })
        }
      }

      return [mention, skill]
    },
    [workspaceID]
  )
}

function ComposerTriggerList(props: ComposerTriggerListProps) {
  const trigger = useComposerTrigger()
  if (!trigger || trigger.match === null) return null

  const { items, activeIndex, isLoading, match } = trigger
  const isMention = match.trigger.id === 'mention'

  return (
    <div
      className={cn(
        'bg-popover absolute bottom-full left-0 z-20 mb-2 w-72 overflow-hidden rounded-lg',
        OVERLAY_ELEVATION,
        props.className
      )}>
      {isLoading ? (
        <p className="text-muted-foreground flex items-center gap-1.5 px-3 py-2.5 text-xs">
          <Icon
            icon="lucide:loader-circle"
            className="size-3.5 animate-spin"
          />
          读取中…
        </p>
      ) : null}
      {!isLoading && items.length === 0 ? (
        <p className="text-muted-foreground px-3 py-2.5 text-xs">
          {isMention ? '没有匹配的文件' : '当前工作区暂无技能'}
        </p>
      ) : null}
      {!isLoading && items.length > 0 ? (
        <div className="max-h-64 overflow-y-auto p-1">
          {items.map(function (item, index) {
            return (
              <button
                type="button"
                key={item.id}
                data-highlighted={index === activeIndex ? 'true' : undefined}
                className="data-highlighted:bg-muted hover:bg-muted flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs outline-none"
                onMouseEnter={function () {
                  trigger.hover(index)
                }}
                onMouseDown={function (event) {
                  event.preventDefault()
                  trigger.pick(index)
                }}>
                <Icon
                  icon={isMention ? 'lucide:file' : 'lucide:wrench'}
                  className="text-muted-foreground size-3.5 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.description ? (
                  <span className="text-muted-foreground max-w-[40%] truncate text-xs">
                    {item.description}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export { ComposerTriggerList, useComposerTriggers }
