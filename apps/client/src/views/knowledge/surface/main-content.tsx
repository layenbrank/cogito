/**
 * 主区内容：对齐 llm_wiki ContentArea。
 * 显隐勿同时写 flex + hidden（Tailwind 同属性后写覆盖，编辑器会盖住设置）。
 */
import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Fallback } from '@/components/fallback/index.ts'
import { GraphTab } from '@/views/knowledge/surface/graph.tsx'
import { LintTab } from '@/views/knowledge/surface/lint.tsx'
import { ReviewTab } from '@/views/knowledge/surface/review.tsx'
import { SearchTab } from '@/views/knowledge/surface/search.tsx'
import { SettingsTab } from '@/views/knowledge/surface/settings.tsx'
import { SourcesMain } from '@/views/knowledge/surface/sources-main.tsx'
import { findLayoutVisibility } from '@/views/knowledge/surface/layout-visibility.ts'
import type { RailTabCanonical } from '@/views/knowledge/surface/store.ts'
import { TOOL_SHELL } from '@/views/knowledge/surface/tool-surface.tsx'
import KnowledgeWorkspace from '@/views/knowledge/workspace/markdown.tsx'

interface KnowledgeMainContentProps {
  tab: RailTabCanonical
}

function ToolShell(props: { children: ReactNode }) {
  return <div className={TOOL_SHELL}>{props.children}</div>
}

function MainPane(props: { isActive: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'min-h-0 min-w-0',
        props.isActive ? 'flex flex-1 flex-col' : 'hidden',
        props.className
      )}
      aria-hidden={!props.isActive}>
      {props.children}
    </div>
  )
}

function KnowledgeMainContent(props: KnowledgeMainContentProps) {
  const visibility = findLayoutVisibility(props.tab)

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <MainPane
        isActive={props.tab === 'settings'}
        className="bg-background">
        <SettingsTab />
      </MainPane>

      <MainPane isActive={props.tab === 'sources'}>
        <SourcesMain />
      </MainPane>

      <MainPane isActive={props.tab === 'search'}>
        <ToolShell>
          <SearchTab />
        </ToolShell>
      </MainPane>

      <MainPane isActive={props.tab === 'graph'}>
        <ToolShell>
          <GraphTab />
        </ToolShell>
      </MainPane>

      <MainPane isActive={props.tab === 'lint'}>
        <ToolShell>
          <LintTab />
        </ToolShell>
      </MainPane>

      <MainPane isActive={props.tab === 'review'}>
        <ToolShell>
          <ReviewTab />
        </ToolShell>
      </MainPane>

      <div
        className={cn(
          'min-h-0 min-w-0',
          visibility.showEditor
            ? 'flex h-full flex-1 flex-col'
            : 'pointer-events-none absolute inset-0 hidden'
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
