import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { Input } from '@cogito/design/components/input'
import { Kbd } from '@cogito/design/components/kbd'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import { bindingLabels, parseBinding } from '@/keyboard/binding'
import { findCommands, runCommand } from '@/keyboard/commands'
import { findShortcut, resolveBinding } from '@/keyboard/definitions'
import type { Command } from '@/keyboard/types'
import { WorkspaceFiles } from '@/lib/workspace-files'
import { useCodeStore } from '@/stores/code'
import {
  findFileName,
  findRelativePath,
  isPathInsideRoot,
  isSamePath
} from '@/views/code/lib/path.ts'
import { openAbsolutePath } from '@/views/code/lib/open-file.ts'
import { mergeFileHits, hitKey, type FileHit } from '@/views/code/workspace/file-hits.ts'

type PaletteItem =
  | { kind: 'file'; hit: FileHit }
  | { kind: 'line'; line: number }
  | { kind: 'command'; command: Command }

/**
 * 行样式对齐代码窗右键菜单（`.code-ctx-menu`）：34px 行高、7px 圆角、
 * 命中态用「品牌色 9% + muted」的弱底，而不是整行实色。
 */
const ROW_BASE =
  'flex min-h-[34px] w-full cursor-default items-center gap-2.5 rounded-[7px] px-2.5 text-left text-[13px] select-none'
const ROW_ACTIVE = 'bg-[color-mix(in_oklab,var(--primary)_9%,var(--muted))]'
const ROW_IDLE = 'hover:bg-[color-mix(in_oklab,var(--primary)_6%,var(--muted))]'

function includesQuery(hit: FileHit, query: string): boolean {
  if (!query) return true
  const needle = query.toLowerCase()
  return hit.name.toLowerCase().includes(needle) || hit.relative.toLowerCase().includes(needle)
}

/** 命令的键位只存在键位表里（命令元数据只有 id）；没有绑定就不占位 */
function shortcutLabels(commandId: string): string[] | null {
  if (!findShortcut(commandId)) return null
  const binding = parseBinding(resolveBinding(commandId))
  if (!binding) return null
  return bindingLabels(binding)
}

function ShortcutKeys(props: { labels: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {props.labels.map(function (label) {
        return (
          <Kbd
            key={label}
            className="h-4 min-w-4 px-1 text-[10px] font-normal">
            {label}
          </Kbd>
        )
      })}
    </span>
  )
}

