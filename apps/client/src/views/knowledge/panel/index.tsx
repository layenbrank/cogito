/**
 * 知识库左面板：文档 / 待发布 / 任务 / 设置。
 *
 * 定位：**不再有弹出层**。库级操作全在这四页里就地完成；AI 相关在右侧对话坞。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useEffect } from 'react'

import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { useDockStore } from '@/features/agent/dock'
import { DocsTab } from '@/views/knowledge/panel/docs.tsx'
import { SettingsTab } from '@/views/knowledge/panel/settings.tsx'
import { StagingTab } from '@/views/knowledge/panel/staging.tsx'
import { usePanelStore, type PanelTab } from '@/views/knowledge/panel/store.ts'
import { TasksTab } from '@/views/knowledge/panel/tasks.tsx'

const TABS: readonly { key: PanelTab; label: string; icon: string }[] = [
  { key: 'docs', label: '文档', icon: 'lucide:files' },
  { key: 'staging', label: '待发布', icon: 'lucide:sparkles' },
  { key: 'tasks', label: '任务', icon: 'lucide:timer' },
  { key: 'settings', label: '设置', icon: 'lucide:settings-2' }
]

function KnowledgePanel() {
  const isOpen = usePanelStore(function (state) {
    return state.isOpen
  })
  const tab = usePanelStore(function (state) {
    return state.tab
  })
  const toClose = usePanelStore(function (state) {
    return state.toClose
  })
  const toSetTab = usePanelStore(function (state) {
    return state.toSetTab
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
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-background">
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
              onClick={function () {
                toSetTab(item.key)
              }}>
              <Icon
                icon={item.icon}
                className="size-3.5"
              />
              {item.label}
              {item.key === 'staging' && staging.length > 0 ? (
                <span className="text-amber-600 dark:text-amber-400">{staging.length}</span>
              ) : null}
            </Button>
          )
        })}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto h-7 px-1.5"
          title="收起面板"
          onClick={toClose}>
          <Icon
            icon="lucide:panel-left-close"
            className="size-3.5"
          />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-2">
        {tab === 'docs' ? <DocsTab /> : null}
        {tab === 'staging' ? <StagingTab /> : null}
        {tab === 'tasks' ? <TasksTab /> : null}
        {tab === 'settings' ? <SettingsTab /> : null}
      </div>

      <div className="border-t border-border px-2 py-1.5">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 w-full justify-start gap-1.5 px-1.5 text-[11px] font-normal"
          onClick={function () {
            useDockStore.getState().toToggle()
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

export { KnowledgePanel }
