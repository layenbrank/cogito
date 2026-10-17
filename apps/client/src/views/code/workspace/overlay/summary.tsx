import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { toast } from 'sonner'

import { useCodeStore } from '@/stores/code'

function Summary() {
  const tabs = useCodeStore(function (state) {
    return state.tabs
  })
  const activeTabId = useCodeStore(function (state) {
    return state.activeTabId
  })
  const cursor = useCodeStore(function (state) {
    return state.cursor
  })
  const languageId = useCodeStore(function (state) {
    return state.languageId
  })
  const problemCount = useCodeStore(function (state) {
    return state.problemCount
  })
  const workspaceRoot = useCodeStore(function (state) {
    return state.workspaceRoot
  })

  const activeTab = tabs.find(function (tab) {
    return tab.id === activeTabId
  })

  function onCopyPath() {
    if (!activeTab?.path) return
    void navigator.clipboard.writeText(activeTab.path).then(function () {
      toast.success('已复制路径')
    })
  }

  const workspaceLabel = workspaceRoot
    ? workspaceRoot.split(/[\\/]/).filter(Boolean).pop()
    : '未打开工作区'

  return (
    <div
      className={cn(
        'text-muted-foreground flex h-5.5 w-full min-w-0 items-center justify-between text-xs leading-none'
      )}>
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          className="hover:bg-foreground/5 hover:text-foreground flex max-w-40 items-center gap-1 truncate px-2 py-0.5"
          title={workspaceRoot ?? '未打开工作区'}
          onClick={function () {
            useCodeStore.getState().toSetSidebarView('explorer')
          }}>
          <Icon
            icon="lucide:folder"
            className="size-3 shrink-0 opacity-60"
          />
          <span className="truncate">{workspaceLabel}</span>
        </button>
        <button
          type="button"
          className="hover:bg-foreground/5 hover:text-foreground flex items-center gap-1 px-2 py-0.5"
          onClick={function () {
            useCodeStore.getState().toTogglePanel('problems')
          }}>
          <Icon
            icon="lucide:circle-x"
            className="size-3 shrink-0 opacity-60"
          />
          <span>{problemCount}</span>
          <Icon
            icon="lucide:triangle-alert"
            className="size-3 shrink-0 opacity-60"
          />
          <span>0</span>
        </button>
        {activeTab?.isDirty ? (
          <span className="px-2 text-amber-600 dark:text-amber-400">未保存</span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">
        <button
          type="button"
          className="hover:bg-foreground/5 hover:text-foreground truncate px-2 py-0.5"
          title={activeTab?.path}
          onClick={onCopyPath}>
          {activeTab ? activeTab.title : '—'}
        </button>
        <span className="hover:bg-foreground/5 hover:text-foreground px-2 py-0.5">
          行 {cursor.line}, 列 {cursor.column}
        </span>
        <span className="hover:bg-foreground/5 hover:text-foreground px-2 py-0.5">空格: 2</span>
        <span className="hover:bg-foreground/5 hover:text-foreground px-2 py-0.5">UTF-8</span>
        <span className="hover:bg-foreground/5 hover:text-foreground px-2 py-0.5">LF</span>
        <span className="hover:bg-foreground/5 hover:text-foreground px-2 py-0.5 capitalize">
          {languageId}
        </span>
      </div>
    </div>
  )
}

export default Summary
