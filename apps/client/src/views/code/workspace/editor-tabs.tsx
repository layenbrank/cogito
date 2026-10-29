import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { cn } from 'cn'
import { useCallback, type MouseEvent } from 'react'
import { toast } from 'sonner'

import { ContextMenu, type MenuItem } from '@/components/contextmenu'
import { useCodeStore } from '@/stores/code'
import { requestCloseTabs } from '@/views/code/lib/close-tabs.ts'
import { CODE_MENU_CLASS_NAMES } from '@/views/code/lib/context-menu.ts'
import { isPathInsideRoot } from '@/views/code/lib/path.ts'
import { findFileIcon } from '@/views/workspace/overlay/file-icon.ts'

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

  /** 在系统文件管理器中选中并显示该文件（Windows 资源管理器 / macOS Finder） */
  const revealInExplorer = useCallback(function (path: string) {
    const root = useCodeStore.getState().workspaceRoot
    if (!root || !path || !isPathInsideRoot(root, path)) {
      toast.error('无法在系统资源管理器中定位该路径')
      return
    }
    void revealItemInDir(path).catch(function (error: unknown) {
      console.error('[code] revealItemInDir failed', path, error)
      toast.error(error instanceof Error ? error.message : '打开系统资源管理器失败')
    })
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
        {
          key: 'close-all',
          label: '关闭所有',
          onSelect() {
            requestCloseTabs(
              tabs.map(function (item) {
                return item.id
              })
            )
          }
        },
        { key: 'divider', type: 'divider' },
        {
          key: 'copy-path',
          label: '复制路径',
          disabled: tab.kind === 'commits',
          onSelect() {
            void navigator.clipboard.writeText(tab.path).then(function () {
              toast.success('已复制路径')
            })
          }
        },
        {
          key: 'reveal',
          label: '在文件资源管理器中显示',
          disabled:
            tab.kind === 'commits' || !tab.path || !useCodeStore.getState().workspaceRoot,
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
      classNames={CODE_MENU_CLASS_NAMES}
      findItems={findTabMenuItems}>
      <div className="grid shrink-0 auto-rows-7 grid-cols-[repeat(auto-fill,minmax(5rem,7.5rem))] items-stretch border-b border-border/50 bg-background/70 backdrop-blur-md">
        {tabs.map(function (tab) {
          const isActive = tab.id === activeTabId
          const fileIcon = findFileIcon(tab.title)
          return (
            <div
              key={tab.id}
              role="tab"
              tabIndex={0}
              data-tab-id={tab.id}
              aria-selected={isActive}
              className={cn(
                'group relative flex min-w-0 cursor-pointer items-center gap-1 border-r border-border/80 px-2 text-xs',
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
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground/80"
                />
              ) : null}
              {tab.kind === 'diff' ? (
                <Icon
                  icon="lucide:git-compare"
                  className="size-2.5 shrink-0 text-muted-foreground"
                  aria-label="差异"
                />
              ) : tab.kind === 'commits' ? (
                <Icon
                  icon="lucide:git-commit-horizontal"
                  className="size-2.5 shrink-0 text-primary"
                  aria-label="提交"
                />
              ) : isActive && isLargeFile ? (
                <Icon
                  icon="lucide:lock"
                  className="size-2.5 shrink-0 text-muted-foreground"
                  aria-label="只读"
                />
              ) : tab.isDirty ? (
                <span
                  className="size-1 shrink-0 rounded-full bg-amber-500"
                  title="未保存"
                  aria-label="未保存"
                />
              ) : (
                <Icon
                  icon={fileIcon.icon}
                  className={cn('size-2.5 shrink-0', fileIcon.className)}
                />
              )}
              <span
                className="min-w-0 flex-1 truncate"
                title={
                  tab.kind === 'diff'
                    ? tab.headOid
                      ? `${tab.path} · ${(tab.baseOid || '∅').slice(0, 7)} ↔ ${tab.headOid.slice(0, 7)}`
                      : `${tab.path} · HEAD ↔ 工作区`
                    : tab.kind === 'commits'
                      ? '搜索提交历史'
                      : tab.path
                }>
                {tab.title}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`关闭 ${tab.title}`}
                title="关闭"
                className={cn(
                  'size-4 shrink-0 rounded-sm border-0 text-muted-foreground opacity-0 hover:bg-destructive/40 hover:text-destructive-foreground group-hover:opacity-100',
                  isActive && 'opacity-60'
                )}
                onClick={function (event) {
                  onClose(tab.id, event)
                }}>
                <Icon
                  icon="lucide:x"
                  className="size-2.5"
                />
              </Button>
            </div>
          )
        })}
      </div>
    </ContextMenu>
  )
}

export { EditorTabs }
