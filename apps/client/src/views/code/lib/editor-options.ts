/**
 * 编辑器偏好 → Monaco IEditorOptions 的纯映射。
 * 字体四项留在 monaco-host.tsx（需要等宽字体栈），这里只处理行为项。
 */
import type * as Monaco from 'monaco-editor'

import type { CodeEditorPrefs } from '@/stores/code'

/**
 * `IEditorOptions` 没声明这四项：
 * - `semanticHighlighting` 只在部分版本的类型里带，运行时 `updateOptions` 认；
 * - `tabSize` / `insertSpaces` 是模型级选项，monaco-host 会另外调
 *   `model.updateOptions`，这里一并带出去方便单点断言。
 */
type EditorOptions = Monaco.editor.IEditorOptions & {
  semanticHighlighting?: { enabled: boolean }
  tabSize?: number
  insertSpaces?: boolean
}

function toEditorOptions(prefs: CodeEditorPrefs): EditorOptions {
  const options: EditorOptions = {
    wordWrap: prefs.wordWrap,
    minimap: { enabled: prefs.isMinimapEnabled },
    stickyScroll: { enabled: prefs.isStickyScrollEnabled },
    renderWhitespace: prefs.renderWhitespace,
    guides: { bracketPairs: prefs.isBracketGuidesEnabled },
    semanticHighlighting: { enabled: prefs.isSemanticHighlightingEnabled },
    tabSize: prefs.tabSize,
    insertSpaces: prefs.insertSpaces
  }
  // 只有按宽度换行时列宽才有意义；其余档位忽略，避免误以为设置生效
  if (prefs.wordWrap === 'bounded') options.wordWrapColumn = prefs.wordWrapColumn
  return options
}

export { toEditorOptions }
export type { EditorOptions }
