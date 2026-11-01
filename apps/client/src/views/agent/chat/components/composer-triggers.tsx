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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@cogito/design/components/tooltip'
import { Icon } from '@iconify/react/offline'
import { useEffect, useMemo, useRef } from 'react'

import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { formatTabTitle } from '@/features/browser/address'
import { useBrowserStore } from '@/features/browser/store'
import { WorkspaceFiles } from '@/lib/workspace-files.ts'
import { WorkspaceSkills } from '@/lib/workspace-skills.ts'
import { findBaseName } from '@/views/agent/chat/components/workspace-relative-path.ts'
import { findFileIcon, findFolderIcon } from '@/views/workspace/overlay/file-icon.ts'
import { cn } from 'cn'

import styles from './composer-triggers.module.scss'

const SEARCH_LIMIT = 40

/** 对齐 Rust `normalize_search_query`：`@/apps/...` → `apps/...` */
function normalizeSearchQuery(query: string) {
  let next = query.trim().replace(/\\/g, '/')
  while (next.startsWith('./')) next = next.slice(2)
  next = next.replace(/^\/+/, '').replace(/\/+$/, '')
  return next
}

type MentionData =
  | { readonly kind: 'browser'; readonly label: string; readonly url: string }
  | { readonly kind: 'file'; readonly relative: string; readonly isDirectory: boolean }

/**
 * 仅滚动列表口，避免 scrollIntoView 带动外层；按 scroll-padding 留边距。
 * 对齐模型选择器 `scrollActiveRowIntoView`。
 */
