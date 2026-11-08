/**
 * 知识库右侧栏：大纲 | AI | 深度研究（同一 Splitter 列内 tabs）。
 * 非活动面板用 inert + 切走前 blur，避免 aria-hidden 盖住仍聚焦的 Composer。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'

import { AgentDock, useDockStore } from '@/features/agent/dock'
import { useKnowledgeStore } from '@/stores/knowledge'
import { t } from '@/views/knowledge/locale.ts'
import {
  RETRIEVAL_MODE_OPTIONS,
  readRetrievalMode,
  writeRetrievalMode,
  type RetrievalMode
} from '@/views/knowledge/lib/retrieval-mode.ts'
import { ResearchPanel } from '@/views/knowledge/surface/research.tsx'
import { useSurfaceStore, type AsideTab } from '@/views/knowledge/surface/store.ts'
import { jumpEditorPos } from '@/views/knowledge/workspace/editor-context.ts'
import Outline from '@/views/knowledge/workspace/overlay/outline.tsx'
import { PageLinks } from '@/views/knowledge/workspace/overlay/page-links.tsx'

const ASIDE_TABS: readonly { key: AsideTab; label: string; icon: string }[] = [
  { key: 'outline', label: t('OUTLINE'), icon: 'lucide:list-tree' },
  { key: 'assistant', label: 'AI', icon: 'lucide:sparkles' },
  { key: 'research', label: '研究', icon: 'lucide:microscope' }
]

function blurFocusedInside(host: HTMLElement | null) {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return
  if (!host?.contains(active)) return
  active.blur()
}

function KnowledgeAside() {
  const isOpen = useKnowledgeStore(function (state) {
    return state.isOutlineOpen
  })
  const isFocusMode = useKnowledgeStore(function (state) {
    return state.isFocusMode
  })
  const asideTab = useSurfaceStore(function (state) {
    return state.asideTab
  })
  const toSetAsideTab = useSurfaceStore(function (state) {
    return state.toSetAsideTab
  })
  const toCloseAside = useSurfaceStore(function (state) {
    return state.toCloseAside
  })
  const toOpenAside = useSurfaceStore(function (state) {
    return state.toOpenAside
  })
  const isDockOpen = useDockStore(function (state) {
    return state.isOpen
  })
  const [retrievalMode, setRetrievalMode] = useState<RetrievalMode>(function () {
    return readRetrievalMode()
  })

  const rootRef = useRef<HTMLElement | null>(null)
  const outlineRef = useRef<HTMLDivElement | null>(null)
  const assistantRef = useRef<HTMLDivElement | null>(null)
  const researchRef = useRef<HTMLDivElement | null>(null)

  const prevDockOpen = useRef(isDockOpen)
  useEffect(
    function () {
      const wasOpen = prevDockOpen.current
      prevDockOpen.current = isDockOpen
      // Dock 打开 → 右栏切到 AI；Dock 关闭只退回大纲，不拆掉整列右栏
      if (isDockOpen && !wasOpen) {
        toOpenAside('assistant')
        return
      }
      if (!isDockOpen && wasOpen && asideTab === 'assistant' && isOpen) {
        toSetAsideTab('outline')
      }
    },
    [isDockOpen, asideTab, isOpen, toOpenAside, toSetAsideTab]
  )

  useEffect(
    function () {
      if (asideTab !== 'outline') blurFocusedInside(outlineRef.current)
      if (asideTab !== 'assistant') blurFocusedInside(assistantRef.current)
      if (asideTab !== 'research') blurFocusedInside(researchRef.current)
    },
    [asideTab]
  )

  useEffect(
    function () {
      if (!isOpen) blurFocusedInside(rootRef.current)
    },
    [isOpen]
  )

  if (isFocusMode) return null

  function selectTab(next: AsideTab) {
    if (asideTab === 'assistant' && next !== 'assistant') {
      blurFocusedInside(assistantRef.current)
    }
    if (asideTab === 'outline' && next !== 'outline') {
      blurFocusedInside(outlineRef.current)
    }
    if (asideTab === 'research' && next !== 'research') {
      blurFocusedInside(researchRef.current)
    }
    toSetAsideTab(next)
  }

  function closeAside() {
    blurFocusedInside(rootRef.current)
    toCloseAside()
  }

  return (
    <aside
      ref={rootRef}
      aria-hidden={!isOpen}
      inert={!isOpen ? true : undefined}
      className="bg-background flex h-full min-h-0 w-full flex-col">
      <div className="border-border flex items-center gap-1 border-b px-2 py-1.5">
        <div
          role="tablist"
          aria-label="右栏视图"
          className="bg-muted/55 flex min-w-0 flex-1 items-center gap-0.5 rounded-lg p-0.5">
          {ASIDE_TABS.map(function (item) {
            const isActive = item.key === asideTab
            return (
              <Button
                key={item.key}
                type="button"
                size="sm"
                variant="ghost"
                role="tab"
                aria-selected={isActive}
                className={clsx(
                  'h-7 flex-1 gap-1 px-1.5 text-[11px] font-medium transition-colors',
                  isActive
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={function () {
                  selectTab(item.key)
                }}>
                <Icon
                  icon={item.icon}
                  className="size-3.5"
                />
                {item.label}
              </Button>
            )
          })}
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground h-7 shrink-0 px-1.5"
          title="收起侧栏"
          onClick={closeAside}>
          <Icon
            icon="lucide:panel-right-close"
            className="size-3.5"
          />
        </Button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={outlineRef}
          className={clsx(
            'absolute inset-0 flex min-h-0 flex-col',
            asideTab === 'outline' ? 'z-10' : 'pointer-events-none z-0 opacity-0'
          )}
          aria-hidden={asideTab !== 'outline'}
          inert={asideTab !== 'outline' ? true : undefined}>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-[1.2]">
              <Outline onJump={jumpEditorPos} />
            </div>
            <div className="min-h-0 flex-1 border-t border-border">
              <p className="text-muted-foreground px-3 py-1.5 text-xs font-medium">Page Links</p>
              <PageLinks />
            </div>
          </div>
        </div>
        <div
          ref={assistantRef}
          className={clsx(
            'absolute inset-0 flex min-h-0 flex-col',
            asideTab === 'assistant' ? 'z-10' : 'pointer-events-none z-0 opacity-0'
          )}
          aria-hidden={asideTab !== 'assistant'}
          inert={asideTab !== 'assistant' ? true : undefined}>
          <div className="border-border/60 flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
            <span className="text-muted-foreground shrink-0 text-[11px]">检索</span>
            <Select
              value={retrievalMode}
              items={RETRIEVAL_MODE_OPTIONS.map(function (option) {
                return { value: option.id, label: option.label }
              })}
              onValueChange={function (value) {
                if (typeof value !== 'string') return
                if (value !== 'standard' && value !== 'smart' && value !== 'faithful') return
                setRetrievalMode(value)
                writeRetrievalMode(value)
              }}>
              <SelectTrigger className="h-7 flex-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RETRIEVAL_MODE_OPTIONS.map(function (option) {
                  return (
                    <SelectItem
                      key={option.id}
                      value={option.id}
                      className="text-xs">
                      {option.label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
          <AgentDock
            embedded
            className="w-full border-l-0"
          />
        </div>
        <div
          ref={researchRef}
          className={clsx(
            'absolute inset-0 flex min-h-0 flex-col',
            asideTab === 'research' ? 'z-10' : 'pointer-events-none z-0 opacity-0'
          )}
          aria-hidden={asideTab !== 'research'}
          inert={asideTab !== 'research' ? true : undefined}>
          <ResearchPanel embedded />
        </div>
      </div>
    </aside>
  )
}

export { KnowledgeAside }
