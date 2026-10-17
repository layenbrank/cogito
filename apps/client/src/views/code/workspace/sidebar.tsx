import { Icon } from '@iconify/react/offline'
import { Input } from '@i-thinking/design/components/input'
import { cn } from 'cn'
import { useEffect, useState } from 'react'

import { useCodeStore } from '@/stores/code'
import { searchWorkspaceFiles, type SearchHit } from '@/views/code/lib/fs.ts'
import { openAbsolutePath } from '@/views/code/lib/open-file.ts'
import Navigation from '@/views/code/workspace/overlay/navigation.tsx'

function SidebarHeader(props: { title: string }) {
  return (
    <div className="border-border/60 text-muted-foreground flex h-7 shrink-0 items-center px-3 text-xs font-semibold tracking-wider uppercase">
      {props.title}
    </div>
  )
}

function SearchView() {
  const workspaceRoot = useCodeStore(function (state) {
    return state.workspaceRoot
  })
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const trimmed = query.trim()
  const visibleHits = trimmed ? hits : []

  useEffect(
    function () {
      if (!workspaceRoot || !trimmed) return
      let cancelled = false
      const timer = window.setTimeout(function () {
        setIsSearching(true)
        void searchWorkspaceFiles({ root: workspaceRoot, query: trimmed })
          .then(function (next) {
            if (!cancelled) setHits(next)
          })
          .finally(function () {
            if (!cancelled) setIsSearching(false)
          })
      }, 200)
      return function () {
        cancelled = true
        window.clearTimeout(timer)
      }
    },
    [trimmed, workspaceRoot]
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <Input
        value={query}
        placeholder="按文件名搜索…"
        aria-label="按文件名搜索"
        className="h-8"
        onChange={function (event) {
          setQuery(event.target.value)
        }}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isSearching ? (
          <p className="text-muted-foreground px-1 text-xs">搜索中…</p>
        ) : null}
        {!isSearching && trimmed && visibleHits.length === 0 ? (
          <p className="text-muted-foreground px-1 text-xs">无匹配文件</p>
        ) : null}
        <ul className="space-y-0.5">
          {visibleHits.map(function (hit) {
            return (
              <li key={hit.absolute}>
                <button
                  type="button"
                  className="hover:bg-muted w-full truncate rounded-sm px-1.5 py-1 text-left text-xs"
                  title={hit.relative}
                  onClick={function () {
                    void openAbsolutePath(hit.absolute)
                  }}>
                  <span className="text-foreground">{hit.name}</span>
                  <span className="text-muted-foreground ml-1">{hit.relative}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function ScmView() {
  return (
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs">
      <Icon
        icon="lucide:git-branch"
        className="size-8 opacity-40"
      />
      <p>源代码管理尚未接入</p>
      <p>后续将显示 Git 状态与变更</p>
    </div>
  )
}

function Sidebar() {
  const sidebarView = useCodeStore(function (state) {
    return state.sidebarView
  })
  const isSidebarOpen = useCodeStore(function (state) {
    return state.isSidebarOpen
  })

  if (!isSidebarOpen) return null

  const title =
    sidebarView === 'explorer' ? '资源管理器' : sidebarView === 'search' ? '搜索' : '源代码管理'

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-r border-border/50 bg-background/65 backdrop-blur-md'
      )}>
      <SidebarHeader title={title} />
      <div className="min-h-0 flex-1 overflow-hidden">
        {sidebarView === 'explorer' ? <Navigation /> : null}
        {sidebarView === 'search' ? <SearchView /> : null}
        {sidebarView === 'scm' ? <ScmView /> : null}
      </div>
    </aside>
  )
}

export { Sidebar }
