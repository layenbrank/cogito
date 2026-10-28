/**
 * 关闭标签的统一入口。
 *
 * 关闭要同时做两件事：销毁 Monaco model、从 store 移除 tab；有未保存更改时
 * 先挂起让 `CloseConfirmDialog` 收口，避免各调用点各写一套 `window.confirm`。
 */
import { useCodeStore } from '@/stores/code'
import { disposeModel } from '@/views/code/lib/monaco-models.ts'

/** 直接关闭（不询问），并销毁对应 model */
function closeTabs(ids: string[]): void {
  const store = useCodeStore.getState()
  for (const id of ids) {
    const tab = store.tabs.find(function (item) {
      return item.id === id
    })
    if (!tab) continue
    disposeModel(tab.path)
    useCodeStore.getState().toCloseTab(id)
  }
}

/** 用户发起关闭：脏标签挂起等确认，干净的立刻关 */
function requestCloseTabs(ids: string[]): void {
  const store = useCodeStore.getState()
  const dirty = ids.filter(function (id) {
    const tab = store.tabs.find(function (item) {
      return item.id === id
    })
    return Boolean(tab?.isDirty)
  })
  if (dirty.length === 0) {
    closeTabs(ids)
    return
  }
  store.toSetPendingClose(dirty)
}

function confirmPendingClose(): void {
  const ids = useCodeStore.getState().pendingCloseIds
  useCodeStore.getState().toSetPendingClose([])
  closeTabs(ids)
}

function cancelPendingClose(): void {
  useCodeStore.getState().toSetPendingClose([])
}

export { closeTabs, requestCloseTabs, confirmPendingClose, cancelPendingClose }
