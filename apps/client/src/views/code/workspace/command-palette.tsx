import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { Input } from '@cogito/design/components/input'
import { cn } from 'cn'
import { useEffect, useMemo, useState } from 'react'

import { findCommands, runCommand } from '@/keyboard/commands'
import type { Command } from '@/keyboard/types'
import { useCodeStore } from '@/stores/code'
import {
  joinPath,
  listWorkspaceEntries,
  searchWorkspaceFiles,
  type SearchHit
} from '@/views/code/lib/fs.ts'
import { openAbsolutePath } from '@/views/code/lib/open-file.ts'

async function listShallowFiles(root: string): Promise<SearchHit[]> {
  const entries = await listWorkspaceEntries(root, '')
  const dirEntries = entries.filter(function (entry) {
    return entry.isDirectory
  })
  // 各子目录的浅层列举互不依赖：并行取回，再按原顺序拼装（保留 40 条上限）
  const nested = await Promise.all(
    dirEntries.map(async function (entry) {
      const children = await listWorkspaceEntries(root, entry.path)
      return children
        .filter(function (child) {
          return !child.isDirectory
        })
        .map(function (child) {
          return {
            name: child.name,
            relative: child.path,
            absolute: joinPath(root, child.path)
          }
        })
    })
  )

  const files: SearchHit[] = []
  let dirIndex = 0
  for (const entry of entries) {
    const batch = entry.isDirectory
      ? (nested[dirIndex++] ?? [])
      : [
          {
            name: entry.name,
            relative: entry.path,
            absolute: joinPath(root, entry.path)
          }
        ]
    for (const hit of batch) {
      files.push(hit)
      if (files.length >= 40) return files
    }
  }
  return files
}

function CommandPalette() {
  const paletteMode = useCodeStore(function (state) {
    return state.paletteMode
  })
  const workspaceRoot = useCodeStore(function (state) {
    return state.workspaceRoot
  })
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [fileHits, setFileHits] = useState<SearchHit[]>([])

  const isOpen = paletteMode !== null
  const isFileMode = paletteMode === 'file'

  const commands = useMemo(
    function () {
      if (!isOpen || isFileMode) return [] as Command[]
      return findCommands(query)
    },
    [isOpen, isFileMode, query]
  )

  const visibleFileHits = isOpen && isFileMode ? fileHits : []
  const itemCount = isFileMode ? visibleFileHits.length : commands.length

  useEffect(
    function () {
      if (!isOpen || !isFileMode || !workspaceRoot) return
      let cancelled = false
      const timer = window.setTimeout(function () {
        void (async function () {
          const hits = query.trim()
            ? await searchWorkspaceFiles({ root: workspaceRoot, query, limit: 50 })
            : await listShallowFiles(workspaceRoot)
          if (cancelled) return
          setFileHits(hits)
          setActiveIndex(0)
        })()
      }, 120)
      return function () {
        cancelled = true
        window.clearTimeout(timer)
      }
    },
    [isOpen, isFileMode, query, workspaceRoot]
  )

  async function activateItem(index: number) {
    if (isFileMode) {
      const hit = visibleFileHits[index]
      if (!hit) return
      useCodeStore.getState().toSetPaletteMode(null)
      setQuery('')
      setActiveIndex(0)
      setFileHits([])
      await openAbsolutePath(hit.absolute)
      return
    }
    const command = commands[index]
    if (!command) return
    useCodeStore.getState().toSetPaletteMode(null)
    setQuery('')
    setActiveIndex(0)
    await runCommand(command.id)
  }

  function closePalette() {
    useCodeStore.getState().toSetPaletteMode(null)
    setQuery('')
    setActiveIndex(0)
    setFileHits([])
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={function (open) {
        if (!open) closePalette()
      }}>
      <DialogContent className="top-[20%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{isFileMode ? '转到文件' : '命令面板'}</DialogTitle>
          <DialogDescription>
            {isFileMode ? '按文件名快速打开' : '搜索并执行命令'}
          </DialogDescription>
        </DialogHeader>
        <div className="border-border border-b p-2">
          <Input
            autoFocus
            value={query}
            placeholder={isFileMode ? '搜索文件…' : '输入命令…'}
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
        </div>
        <ul
          role="listbox"
          className="max-h-72 overflow-y-auto p-1">
          {isFileMode
            ? visibleFileHits.map(function (hit, index) {
                return (
                  <li key={hit.absolute}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      className={cn(
                        'flex w-full flex-col rounded-md px-2 py-1.5 text-left text-sm',
                        index === activeIndex ? 'bg-muted' : 'hover:bg-muted/60'
                      )}
                      onMouseEnter={function () {
                        setActiveIndex(index)
                      }}
                      onClick={function () {
                        void activateItem(index)
                      }}>
                      <span className="text-foreground">{hit.name}</span>
                      <span className="text-muted-foreground truncate text-xs">{hit.relative}</span>
                    </button>
                  </li>
                )
              })
            : commands.map(function (command, index) {
                return (
                  <li key={command.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      className={cn(
                        'w-full rounded-md px-2 py-1.5 text-left text-sm',
                        index === activeIndex ? 'bg-muted' : 'hover:bg-muted/60'
                      )}
                      onMouseEnter={function () {
                        setActiveIndex(index)
                      }}
                      onClick={function () {
                        void activateItem(index)
                      }}>
                      {command.title}
                    </button>
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
