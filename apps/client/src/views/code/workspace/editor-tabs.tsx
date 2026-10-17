import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { cn } from 'cn'
import type { MouseEvent } from 'react'
import { toast } from 'sonner'

import { useCodeStore } from '@/stores/code'
import { disposeModel } from '@/views/code/lib/monaco-models.ts'

function EditorTabs() {
  const tabs = useCodeStore(function (state) {
    return state.tabs
  })
  const activeTabId = useCodeStore(function (state) {
    return state.activeTabId
  })

  function onActivate(id: string) {
    useCodeStore.getState().toActivateTab(id)
  }

  function onClose(id: string, event?: MouseEvent) {
    event?.stopPropagation()
    const tab = useCodeStore.getState().tabs.find(function (item) {
      return item.id === id
    })
    if (!tab) return
    if (tab.isDirty) {
      const confirmed = window.confirm(`「${tab.title}」有未保存更改，确定关闭？`)
      if (!confirmed) return
    }
    disposeModel(tab.path)
    useCodeStore.getState().toCloseTab(id)
  }

  if (tabs.length === 0) {
    return null
  }

  return (
    <div className="flex h-8.75 shrink-0 items-stretch gap-0 overflow-x-auto border-b border-border/50 bg-background/70 backdrop-blur-md">
      {tabs.map(function (tab) {
        const isActive = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            role="tab"
            tabIndex={0}
            aria-selected={isActive}
            className={cn(
              'group relative flex max-w-48 shrink-0 cursor-pointer items-center gap-1.5 border-r border-border/80 px-3 text-sm',
              isActive
                ? 'bg-background text-foreground'
                : 'text-muted-foreground/70 hover:bg-muted/40 hover:text-foreground/90'
            )}
            onClick={function () {
              onActivate(tab.id)
            }}
            onMouseDown={function (event) {
              if (event.button === 1) {
                event.preventDefault()
                onClose(tab.id)
              }
            }}
            onKeyDown={function (event) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onActivate(tab.id)
              }
            }}>
            {isActive ? (
              <span
                aria-hidden
                className="bg-foreground/80 absolute inset-x-0 bottom-0 h-0.5"
              />
            ) : null}
            {tab.isDirty ? (
              <span
                className="size-1.5 shrink-0 rounded-full bg-amber-500"
                title="未保存"
                aria-label="未保存"
              />
            ) : (
              <Icon
                icon="lucide:file"
                className="size-3 shrink-0 opacity-50"
              />
            )}
            <span className="truncate">{tab.title}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`关闭 ${tab.title}`}
              title="关闭"
              className={cn(
                'size-5 shrink-0 rounded-sm opacity-0 group-hover:opacity-100',
                isActive && 'opacity-60'
              )}
              onClick={function (event) {
                onClose(tab.id, event)
              }}>
              <Icon
                icon="lucide:x"
                className="size-3"
              />
            </Button>
          </div>
        )
      })}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="关闭全部"
        title="关闭全部"
        className="text-muted-foreground ml-auto size-6 shrink-0 self-center"
        onClick={function () {
          const dirty = useCodeStore.getState().tabs.some(function (tab) {
            return tab.isDirty
          })
          if (dirty) {
            const confirmed = window.confirm('有未保存更改，确定关闭全部标签？')
            if (!confirmed) return
          }
          const paths = useCodeStore.getState().tabs.map(function (tab) {
            return tab.path
          })
          for (const path of paths) {
            disposeModel(path)
          }
          for (const tab of [...useCodeStore.getState().tabs]) {
            useCodeStore.getState().toCloseTab(tab.id)
          }
          toast.message('已关闭全部标签')
        }}>
        <Icon
          icon="lucide:x"
          className="size-3.5"
        />
      </Button>
    </div>
  )
}

export { EditorTabs }
