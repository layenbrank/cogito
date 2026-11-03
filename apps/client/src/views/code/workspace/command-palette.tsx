import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { Input } from '@cogito/design/components/input'
import { cn } from 'cn'
import { useEffect, useMemo, useRef, useState } from 'react'

import { findCommands, runCommand } from '@/keyboard/commands'
import type { Command } from '@/keyboard/types'
import { WorkspaceFiles } from '@/lib/workspace-files'
import { useCodeStore } from '@/stores/code'
import { findFileName, findRelativePath, isPathInsideRoot, isSamePath } from '@/views/code/lib/path.ts'
import { openAbsolutePath } from '@/views/code/lib/open-file.ts'
import { mergeFileHits, type FileHit } from '@/views/code/workspace/file-hits.ts'

type PaletteItem =
  | { kind: 'file'; hit: FileHit }
  | { kind: 'line'; line: number }
  | { kind: 'command'; command: Command }

function includesQuery(hit: FileHit, query: string): boolean {
  if (!query) return true
  const needle = query.toLowerCase()
  return (
    hit.name.toLowerCase().includes(needle) || hit.relative.toLowerCase().includes(needle)
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
            const hits = (await WorkspaceFiles.search(roots, trimmed, 50)).hits.map(
              function (hit) {
                return {
                  absolute: hit.path,
                  name: hit.name,
                  relative: hit.relative
                }
              }
            )
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

  return (
    <Dialog
      open={isOpen}
      onOpenChange={function (open) {
        if (!open) reset()
      }}>
      <DialogContent className="top-[20%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{isFileMode ? '转到文件' : '命令面板'}</DialogTitle>
          <DialogDescription>
            {isFileMode ? '已打开 / 最近 / 跨工作区搜索' : '搜索并执行命令'}
          </DialogDescription>
        </DialogHeader>
        <div className="border-border border-b p-2">
          <Input
            autoFocus
            value={query}
            placeholder={placeholder}
            aria-label={isFileMode ? '搜索文件' : '搜索命令'}
            className="h-9 border-0 shadow-none focus-visible:ring-0"
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
          {isFileMode ? (
            <p className="text-muted-foreground px-1 pt-1.5 text-[10px]">
              {isCommandPrefix
                ? '命令模式'
                : isLinePrefix
                  ? '行号跳转'
                  : '空查询显示「已打开」「最近」；输入 > 切命令、: 跳行'}
            </p>
          ) : null}
        </div>
        <ul
          role="listbox"
          className="max-h-72 overflow-y-auto p-1">
          {items.map(function (item, index) {
            if (item.kind === 'line') {
              return (
                <li key="line">
                  <Button
                    variant="ghost"
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={cn(
                      'h-auto w-full justify-start rounded-md px-2 py-1.5 text-left text-sm',
                      index === activeIndex ? 'bg-muted' : 'hover:bg-muted/60'
                    )}
                    onClick={function () {
                      void activateItem(index)
                    }}>
                    跳转到第 {item.line} 行
                  </Button>
                </li>
              )
            }
            if (item.kind === 'command') {
              return (
                <li key={item.command.id}>
                  <Button
                    variant="ghost"
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={cn(
                      'h-auto w-full justify-start rounded-md px-2 py-1.5 text-left text-sm',
                      index === activeIndex ? 'bg-muted' : 'hover:bg-muted/60'
                    )}
                    onMouseEnter={function () {
                      setActiveIndex(index)
                    }}
                    onClick={function () {
                      void activateItem(index)
                    }}>
                    {item.command.title}
                  </Button>
                </li>
              )
            }
            const hit = item.hit
            return (
              <li key={hit.absolute}>
                <Button
                  variant="ghost"
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={cn(
                    'flex h-auto w-full flex-col items-start justify-start rounded-md px-2 py-1.5 text-left text-sm',
                    index === activeIndex ? 'bg-muted' : 'hover:bg-muted/60'
                  )}
                  onMouseEnter={function () {
                    setActiveIndex(index)
                  }}
                  onClick={function () {
                    void activateItem(index)
                  }}>
                  <span className="text-foreground flex w-full items-center gap-1.5 truncate">
                    <span className="truncate">{hit.name}</span>
                    {hit.isOpen ? (
                      <span className="text-primary shrink-0 text-[10px]">已打开</span>
                    ) : null}
                    {hit.isDirty ? (
                      <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400">
                        未保存
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground w-full truncate text-xs">
                    {hit.rootName ? `${hit.rootName} / ` : ''}
                    {hit.relative}
                  </span>
                </Button>
              </li>
            )
          })}
          {itemCount === 0 ? (
            <li className="text-muted-foreground px-2 py-6 text-center text-sm">无匹配项</li>
          ) : null}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

export { CommandPalette }
