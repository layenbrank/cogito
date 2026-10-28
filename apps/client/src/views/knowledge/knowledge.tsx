import { Suspense, lazy } from 'react'

import { Decorations } from '@/components/decorations/index.ts'
import { Fallback } from '@/components/fallback/index.ts'
import { AgentDock } from '@/features/agent/dock'
import { useAgentDockCommand } from '@/features/agent/dock/use-dock-command'
import { useKnowledgeStore } from '@/stores/knowledge'
import { KnowledgeCaptionBegin } from '@/views/knowledge/caption/begin.tsx'
import { KnowledgeCaptionFinal } from '@/views/knowledge/caption/final.tsx'
import { KnowledgePanel } from '@/views/knowledge/panel/index.tsx'
import { useKnowledgeDockScope } from '@/views/knowledge/workspace/dock-scope.ts'
import Summary from '@/views/knowledge/workspace/overlay/summary.tsx'
import styles from '@/views/knowledge/markdown.module.scss'

const KnowledgeWorkspace = lazy(function () {
  return import('@/views/knowledge/workspace/markdown.tsx')
})

function KnowledgeSkeleton() {
  return (
    <div className="flex h-full min-h-0 animate-pulse flex-col gap-2 p-3">
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="w-40 rounded-md bg-muted" />
        <div className="flex-1 rounded-md bg-muted" />
        <div className="w-32 rounded-md bg-muted" />
      </div>
    </div>
  )
}

/**
 * Markdown 磁贴窗壳：
 * - begin：窗口标题
 * - final：布局开关（侧栏/大纲，对齐 VS Code）+ 应用菜单
 * - section：状态栏
 * - children：工作区（Utility / 侧栏 / 编辑器 / 大纲）
 */
export default function Knowledge() {
  const isFocusMode = useKnowledgeStore(function (state) {
    return state.isFocusMode
  })
  // 对话坞的 scope 跟着窗口走：切磁贴就解绑，不会串上下文
  useKnowledgeDockScope()
  // mod+j 开关对话坞（命令面板里也能搜到）
  useAgentDockCommand()

  return (
    <Decorations
      begin={<KnowledgeCaptionBegin />}
      final={<KnowledgeCaptionFinal />}
      section={isFocusMode ? undefined : <Summary />}
      sectionClassName="justify-stretch gap-0 border-border/50 bg-background/70 p-0 backdrop-blur-md"
      scrollable={false}>
      <div className={styles.workspace}>
        <KnowledgePanel />
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
          <Fallback.ErrorBoundary
            title="Markdown 编辑器出现问题"
            subTitle="编辑器遇到意外错误。可重试恢复，或刷新页面。">
            <Suspense fallback={<KnowledgeSkeleton />}>
              <KnowledgeWorkspace />
            </Suspense>
          </Fallback.ErrorBoundary>
        </div>
        <AgentDock />
      </div>
    </Decorations>
  )
}
