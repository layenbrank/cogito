/**
 * 知识库右侧栏：大纲 | AI 助手（tabs 互斥，同一列）。
 *
 * 对齐 Notion / Obsidian / Cursor 笔记侧栏：AI 占右栏，不与大纲并排再开一列。
 * 切到大纲时仍挂载对话坞（隐藏），会话不丢——与 dock「折叠不卸载」一致。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useEffect, useRef } from 'react'

import { AgentDock, useDockStore } from '@/features/agent/dock'
import { useKnowledgeStore } from '@/stores/knowledge'
import { t } from '@/views/knowledge/locale.ts'
import { useSurfaceStore, type AsideTab } from '@/views/knowledge/surface/store.ts'
import { jumpEditorPos } from '@/views/knowledge/workspace/editor-context.ts'
import Outline from '@/views/knowledge/workspace/overlay/outline.tsx'

const ASIDE_TABS: readonly { key: AsideTab; label: string; icon: string }[] = [
  { key: 'outline', label: t('OUTLINE'), icon: 'lucide:list-tree' },
  { key: 'assistant', label: 'AI', icon: 'lucide:sparkles' }
]

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

  // 其它入口（工具条 AI、库「生成」、Ctrl+J）只开 dock：这里把右栏跟过去
  const prevDockOpen = useRef(isDockOpen)
  useEffect(
    function () {
      const wasOpen = prevDockOpen.current
      prevDockOpen.current = isDockOpen
      if (isDockOpen && !wasOpen) {
        toOpenAside('assistant')
      }
      if (!isDockOpen && wasOpen && asideTab === 'assistant' && isOpen) {
        // 坞自己关掉时：若还停在 AI 页，一并收起右栏
        toCloseAside()
      }
    },
    [isDockOpen, asideTab, isOpen, toOpenAside, toCloseAside]
  )

  // 专注模式卸掉；普通收起由父级零宽折叠，这里继续挂载以保留会话
  if (isFocusMode) return null

  return (
    <aside
      aria-hidden={!isOpen}
      className="flex h-full min-h-0 w-full flex-col bg-background">
      <div className="flex items-center gap-1 border-b border-border px-1 py-1">
        {ASIDE_TABS.map(function (item) {
          const isActive = item.key === asideTab
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
                toSetAsideTab(item.key)
                if (item.key === 'assistant') {
                  useDockStore.getState().toOpen()
                } else {
                  useDockStore.getState().toClose()
                }
              }}>
              <Icon
                icon={item.icon}
                className="size-3.5"
              />
              {item.label}
            </Button>
          )
        })}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto h-7 px-1.5"
          title="收起侧栏"
          onClick={toCloseAside}>
          <Icon
            icon="lucide:panel-right-close"
            className="size-3.5"
          />
        </Button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          className={clsx(
            'absolute inset-0 flex min-h-0 flex-col',
            asideTab === 'outline' ? 'z-10' : 'pointer-events-none z-0 opacity-0'
          )}
          aria-hidden={asideTab !== 'outline'}>
          <Outline onJump={jumpEditorPos} />
        </div>
        <div
          className={clsx(
            'absolute inset-0 flex min-h-0 flex-col',
            asideTab === 'assistant' ? 'z-10' : 'pointer-events-none z-0 opacity-0'
          )}
          aria-hidden={asideTab !== 'assistant'}>
          <AgentDock
            embedded
            className="w-full border-l-0"
          />
        </div>
      </div>
    </aside>
  )
}

export { KnowledgeAside }
