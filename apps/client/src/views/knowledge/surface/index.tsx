/**
 * 知识库左侧栏：浏览（文件树）| 文档 | 待发布 | 任务 | 设置。
 *
 * 定位：与右栏、编辑器组成最多三列；库级操作与文件树共用一栏，用 tabs 切换，
 * 不再并排叠「库面板 + 文件树」两列。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useEffect } from 'react'

import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { useKnowledgeStore } from '@/stores/knowledge'
import { openEditorPath } from '@/views/knowledge/workspace/editor-context.ts'
import { Overlay } from '@/views/knowledge/workspace/overlay/index.ts'
import { DocsTab } from '@/views/knowledge/surface/docs.tsx'
import { SettingsTab } from '@/views/knowledge/surface/settings.tsx'
import { StagingTab } from '@/views/knowledge/surface/staging.tsx'
import { useSurfaceStore, type RailTab } from '@/views/knowledge/surface/store.ts'
import { TasksTab } from '@/views/knowledge/surface/tasks.tsx'

const TABS: readonly { key: RailTab; label: string; icon: string }[] = [
  { key: 'browse', label: '浏览', icon: 'lucide:folder-tree' },
  { key: 'docs', label: '库', icon: 'lucide:library-big' },
  { key: 'staging', label: '待发布', icon: 'lucide:sparkles' },
  { key: 'tasks', label: '任务', icon: 'lucide:timer' },
  { key: 'settings', label: '设置', icon: 'lucide:settings-2' }
]

function KnowledgeSurface() {
  const isOpen = useKnowledgeStore(function (state) {
    return state.isSidebarOpen
  })
  const tab = useSurfaceStore(function (state) {
    return state.tab
  })
  const toSetTab = useSurfaceStore(function (state) {
    return state.toSetTab
  })
  const toOpenAside = useSurfaceStore(function (state) {
    return state.toOpenAside
  })
  const refresh = useKnowledgeBaseStore(function (state) {
    return state.refresh
  })
  const staging = useKnowledgeBaseStore(function (state) {
    return state.staging
  })

  // 打开时对一次库：磁盘上外部改动的文档在 autoUpdate 打开时会被 upsert 进来
  useEffect(
    function () {
      if (!isOpen) return
      void refresh()
    },
    [isOpen, refresh]
  )

  if (!isOpen) return null

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-background">
      <div className="flex items-center gap-0.5 border-b border-border px-1 py-1">
        {TABS.map(function (item) {
          const isActive = item.key === tab
          return (
            <Button
              key={item.key}
              type="button"
              size="sm"
              variant="ghost"
              className={clsx(
                'h-7 gap-1 px-1.5 text-[11px] font-normal',
                isActive && 'bg-muted'
              )}
              title={item.label}
              onClick={function () {
                toSetTab(item.key)
              }}>
              <Icon
                icon={item.icon}
                className="size-3.5"
              />
              <span className="hidden min-[220px]:inline">{item.label}</span>
              {item.key === 'staging' && staging.length > 0 ? (
                <span className="text-amber-600 dark:text-amber-400">{staging.length}</span>
              ) : null}
            </Button>
          )
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {tab === 'browse' ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <Overlay.Navigation onOpenPath={openEditorPath} />
          </div>
        ) : null}
        {tab === 'docs' ? (
          <div className="flex min-h-0 flex-1 flex-col p-2">
            <DocsTab />
          </div>
        ) : null}
        {tab === 'staging' ? (
          <div className="flex min-h-0 flex-1 flex-col p-2">
            <StagingTab />
          </div>
        ) : null}
        {tab === 'tasks' ? (
          <div className="flex min-h-0 flex-1 flex-col p-2">
            <TasksTab />
          </div>
        ) : null}
        {tab === 'settings' ? (
          <div className="flex min-h-0 flex-1 flex-col p-2">
            <SettingsTab />
          </div>
        ) : null}
      </div>

      <div className="border-t border-border px-2 py-1.5">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 w-full justify-start gap-1.5 px-1.5 text-[11px] font-normal"
          onClick={function () {
            toOpenAside('assistant')
          }}>
          <Icon
            icon="lucide:sparkles"
            className="size-3.5"
          />
          让助手帮忙（不跳页）
        </Button>
      </div>
    </aside>
  )
}

export { KnowledgeSurface }
