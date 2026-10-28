/**
 * 编辑器 ↔ 对话坞的桥：坞要读「当前文档/选区」，也要能把结果写回去。
 *
 * 为什么用模块级单值：编辑器实例在 TipTap 里，坞在另一个组件树上；两者没有共同的
 * provider，而这条桥只需要「读一次、写一次」，不需要订阅。
 */
interface EditorContext {
  /** 当前文档相对路径；没打开文档时为 null */
  path: string | null
  /** 当前正文（纯文本） */
  content: string
  /** 选中文字；没有选区时为空串 */
  selection: string
}

interface EditorBridge {
  findContext: () => EditorContext
  /** 有选区就替换选区，否则插到光标处（一次操作 = 一步撤销） */
  apply: (text: string) => void
}

const EMPTY: EditorContext = { path: null, content: '', selection: '' }

let bridge: EditorBridge | null = null

function setEditorBridge(next: EditorBridge | null): void {
  bridge = next
}

function findEditorContext(): EditorContext {
  return bridge?.findContext() ?? EMPTY
}

/** 返回 false 表示当前没有可写的编辑器（坞据此提示而不是静默失败） */
function applyToEditor(text: string): boolean {
  if (!bridge || !text.trim()) return false
  bridge.apply(text)
  return true
}

export { applyToEditor, findEditorContext, setEditorBridge }
export type { EditorBridge, EditorContext }
