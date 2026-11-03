/**
 * 主区内容：对齐 llm_wiki ContentArea。
 * Wiki → TipTap；工具视图 → 全宽面板；设置单独全页。
 */
import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Fallback } from '@/components/fallback/index.ts'
import { ActivityTab } from '@/views/knowledge/surface/activity.tsx'
import { GraphTab } from '@/views/knowledge/surface/graph.tsx'
import { LintTab } from '@/views/knowledge/surface/lint.tsx'
import { ResearchTab } from '@/views/knowledge/surface/research.tsx'
import { ReviewTab } from '@/views/knowledge/surface/review.tsx'
import { SearchTab } from '@/views/knowledge/surface/search.tsx'
import { SettingsTab } from '@/views/knowledge/surface/settings.tsx'
import { SourcesMain } from '@/views/knowledge/surface/sources-main.tsx'
import { findLayoutVisibility } from '@/views/knowledge/surface/layout-visibility.ts'
import type { RailTabCanonical } from '@/views/knowledge/surface/store.ts'
import KnowledgeWorkspace from '@/views/knowledge/workspace/markdown.tsx'

interface KnowledgeMainContentProps {
  tab: RailTabCanonical
}

function ToolShell(props: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col p-4">{props.children}</div>
}

function KnowledgeMainContent(props: KnowledgeMainContentProps) {
  const visibility = findLayoutVisibility(props.tab)

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          props.tab === 'settings' ? 'p-4' : 'hidden'
        )}
        aria-hidden={props.tab !== 'settings'}>
        <SettingsTab />
      </div>

      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          props.tab === 'sources' ? '' : 'hidden'
        )}
        aria-hidden={props.tab !== 'sources'}>
        <SourcesMain />
      </div>

      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          props.tab === 'search' ? '' : 'hidden'
        )}
        aria-hidden={props.tab !== 'search'}>
        <ToolShell>
          <SearchTab />
        </ToolShell>
      </div>

      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          props.tab === 'graph' ? '' : 'hidden'
        )}
        aria-hidden={props.tab !== 'graph'}>
        <ToolShell>
          <GraphTab />
        </ToolShell>
      </div>

      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          props.tab === 'lint' ? '' : 'hidden'
        )}
        aria-hidden={props.tab !== 'lint'}>
        <ToolShell>
          <LintTab />
        </ToolShell>
      </div>

      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          props.tab === 'review' ? '' : 'hidden'
        )}
        aria-hidden={props.tab !== 'review'}>
        <ToolShell>
          <ReviewTab />
        </ToolShell>
      </div>

      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          props.tab === 'research' ? '' : 'hidden'
        )}
        aria-hidden={props.tab !== 'research'}>
        <ToolShell>
          <ResearchTab />
        </ToolShell>
      </div>

      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          props.tab === 'activity' ? '' : 'hidden'
        )}
        aria-hidden={props.tab !== 'activity'}>
        <ToolShell>
          <ActivityTab />
        </ToolShell>
      </div>

      <div
        className={cn(
          'flex h-full min-h-0 min-w-0 flex-1 flex-col',
          visibility.showEditor ? '' : 'pointer-events-none absolute inset-0 hidden'
        )}
        aria-hidden={!visibility.showEditor}>
        <Fallback.ErrorBoundary
          title="Markdown 编辑器出现问题"
          subTitle="编辑器遇到意外错误。可重试恢复，或刷新页面。">
          <KnowledgeWorkspace />
        </Fallback.ErrorBoundary>
      </div>
    </div>
  )
}

export { KnowledgeMainContent }