function CommandPalette() {
  const paletteMode = useCodeStore(function (state) {
    return state.paletteMode
  })
  const roots = useCodeStore(function (state) {
    return state.roots
  })
  const tabs = useCodeStore(function (state) {
    return state.tabs
  })
  const activeTabId = useCodeStore(function (state) {
    return state.activeTabId
  })
  const recentPaths = useCodeStore(function (state) {
    return state.recentPaths
  })
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [searchHits, setSearchHits] = useState<FileHit[]>([])
  const searchGeneration = useRef(0)
  const activeRow = useRef<HTMLLIElement | null>(null)

  const isOpen = paletteMode !== null
  const isFileMode = paletteMode === 'file'
  const trimmed = query.trim()
  const isCommandPrefix = isFileMode && trimmed.startsWith('>')
  const commandQuery = isCommandPrefix ? trimmed.slice(1).trim() : trimmed
  const isLinePrefix = isFileMode && trimmed.startsWith(':')
  const lineNumber = isLinePrefix ? Number(trimmed.slice(1).trim()) : 0
  const isLineJump = isLinePrefix && Number.isInteger(lineNumber) && lineNumber > 0

  const openHits = useMemo(
    function (): FileHit[] {
      return tabs
        .filter(function (tab) {
          return tab.kind === 'file'
        })
        .map(function (tab) {
          const rootIndex = roots.findIndex(function (root) {
            return isPathInsideRoot(root, tab.path)
          })
          const root = rootIndex >= 0 ? roots[rootIndex] : null
          const hit: FileHit = {
            absolute: tab.path,
            name: tab.title,
            relative: root ? findRelativePath(root, tab.path) : tab.title,
            isOpen: true,
            isDirty: tab.isDirty,
            rootName: root ? findFileName(root) : undefined
          }
          return hit
        })
        .filter(function (hit) {
          return includesQuery(hit, isCommandPrefix || isLinePrefix ? '' : trimmed)
        })
    },
    [tabs, roots, trimmed, isCommandPrefix, isLinePrefix]
  )

  const recentHits = useMemo(
    function (): FileHit[] {
      return recentPaths
        .map(function (path): FileHit {
          const root = roots.find(function (item) {
            return isPathInsideRoot(item, path)
          })
          return {
            absolute: path,
            name: findFileName(path),
            relative: root ? findRelativePath(root, path) : path,
            rootName: root ? findFileName(root) : undefined
          }
        })
        .filter(function (hit) {
          return includesQuery(hit, isCommandPrefix || isLinePrefix ? '' : trimmed)
        })
    },
    [recentPaths, roots, trimmed, isCommandPrefix, isLinePrefix]
  )

  const commands = useMemo(
    function () {
      if (!isOpen) return [] as Command[]
      if (isFileMode && !isCommandPrefix) return [] as Command[]
      if (isFileMode && isLineJump) return [] as Command[]
      return findCommands(isFileMode ? commandQuery : trimmed)
    },
    [isOpen, isFileMode, isCommandPrefix, isLineJump, commandQuery, trimmed]
  )

  const items = useMemo(
    function (): PaletteItem[] {
      if (!isOpen) return []
      if (isFileMode) {
        if (isLineJump) return [{ kind: 'line', line: lineNumber }]
        if (isCommandPrefix) {
          return commands.map(function (command) {
            return { kind: 'command', command }
          })
        }
        return mergeFileHits({
          open: openHits,
          recent: recentHits,
          search: searchHits
        }).map(function (hit) {
          return { kind: 'file', hit }
        })
      }
      return commands.map(function (command) {
        return { kind: 'command', command }
      })
    },
    [
      isOpen,
      isFileMode,
      isLineJump,
      lineNumber,
      isCommandPrefix,
      commands,
      openHits,
      recentHits,
      searchHits
    ]
  )

  const itemCount = items.length
  const rootsKey = roots.join('|')

  const recentKeys = useMemo(
    function () {
      const keys = new Set<string>()
      for (const hit of recentHits) keys.add(hitKey(hit.absolute))
      return keys
    },
    [recentHits]
  )

  useEffect(
    function () {
      activeRow.current?.scrollIntoView({ block: 'nearest' })
    },
    [activeIndex, items]
  )

  useEffect(
    function () {
      if (!isOpen || !isFileMode) return
      if (isCommandPrefix || isLinePrefix) {
        setSearchHits([])
        return
      }
      if (!trimmed || roots.length === 0) {
        setSearchHits([])
        return
      }
      const generation = ++searchGeneration.current
      const timer = window.setTimeout(function () {
        void (async function () {
          try {
            const hits = (await WorkspaceFiles.search(roots, trimmed, 50)).hits.map(function (hit) {
              return {
                absolute: hit.path,
                name: hit.name,
                relative: hit.relative
              }
            })
            if (generation !== searchGeneration.current) return
            setSearchHits(hits)
            setActiveIndex(0)
          } catch (error) {
            console.error('[command-palette] 搜索文件失败', error)
            if (generation !== searchGeneration.current) return
            setSearchHits([])
          }
        })()
      }, 120)
      return function () {
        window.clearTimeout(timer)
        searchGeneration.current += 1
      }
    },
    [isOpen, isFileMode, isCommandPrefix, isLinePrefix, trimmed, roots, rootsKey]
  )

  function reset() {
    useCodeStore.getState().toSetPaletteMode(null)
    setQuery('')
    setActiveIndex(0)
    setSearchHits([])
  }

  async function activateItem(index: number) {
    const item = items[index]
    if (!item) return
    if (item.kind === 'command') {
      reset()
      await runCommand(item.command.id)
      return
    }
    if (item.kind === 'line') {
      const store = useCodeStore.getState()
      const active = store.tabs.find(function (tab) {
        return tab.id === activeTabId
      })
      reset()
      if (active?.kind === 'file') {
        store.toRequestReveal({ path: active.path, line: item.line, column: 1 })
      }
      return
    }
    const hit = item.hit
    const store = useCodeStore.getState()
    if (hit.isOpen) {
      const tab = store.tabs.find(function (item) {
        return item.kind === 'file' && isSamePath(item.path, hit.absolute)
      })
      reset()
      if (tab) {
        store.toActivateTab(tab.id)
        store.toRequestReveal(null)
        store.toPushRecentPath(hit.absolute)
      }
      return
    }
    reset()
    await openAbsolutePath(hit.absolute)
  }

  /** 结果分组标题：命令按 `group`，文件按「已打开 / 最近 / 其他」 */
  function sectionOf(item: PaletteItem): string {
    if (item.kind === 'command') return item.command.group ?? '命令'
    if (item.kind === 'line') return '跳转'
    if (item.hit.isOpen) return '已打开'
    if (recentKeys.has(hitKey(item.hit.absolute))) return '最近'
    return '其他文件'
  }

  function keyOf(item: PaletteItem): string {
    if (item.kind === 'command') return item.command.id
    if (item.kind === 'line') return 'line'
    return item.hit.absolute
  }

  const placeholder = isFileMode
    ? isLinePrefix
      ? '输入行号后回车跳转…'
      : isCommandPrefix
        ? '输入命令…'
        : roots.length > 1
          ? `搜索 ${roots.length} 个工作区…`
          : roots[0]
            ? `搜索 ${findFileName(roots[0])}…`
            : '搜索文件…'
    : '输入命令…'

  const isCommandMode = !isFileMode || isCommandPrefix
  const modeLabel = isLinePrefix ? '行号' : isCommandMode ? '命令' : '文件'
  const modeIcon = isLinePrefix
    ? 'lucide:corner-down-right'
    : isCommandMode
      ? 'lucide:terminal'
      : 'lucide:search'
  const hintText = isLinePrefix
    ? '行号跳转'
    : isCommandMode
      ? '执行命令'
      : '输入 > 切换命令、: 跳转行号'

  return (
    <Dialog
      open={isOpen}
      onOpenChange={function (open) {
        if (!open) reset()
      }}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          'top-[18%] w-full max-w-[38rem] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-[38rem]',
          // Dialog 内容区自带 padding 与 16px 间距，这里清零，让三节各自贴边
          '[&>[data-slot=dialog-body]]:gap-0 [&>[data-slot=dialog-body]]:px-0 [&>[data-slot=dialog-body]]:pb-0'
        )}>
        <DialogHeader className="sr-only">
          <DialogTitle>{isFileMode ? '转到文件' : '命令面板'}</DialogTitle>
          <DialogDescription>
            {isFileMode ? '已打开 / 最近 / 跨工作区搜索' : '搜索并执行命令'}
          </DialogDescription>
        </DialogHeader>
        <div className="border-border/60 flex items-center gap-2.5 border-b px-3.5">
          <Icon
            icon={modeIcon}
            className="text-muted-foreground/70 size-4 shrink-0"
          />
          <Input
            autoFocus
            value={query}
            placeholder={placeholder}
            aria-label={isFileMode ? '搜索文件' : '搜索命令'}
            aria-activedescendant={itemCount > 0 ? `palette-item-${activeIndex}` : undefined}
            className="h-11 flex-1 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
            onChange={function (event) {
              setQuery(event.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={function (event) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex(function (prev) {
                  return itemCount === 0 ? 0 : (prev + 1) % itemCount
                })
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex(function (prev) {
                  return itemCount === 0 ? 0 : (prev - 1 + itemCount) % itemCount
                })
              } else if (event.key === 'Enter') {
                event.preventDefault()
                void activateItem(activeIndex)
              }
            }}
          />
          <span className="bg-muted text-muted-foreground shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] leading-none">
            {modeLabel}
          </span>
        </div>
        <ul
          role="listbox"
          aria-label={isFileMode ? '文件结果' : '命令结果'}
          className="max-h-[min(24rem,58vh)] overflow-y-auto overscroll-contain p-1.5">
          {items.map(function (item, index) {
            const isActive = index === activeIndex
            const section = sectionOf(item)
            const previous = index > 0 ? sectionOf(items[index - 1]) : null
            const shortcuts = item.kind === 'command' ? shortcutLabels(item.command.id) : null
            return (
              <Fragment key={keyOf(item)}>
                {section !== previous ? (
                  <li
                    role="presentation"
                    className={cn(
                      'text-muted-foreground/70 px-2.5 pb-1 text-[11px] font-medium tracking-wide',
                      index === 0 ? 'pt-1' : 'pt-2.5'
                    )}>
                    {section}
                  </li>
                ) : null}
                <li
                  ref={isActive ? activeRow : undefined}
                  id={`palette-item-${index}`}
                  role="option"
                  aria-selected={isActive}
                  className={cn(ROW_BASE, isActive ? ROW_ACTIVE : ROW_IDLE)}
                  onMouseEnter={function () {
                    setActiveIndex(index)
                  }}
                  onClick={function () {
                    void activateItem(index)
                  }}>
                  {item.kind === 'line' ? (
                    <Fragment>
                      <Icon
                        icon="lucide:corner-down-right"
                        className="text-muted-foreground/70 size-3.5 shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate">跳转到第 {item.line} 行</span>
                    </Fragment>
                  ) : null}
                  {item.kind === 'command' ? (
                    <Fragment>
                      <span className="min-w-0 flex-1 truncate">{item.command.title}</span>
                      {shortcuts ? <ShortcutKeys labels={shortcuts} /> : null}
                    </Fragment>
                  ) : null}
                  {item.kind === 'file' ? (
                    <Fragment>
                      <Icon
                        icon="lucide:file"
                        className="text-muted-foreground/70 size-3.5 shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate">{item.hit.name}</span>
                      {item.hit.isDirty ? (
                        <span className="shrink-0 rounded-sm bg-amber-500/10 px-1 text-[10px] leading-4 text-amber-600 dark:text-amber-400">
                          未保存
                        </span>
                      ) : item.hit.isOpen ? (
                        <span className="bg-primary/10 text-primary shrink-0 rounded-sm px-1 text-[10px] leading-4">
                          已打开
                        </span>
                      ) : null}
                      <span className="text-muted-foreground/70 max-w-[45%] shrink-0 truncate text-[11px]">
                        {item.hit.rootName ? `${item.hit.rootName} / ` : ''}
                        {item.hit.relative}
                      </span>
                    </Fragment>
                  ) : null}
                </li>
              </Fragment>
            )
          })}
          {itemCount === 0 ? (
            <li
              role="presentation"
              className="flex flex-col items-center gap-2 px-2 py-10">
              <Icon
                icon="lucide:search-x"
                className="text-muted-foreground/40 size-5"
              />
              <span className="text-muted-foreground text-[13px]">没有匹配项</span>
            </li>
          ) : null}
        </ul>
        <div className="border-border/60 text-muted-foreground flex items-center gap-3 border-t px-3.5 py-2 text-[11px]">
          <span className="min-w-0 flex-1 truncate">{hintText}</span>
          <span className="flex shrink-0 items-center gap-1">
            <Kbd className="h-4 min-w-4 px-1 text-[10px] font-normal">↑</Kbd>
            <Kbd className="h-4 min-w-4 px-1 text-[10px] font-normal">↓</Kbd>
            <span className="ml-0.5">选择</span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <Kbd className="h-4 min-w-4 px-1 text-[10px] font-normal">↵</Kbd>
            <span>打开</span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <Kbd className="h-4 min-w-4 px-1 text-[10px] font-normal">Esc</Kbd>
            <span>关闭</span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { CommandPalette }
