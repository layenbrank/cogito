/**
 * 当前代码窗的 editor 实例句柄。
 *
 * 命令面板 / 快捷键拿不到 React ref，但需要触发编辑器内置动作（查找、替换等）；
 * Monaco 同一时刻只挂一个代码 editor，所以用一个模块级引用即可。
 */
import type * as monaco from 'monaco-editor'

let activeEditor: monaco.editor.IStandaloneCodeEditor | null = null

function attachEditor(editor: monaco.editor.IStandaloneCodeEditor): void {
  activeEditor = editor
}

function detachEditor(editor: monaco.editor.IStandaloneCodeEditor): void {
  if (activeEditor === editor) activeEditor = null
}

function findActiveEditor(): monaco.editor.IStandaloneCodeEditor | null {
  return activeEditor
}

/** 触发编辑器内置动作；返回是否成功触发 */
function runEditorAction(actionID: string): boolean {
  const editor = activeEditor
  if (!editor) return false
  const action = editor.getAction(actionID)
  if (!action) return false
  editor.focus()
  void action.run()
  return true
}

export { attachEditor, detachEditor, findActiveEditor, runEditorAction }
