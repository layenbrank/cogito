/**
 * 库页右栏：洞察 | AI（tabs 互斥，同一列）。
 *
 * 原先「卡片 | 洞察 | 旁挂 AI」三列过宽；用 tabs 收成两列。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'

import { AgentDock, useDockStore } from '@/features/agent/dock'
import { LibraryInsights } from '@/views/directive/library/insights.tsx'
import type { LibraryMetrics } from '@/views/directive/library/metrics.ts'

type AsideTab = 'insights' | 'assistant'

interface LibraryAsideProps {
  metrics: LibraryMetrics
  onOpen: (name: string) => void
  onFocusRun?: (id: string) => void
}

function LibraryAside(props: LibraryAsideProps) {
  const [tab, setTab] = useState<AsideTab>('insights')
  const isDockOpen = useDockStore(function (state) {
    return state.isOpen
  })

  const prevDockOpen = useRef(isDockOpen)
  useEffect(
    function () {
      const wasOpen = prevDockOpen.current
      prevDockOpen.current = isDockOpen
      if (isDockOpen && !wasOpen) setTab('assistant')
      if (!isDockOpen && wasOpen && tab === 'assistant') setTab('insights')
    },
    [isDockOpen, tab]
  )

  return (
    <aside className="flex min-h-0 w-80 max-w-[min(24rem,42%)] min-w-72 shrink-0 flex-col self-stretch border-l border-border bg-background md:w-[22rem] xl:w-96 xl:max-w-[min(24rem,40%)]">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-1 py-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={clsx(
            'h-7 gap-1 px-1.5 text-[11px] font-normal',
            tab === 'insights' && 'bg-muted'
          )}
          onClick={function () {
            setTab('insights')
            useDockStore.getState().toClose()
          }}>
          <Icon
            icon="lucide:chart-column"
            className="size-3.5"
          />
          洞察
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
            'absolute inset-0 overflow-y-auto',
            tab === 'insights' ? 'z-10' : 'pointer-events-none z-0 opacity-0'
          )}
          aria-hidden={tab !== 'insights'}>
          <div className="bg-muted px-3 py-3">
            <LibraryInsights
              metrics={props.metrics}
              onOpen={props.onOpen}
              onFocusRun={props.onFocusRun}
            />
          </div>
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

export { LibraryAside }
