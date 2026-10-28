import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'
import { useCallback, type MouseEvent } from 'react'
import { toast } from 'sonner'

import { ContextMenu, type MenuItem } from '@/components/contextmenu'
import { useCodeStore } from '@/stores/code'
import { requestCloseTabs } from '@/views/code/lib/close-tabs.ts'
import { findParentDir, findRelativePath, isPathInsideRoot } from '@/views/code/lib/path.ts'

function EditorTabs() {
  const tabs = useCodeStore(function (state) {
    return state.tabs
  })
  const activeTabId = useCodeStore(function (state) {
    return state.activeTabId
  })
  const isLargeFile = useCodeStore(function (state) {
    return state.isLargeFile
  })

  function onActivate(id: string) {
    useCodeStore.getState().toActivateTab(id)
  }

  function onClose(id: string, event?: MouseEvent) {
    event?.stopPropagation()
    requestCloseTabs([id])
  }

  /** 在资源管理器里展开到该文件所在目录 */
  const revealInExplorer = useCallback(function (path: string) {
    const store = useCodeStore.getState()
    store.toSetSidebarView('explorer')
    if (!store.isSidebarOpen) store.toToggleSidebar()
    const root = store.workspaceRoot
    if (!root || !isPathInsideRoot(root, path)) return
    store.toRevealPath(findParentDir(findRelativePath(root, path)))
  }, [])

  const findTabMenuItems = useCallback(
    function (trigger: Element): MenuItem[] {
      const tabID = trigger.getAttribute('data-tab-id')
      if (!tabID) return []
      const index = tabs.findIndex(function (tab) {
        return tab.id === tabID
      })
      const tab = tabs[index]
      if (!tab) return []
      return [
        {
          key: 'close',
          label: '关闭',
          onSelect() {
            requestCloseTabs([tabID])
          }
        },
        {
          key: 'close-others',
          label: '关闭其他',
          disabled: tabs.length <= 1,
          onSelect() {
            requestCloseTabs(
              tabs
                .filter(function (item) {
                  return item.id !== tabID
                })
                .map(function (item) {
                  return item.id
                })
            )
          }
        },
        {
          key: 'close-right',
          label: '关闭右侧',
          disabled: index === tabs.length - 1,
          onSelect() {
            requestCloseTabs(
              tabs.slice(index + 1).map(function (item) {
                return item.id
              })
            )
          }
        },
        { key: 'divider', type: 'divider' },
        {
          key: 'copy-path',
          label: '复制路径',
          onSelect() {
            void navigator.clipboard.writeText(tab.path).then(function () {
              toast.success('已复制路径')
            })
          }
        },
        {
          key: 'reveal',
          label: '在资源管理器中显示',
          disabled: !useCodeStore.getState().workspaceRoot,
          onSelect() {
            revealInExplorer(tab.path)
          }
        }
      ]
    },
    [tabs, revealInExplorer]
  )

  if (tabs.length === 0) {
    return null
  }

  return (
    <ContextMenu
      trigger="[data-tab-id]"
      findItems={findTabMenuItems}>
      <div className="flex h-8.75 shrink-0 items-stretch gap-0 overflow-x-auto border-b border-border/50 bg-background/70 backdrop-blur-md">
        {tabs.map(function (tab) {
          const isActive = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              role="tab"
              tabIndex={0}
              data-tab-id={tab.id}
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
            {isActive && isLargeFile ? (
              <Icon
                icon="lucide:lock"
                className="text-muted-foreground size-3 shrink-0"
                aria-label="只读"
              />
            ) : tab.isDirty ? (
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
          requestCloseTabs(
            useCodeStore.getState().tabs.map(function (tab) {
              return tab.id
            })
          )
        }}>
        <Icon
          icon="lucide:x"
          className="size-3.5"
        />
      </Button>
      </div>
    </ContextMenu>
  )
}

export { EditorTabs }
