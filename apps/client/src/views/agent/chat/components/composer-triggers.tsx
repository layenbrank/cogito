/**
 * composer 的 `@` / `/` 触发器配置 + 候选列表。
 *
 * 触发器能力全部由 `@cogito/design` 的 `ComposerTrigger` 定义，这里只做三件事：
 * 1. `resolve`：把「浏览器标签页 + 工作区文件」「工作区技能」翻译成候选项；
 * 2. `onSelect`：选中后插 chip / 挂附件 / 删 token —— 行为完全自定义；
 * 3. `ComposerTriggerList`：候选项的视觉。
 *
 * 浏览器标签页的 `label` 与 `id` 都取 webview label，于是序列化成
 * `:browser[browser-2]` —— agent 侧 playbook 写的就是「方括号里是 app_browser_* 的 tab 参数」。
 */
import {
  useComposerTrigger,
  type ComposerTrigger,
  type ComposerTriggerItem,
  type ComposerTriggerListProps
} from '@cogito/design/assistant/composer-trigger'
import { Icon } from '@iconify/react/offline'
import { useMemo } from 'react'

import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { formatTabTitle } from '@/features/browser/address'
import { useBrowserStore } from '@/features/browser/store'
import { WorkspaceFiles } from '@/lib/workspace-files.ts'
import { WorkspaceSkills } from '@/lib/workspace-skills.ts'
import { findFileIcon } from '@/views/workspace/overlay/file-icon.ts'
import { cn } from 'cn'

const SEARCH_LIMIT = 40

type MentionData =
  | { readonly kind: 'browser'; readonly label: string; readonly url: string }
  | { readonly kind: 'file'; readonly relative: string }

interface SkillData {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly relative: string
}

function findMentionData(item: ComposerTriggerItem): MentionData | null {
  const data = item.data
  if (typeof data !== 'object' || data === null) return null
  const candidate = data as MentionData
  if (candidate.kind === 'browser' || candidate.kind === 'file') return candidate
  return null
}

function findSkillData(item: ComposerTriggerItem): SkillData | null {
  const data = item.data
  if (typeof data !== 'object' || data === null) return null
  const candidate = data as SkillData
  return typeof candidate.relative === 'string' ? candidate : null
}

function findBrowserHost(url: string) {
  try {
    return new URL(url).host
  } catch (error) {
    console.warn('[composer-triggers] 无法解析标签页地址:', error)
    return url
  }
}

/**
 * 触发器配置。
 *
 * 两个触发器的选中动作都只改文本（插 chip），不碰附件行 —— 附件行只放
 * `Ctrl+V` 粘贴的文件和图片。
 */
function useComposerTriggers(): readonly ComposerTrigger[] {
  const { rootPath } = useActiveWorkspace()

  return useMemo(
    function () {
      const mention: ComposerTrigger = {
        id: 'mention',
        token: '@',
        resolve: async function ({ query, signal }) {
          const needle = query.trim().toLowerCase()
          const browserItems: ComposerTriggerItem[] = useBrowserStore
            .getState()
            .tabs.filter(function (tab) {
              if (needle.length === 0) return true
              return (
                tab.label.toLowerCase().includes(needle) ||
                formatTabTitle(tab.url).toLowerCase().includes(needle)
              )
            })
            .map(function (tab) {
              return {
                id: `browser:${tab.label}`,
                label: tab.label,
                description: `${findBrowserHost(tab.url)} · 浏览器标签页`,
                data: { kind: 'browser', label: tab.label, url: tab.url } satisfies MentionData
              }
            })

          const fileItems: ComposerTriggerItem[] = []
          if (rootPath) {
            try {
              const rows =
                needle.length === 0
                  ? (await WorkspaceFiles.listDir(rootPath))
                      .filter(function (entry) {
                        return entry.kind === 'file'
                      })
                      .slice(0, SEARCH_LIMIT)
                  : (await WorkspaceFiles.search([rootPath], query, SEARCH_LIMIT)).hits
              if (signal.aborted) return []
              rows.forEach(function (row) {
                fileItems.push({
                  id: `file:${row.relative}`,
                  label: row.name,
                  description: row.relative,
                  data: { kind: 'file', relative: row.relative } satisfies MentionData
                })
              })
            } catch (error) {
              console.warn('[composer-triggers] 搜索文件失败:', error)
              return browserItems
            }
          }
          if (signal.aborted) return []
          return [...browserItems, ...fileItems]
        },
        onSelect: function (item, api) {
          const mentionData = findMentionData(item)
          if (mentionData === null) return
          if (mentionData.kind === 'browser') {
            // 标签页只给 directive 文本（方括号里就是 app_browser_* 的 tab 参数）
            api.insertChip({ type: 'browser', label: mentionData.label, id: mentionData.label })
            return
          }
          // 文件只进文本流（chip）：附件行留给 Ctrl+V 粘贴的文件 / 图片，
          // 否则同一个文件会在输入区里出现两次。
          api.insertChip({ type: 'file', label: mentionData.relative, id: mentionData.relative })
        }
      }

      const skill: ComposerTrigger = {
        id: 'skill',
        token: '/',
        resolve: async function ({ query, signal }) {
          if (!rootPath) return []
          try {
            const rows = await WorkspaceSkills.fetchSkills([rootPath])
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
          // 技能也只进文本流：`:skill[名称]{name=相对路径}`，不再往附件行里塞一份
          api.insertChip({ type: 'skill', label: skillData.name, id: skillData.relative })
        }
      }

      return [mention, skill]
    },
    [rootPath]
  )
}

function ComposerTriggerList(props: ComposerTriggerListProps) {
  const trigger = useComposerTrigger()
  if (!trigger || trigger.match === null) return null

  const { items, activeIndex, isLoading, match } = trigger
  const isMention = match.trigger.id === 'mention'
  const emptyText = isMention ? '没有匹配的文件或标签页' : '当前工作区暂无技能'

  return (
    <div
      className={cn(
        'border-border/60 bg-popover absolute bottom-full left-0 z-20 mb-2 w-72 overflow-hidden rounded-lg border shadow-md',
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
        <p className="text-muted-foreground px-3 py-2.5 text-xs">{emptyText}</p>
      ) : null}
      {!isLoading && items.length > 0 ? (
        <div className="max-h-64 overflow-y-auto p-1">
          {items.map(function (item, index) {
            const mentionData = findMentionData(item)
            const isBrowser = mentionData?.kind === 'browser'
            const icon = isBrowser
              ? 'lucide:globe'
              : isMention
                ? findFileIcon(item.label).icon
                : 'lucide:wrench'
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
                  // 别让点击抢走编辑器焦点
                  event.preventDefault()
                  trigger.pick(index)
                }}>
                <Icon
                  icon={icon}
                  className={cn('size-3.5 shrink-0', isBrowser && 'text-muted-foreground')}
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.description ? (
                  <span className="text-muted-foreground max-w-[45%] truncate text-xs">
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
