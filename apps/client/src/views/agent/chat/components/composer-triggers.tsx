/**
 * composer 的 `@` / `/` 触发器配置 + 候选列表。
 *
 * 触发器能力全部由 `@cogito/design` 的 `ComposerTrigger` 定义，这里只做三件事：
 * 1. `resolve`：把「浏览器标签页 + 工作区文件」「工作区技能」翻译成候选项；
 * 2. `onSelect`：选中后插 chip / 挂附件 / 删 token —— 行为完全自定义；
 * 3. `ComposerTriggerList`：候选项的视觉。
 *
 * 工作区是多根的（frontend / backend / docs…），`@` 不再只搜「当前文件夹」：
 * - 搜的是**整个工作区**，行尾标出所属文件夹；
 * - `@api` / `@api/src` 命中工作区文件夹时收窄到那个文件夹；
 * - 文件夹本身也是候选项，可以整体引用一个项目目录。
 *
 * 引用路径（chip 的 id、附件名）走 `toAgentPath`：会话 cwd 只等于主文件夹，
 * 所以主文件夹内给相对路径，其他文件夹给绝对路径。
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@cogito/design/components/tooltip'
import { Icon } from '@iconify/react/offline'
import { useEffect, useMemo, useRef } from 'react'

import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import {
  findOwningRoot,
  splitFolderScope,
  toAgentPath,
  toBaseName
} from '@/features/agent/workspace/paths.ts'
import { formatTabTitle } from '@/features/browser/address'
import { useBrowserStore } from '@/features/browser/store'
import {
  buildFolderLabels,
  findFolderLabel
} from '@/views/agent/chat/components/workspace-relative-path.ts'
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
  | {
      readonly kind: 'file'
      readonly label: string
      readonly isDirectory: boolean
      /** 插入输入框的引用路径：主文件夹内相对，其他文件夹绝对 */
      readonly mentionPath: string
    }

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
    list.scrollTo({ top: nextTop, behavior: 'auto' })
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
  if (candidate.kind === 'file' && typeof candidate.mentionPath === 'string') {
    return {
      kind: 'file',
      label: candidate.label,
      isDirectory: candidate.isDirectory === true,
      mentionPath: candidate.mentionPath
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
  const { rootPath, primaryRootPath, folderPaths } = useActiveWorkspace()

  return useMemo(
    function () {
      const isMultiRoot = folderPaths.length > 1
      /** 当前文件夹优先：第一批结果应当属于正在看的那个项目 */
      const orderedRoots = rootPath
        ? [
            rootPath,
            ...folderPaths.filter(function (path) {
              return path !== rootPath
            })
          ]
        : folderPaths

      /** 多根时行尾带文件夹名；同名的两个 api 靠上一级目录区分，和右栏 chips 一致 */
      const folderLabels = buildFolderLabels(orderedRoots)

      /**
       * 一条文件/文件夹候选。
       * `absolute` 用来算引用路径；`relative` 只是展示（多根时带上文件夹名）。
       */
      function buildPathItem(input: {
        root: string
        name: string
        relative: string
        absolute: string
        isDirectory: boolean
      }): ComposerTriggerItem {
        const description = isMultiRoot
          ? `${findFolderLabel(folderLabels, input.root)}/${input.relative}`
          : input.relative
        return {
          id: `${input.isDirectory ? 'folder' : 'file'}:${input.absolute}`,
          label: input.name,
          description,
          data: {
            kind: 'file',
            label: input.name,
            isDirectory: input.isDirectory,
            mentionPath: toAgentPath(input.absolute, primaryRootPath)
          } satisfies MentionData
        }
      }

      /** 工作区文件夹本身：整体引用一个项目目录 */
      function buildRootItem(root: string): ComposerTriggerItem {
        const name = toBaseName(root)
        return {
          id: `workspace-root:${root}`,
          label: name,
          // 完整路径：两个同名项目并排时，这是唯一能分辨的信息
          description: root,
          data: {
            kind: 'file',
            label: name,
            isDirectory: true,
            mentionPath: toAgentPath(root, primaryRootPath)
          } satisfies MentionData
        }
      }

      const mention: ComposerTrigger = {
        id: 'mention',
        token: '@',
        resolve: async function ({ query, signal }) {
          const raw = normalizeSearchQuery(query)
          const needle = raw.toLowerCase()
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

          if (orderedRoots.length === 0) return browserItems

          // `@api/src` 这种写法直接收窄到 api 文件夹
          const scope = splitFolderScope(orderedRoots, raw)
          const roots = scope ? [scope.root] : orderedRoots
          const pathQuery = scope ? scope.query : raw
          const head = (raw.split('/')[0] ?? '').toLowerCase()

          const pathItems: ComposerTriggerItem[] = []

          // 文件夹候选：多根工作区里 `@` 一下先看到有哪些项目；
          // 收窄之后（rest 为空）也把它排在第一位，方便整体引用
          if (!scope || pathQuery.length === 0) {
            const candidates = orderedRoots.filter(function (path) {
              const name = toBaseName(path).toLowerCase()
              if (head.length === 0) return isMultiRoot
              return name.includes(head)
            })
            for (const path of candidates) pathItems.push(buildRootItem(path))
          }

          try {
            if (pathQuery.length === 0) {
              const lists = await Promise.all(
                roots.map(function (path) {
                  return WorkspaceFiles.listDir(path).catch(function (cause: unknown) {
                    console.warn('[composer-triggers] 列目录失败:', path, cause)
                    return []
                  })
                })
              )
              if (signal.aborted) return []
              /** 名额平摊到每个文件夹：否则第一个项目占满上限，后面的项目永远看不到 */
              const perRoot = Math.max(1, Math.ceil(SEARCH_LIMIT / roots.length))
              lists.forEach(function (rows, index) {
                const root = roots[index]
                for (const row of rows.slice(0, perRoot)) {
                  pathItems.push(
                    buildPathItem({
                      root,
                      name: row.name,
                      relative: row.relative,
                      absolute: row.path,
                      isDirectory: row.kind === 'dir'
                    })
                  )
                }
              })
            } else {
              // Rust 侧按 root 缓存文件列表并产出 dir 命中；这里只做归属映射
              const result = await WorkspaceFiles.search(roots, pathQuery, SEARCH_LIMIT)
              if (signal.aborted) return []
              for (const row of result.hits) {
                const owner = findOwningRoot(row.path, orderedRoots) ?? roots[0]
                pathItems.push(
                  buildPathItem({
                    root: owner,
                    name: row.name,
                    relative: row.relative,
                    absolute: row.path,
                    isDirectory: row.kind === 'dir'
                  })
                )
              }
            }
          } catch (error) {
            console.warn('[composer-triggers] 搜索文件失败:', error)
            return [...browserItems, ...pathItems]
          }

          if (signal.aborted) return []
          return [...browserItems, ...pathItems.slice(0, SEARCH_LIMIT)]
        },
        onSelect: function (item, api) {
          const mentionData = findMentionData(item)
          if (mentionData === null) return
          if (mentionData.kind === 'browser') {
            // 标签页只给 directive 文本（方括号里就是 app_browser_* 的 tab 参数）
            api.insertChip({ type: 'browser', label: mentionData.label, id: mentionData.label })
            return
          }
          // 展示只用末段名；id 是引用路径（主文件夹相对 / 其他文件夹绝对）
          api.insertChip({
            type: 'file',
            label: findBaseName(mentionData.mentionPath),
            id: mentionData.mentionPath
          })
        }
      }

      const skill: ComposerTrigger = {
        id: 'skill',
        token: '/',
        resolve: async function ({ query, signal }) {
          if (rootPath) {
            try {
              const rows = await WorkspaceSkills.fetchSkills(folderPaths)
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
          }
          return []
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
    [rootPath, primaryRootPath, folderPaths]
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
              const icon = isBrowser ? 'lucide:globe' : pathIcon ? pathIcon.icon : 'lucide:sparkles'
              const iconClass = isBrowser
                ? 'text-teal-600 dark:text-teal-400'
                : pathIcon
                  ? pathIcon.className
                  : 'text-amber-600 dark:text-amber-400'
              const tipPath =
                mentionData?.kind === 'file'
                  ? mentionData.mentionPath
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