function scrollActiveRowIntoView(list: HTMLElement | null) {
  if (!list) return
  const row = list.querySelector('[data-highlighted="true"]')
  if (!(row instanceof HTMLElement)) return

  const style = getComputedStyle(list)
  const padTop = Number.parseFloat(style.scrollPaddingTop) || 0
  const padBottom = Number.parseFloat(style.scrollPaddingBottom) || 0
  const listRect = list.getBoundingClientRect()
  const rowRect = row.getBoundingClientRect()

  if (rowRect.top < listRect.top + padTop) {
    const nextTop = list.scrollTop + (rowRect.top - listRect.top) - padTop
    list.scrollTo({ top: Math.max(0, nextTop), behavior: 'auto' })
    return
  }
  if (rowRect.bottom > listRect.bottom - padBottom) {
    const nextTop = list.scrollTop + (rowRect.bottom - listRect.bottom) + padBottom
    list.scrollTo({ top: Math.max(0, nextTop), behavior: 'auto' })
  }
}

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
  if (candidate.kind === 'browser') return candidate
  if (candidate.kind === 'file' && typeof candidate.relative === 'string') {
    return {
      kind: 'file',
      relative: candidate.relative,
      isDirectory: candidate.isDirectory === true
    }
  }
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
          const pathQuery = normalizeSearchQuery(query)
          const needle = pathQuery.toLowerCase()
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

          const pathItems: ComposerTriggerItem[] = []
          if (rootPath) {
            try {
              if (needle.length === 0) {
                const rows = (await WorkspaceFiles.listDir(rootPath)).slice(0, SEARCH_LIMIT)
                if (signal.aborted) return []
                rows.forEach(function (row) {
                  const isDirectory = row.kind === 'dir'
                  pathItems.push({
                    id: `${isDirectory ? 'folder' : 'file'}:${row.relative}`,
                    label: row.name,
                    description: row.relative,
                    data: {
                      kind: 'file',
                      relative: row.relative,
                      isDirectory
                    } satisfies MentionData
                  })
                })
              } else {
                // Rust 侧已缓存文件列表并产出 dir 命中；这里只做映射
                const hits = (await WorkspaceFiles.search([rootPath], pathQuery, SEARCH_LIMIT)).hits
                if (signal.aborted) return []
                hits.forEach(function (row) {
                  const isDirectory = row.kind === 'dir'
                  pathItems.push({
                    id: `${isDirectory ? 'folder' : 'file'}:${row.relative}`,
                    label: row.name,
                    description: row.relative,
                    data: {
                      kind: 'file',
                      relative: row.relative,
                      isDirectory
                    } satisfies MentionData
                  })
                })
              }
            } catch (error) {
              console.warn('[composer-triggers] 搜索文件失败:', error)
              return browserItems
            }
          }
          if (signal.aborted) return []
          return [...browserItems, ...pathItems]
        },
        onSelect: function (item, api) {
          const mentionData = findMentionData(item)
          if (mentionData === null) return
          if (mentionData.kind === 'browser') {
            // 标签页只给 directive 文本（方括号里就是 app_browser_* 的 tab 参数）
            api.insertChip({ type: 'browser', label: mentionData.label, id: mentionData.label })
            return
          }
          // 展示只用末段名；id 保留相对路径，序列化成 `:file[name]{name=相对路径}` 给 agent
          api.insertChip({
            type: 'file',
            label: findBaseName(mentionData.relative),
            id: mentionData.relative
          })
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
  const listRef = useRef<HTMLDivElement>(null)
  const activeIndex = trigger?.activeIndex ?? 0
  const itemCount = trigger?.items.length ?? 0
  const match = trigger?.match ?? null

  useEffect(
    function () {
      if (match === null || itemCount === 0) return
      scrollActiveRowIntoView(listRef.current)
    },
    [activeIndex, itemCount, match]
  )

  if (!trigger || match === null) return null

  const { items, isLoading } = trigger
  const isMention = match.trigger.id === 'mention'
  const emptyText = isMention ? '没有匹配的文件、文件夹或标签页' : '当前工作区暂无技能'

  return (
    <div
      data-trigger={match.trigger.id}
      data-webview="false"
      className={cn(
        styles.surface,
        'border-border/60 bg-popover absolute bottom-full left-0 z-20 mb-2 w-72 overflow-hidden rounded-lg border shadow-md',
        props.className
      )}
      onMouseDown={function (event) {
        // 整块面板都别抢走编辑器焦点（含滚动条），否则会触发 blur 关掉自己
        event.preventDefault()
      }}>
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
        <TooltipProvider delay={360}>
          <div
            ref={listRef}
            className={styles.list}>
            {items.map(function (item, index) {
              const mentionData = findMentionData(item)
              const isBrowser = mentionData?.kind === 'browser'
              const isDirectory = mentionData?.kind === 'file' && mentionData.isDirectory
              const pathIcon = !isMention
                ? null
                : isBrowser
                  ? null
                  : isDirectory
                    ? findFolderIcon(item.label, false)
                    : findFileIcon(item.label)
              const icon = isBrowser
                ? 'lucide:globe'
                : pathIcon
                  ? pathIcon.icon
                  : 'lucide:sparkles'
              const iconClass = isBrowser
                ? 'text-teal-600 dark:text-teal-400'
                : pathIcon
                  ? pathIcon.className
                  : 'text-amber-600 dark:text-amber-400'
              const tipPath =
                mentionData?.kind === 'file'
                  ? mentionData.relative
                  : (item.description ?? item.label)
              return (
                <Tooltip key={item.id}>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        data-highlighted={index === activeIndex ? 'true' : undefined}
                        className="data-highlighted:bg-muted hover:bg-muted flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs outline-none"
                        onMouseEnter={function () {
                          trigger.hover(index)
                        }}
                        onMouseDown={function (event) {
                          event.preventDefault()
                          trigger.pick(index)
                        }}
                      />
                    }>
                    <Icon
                      icon={icon}
                      className={cn('size-3.5 shrink-0', iconClass)}
                    />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.description ? (
                      <span className="text-muted-foreground max-w-[45%] truncate text-xs">
                        {item.description}
                      </span>
                    ) : null}
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    sideOffset={6}
                    className="max-w-72 flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-[12px] leading-snug">
                    <p className="text-[13px] font-medium break-all">{item.label}</p>
                    {tipPath && tipPath !== item.label ? (
                      <p className="text-background/75 break-all">{tipPath}</p>
                    ) : null}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </TooltipProvider>
      ) : null}
    </div>
  )
}

export { ComposerTriggerList, useComposerTriggers }
