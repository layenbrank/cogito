/**
 * 每个 tab 的编辑器视图状态（滚动位置、选区、折叠）。
 *
 * 多 tab 共用一个 editor 实例，切模型时 Monaco 会重置这些状态；
 * 这里按 path 暂存，切回来再恢复。
 */
import type * as monaco from 'monaco-editor'

const statesByPath = new Map<string, monaco.editor.ICodeEditorViewState | null>()

function saveViewState(path: string, editor: monaco.editor.IStandaloneCodeEditor): void {
  statesByPath.set(path, editor.saveViewState())
}

function restoreViewState(path: string, editor: monaco.editor.IStandaloneCodeEditor): void {
  const state = statesByPath.get(path)
  if (state) {
    editor.restoreViewState(state)
    return
  }
  // 首次打开：回到顶部而不是沿用上一个文件的滚动位置
  editor.setScrollTop(0)
  editor.setScrollLeft(0)
}

function dropViewState(path: string): void {
  statesByPath.delete(path)
}

function clearViewStates(): void {
  statesByPath.clear()
}

export { saveViewState, restoreViewState, dropViewState, clearViewStates }
