/**
 * 编排右栏：检查器 | AI（tabs 互斥，同一列）。
 *
 * 对齐 knowledge Aside：AI 不另开第四列；切走 AI 时仍挂载对话坞（隐藏），会话不丢。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'

import { AgentDock, useDockStore } from '@/features/agent/dock'
import { Inspector } from '@/views/directive/orchestrator/inspector/inspector.tsx'
import type { DirectiveContent } from '@/views/directive/model/types.ts'

type AsideTab = 'inspector' | 'assistant'

interface InspectorAsideProps {
  draft: DirectiveContent
  selectedToken: string | null
  onChange: (next: DirectiveContent) => void
}

function InspectorAside(props: InspectorAsideProps) {
  const [tab, setTab] = useState<AsideTab>('inspector')
  const isDockOpen = useDockStore(function (state) {
    return state.isOpen
  })

  const prevDockOpen = useRef(isDockOpen)
  useEffect(
    function () {
      const wasOpen = prevDockOpen.current
      prevDockOpen.current = isDockOpen
      if (isDockOpen && !wasOpen) setTab('assistant')
      if (!isDockOpen && wasOpen && tab === 'assistant') setTab('inspector')
    },
    [isDockOpen, tab]
  )

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l bg-background">
      <div className="flex items-center gap-1 border-b border-border px-1 py-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={clsx(
            'h-7 gap-1 px-1.5 text-[11px] font-normal',
            tab === 'inspector' && 'bg-muted'
          )}
          onClick={function () {
            setTab('inspector')
            useDockStore.getState().toClose()
          }}>
          <Icon
            icon="lucide:panel-right"
            className="size-3.5"
          />
          检查器
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={clsx(
            'h-7 gap-1 px-1.5 text-[11px] font-normal',
            tab === 'assistant' && 'bg-muted'
          )}
          onClick={function () {
            setTab('assistant')
            useDockStore.getState().toOpen()
          }}>
          <Icon
            icon="lucide:sparkles"
            className="size-3.5"
          />
          AI
        </Button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          className={clsx(
            'absolute inset-0 flex min-h-0 flex-col',
            tab === 'inspector' ? 'z-10' : 'pointer-events-none z-0 opacity-0'
          )}
          aria-hidden={tab !== 'inspector'}>
          <Inspector
            draft={props.draft}
            selectedToken={props.selectedToken}
            onChange={props.onChange}
          />
        </div>
        <div
          className={clsx(
            'absolute inset-0 flex min-h-0 flex-col',
            tab === 'assistant' ? 'z-10' : 'pointer-events-none z-0 opacity-0'
          )}
          aria-hidden={tab !== 'assistant'}>
          <AgentDock
            embedded
            className="w-full border-l-0"
          />
        </div>
      </div>
    </aside>
  )
}

export { InspectorAside }
