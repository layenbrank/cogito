/**
 * 右栏文本预览的 Monaco 实例登记处。
 *
 * 右栏自己收下了 Ctrl/Cmd+F（`aside.tsx` 里的 `useShortcut` 压在 `AGENT_FIND` 的兜底处理器
 * 前面），这一键不会再冒去开「搜索整个会话」。但也正因为它在派发器里被 `preventDefault()`，
 * 不能再指望编辑器的 keybinding 自己响应 —— 那一键已经被消费掉了。
 *
 * 所以把「打开编辑器自带的查找框」显式交回给编辑器实例：右栏收下按键，再转交给它。
 */

import type * as Monaco from 'monaco-editor/editor/editor.api'

type AsideEditor = Monaco.editor.IStandaloneCodeEditor

/** 当前挂着的编辑器：右栏一次只开一个文本预览 */
let activeEditor: AsideEditor | null = null

/** 管理器生命周期：挂载时登记、卸载时清掉（避免指针留在已销毁的实例上） */
function setAsideFindEditor(editor: AsideEditor | null): void {
  activeEditor = editor
}

/**
 * 打开（或聚焦）编辑器自带的查找框。
 *
 * 没有编辑器时返回 `false`，调用方据此决定是否只是吞掉这一键。
 * 动作 id 用 `actions.find`（Monaco 的 StartFindAction）；个别构建里只有内部名，故留一条回退。
 */
function openAsideEditorFind(): boolean {
  const editor = activeEditor
  if (!editor) return false
  const action =
    editor.getAction('actions.find') ?? editor.getAction('editor.action.startFindAction')
  if (!action) return false
  void action.run()
  return true
}

export { openAsideEditorFind, setAsideFindEditor }
