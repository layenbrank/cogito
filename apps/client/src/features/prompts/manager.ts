/**
 * 提示词库弹窗的开关状态。
 *
 * 为什么是模块级而不是 Context：入口在输入框触发器面板里，而那个面板会在
 * 触发器关闭时整棵卸载 —— 弹窗若挂在面板内部，一开就跟着没了。把开关放外面，
 * 弹窗挂在聊天页（`chat.tsx`），面板只负责「打开」。
 */
import { useSyncExternalStore } from 'react'

let isOpen = false
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return function unsubscribe() {
    listeners.delete(listener)
  }
}

function getSnapshot(): boolean {
  return isOpen
}

function setPromptManagerOpen(next: boolean): void {
  if (isOpen === next) return
  isOpen = next
  for (const listener of listeners) listener()
}

function openPromptManager(): void {
  setPromptManagerOpen(true)
}

function usePromptManagerOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export { openPromptManager, setPromptManagerOpen, usePromptManagerOpen }
