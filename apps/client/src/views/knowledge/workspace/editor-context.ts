/**
 * 编辑器 ↔ 对话坞 / 左栏的桥：坞要读「当前文档/选区」，也要能把结果写回去；
 * 左栏文件树在工作区外渲染时，打开路径也走这里（带脏检查）。
 *
 * 为什么用模块级单值：编辑器实例在 TipTap 里，坞与左栏在另一棵树上；
 * 这条桥只需要「读一次、写一次」，不需要订阅。
 */
import { openPath } from '@/views/knowledge/lib/session.ts'

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
  write: (text: string) => void
  /** 带未保存确认的打开；左栏文件树在工作区外渲染时走这里 */
  openPath?: (path: string) => void
  /** 大纲跳转到文档位置 */
  jumpToPos?: (pos: number) => void
}

const EMPTY: EditorContext = { path: null, content: '', selection: '' }

let bridge: EditorBridge | null = null

function rememberEditorBridge(next: EditorBridge | null): void {
  bridge = next
}

function findEditorContext(): EditorContext {
  return bridge?.findContext() ?? EMPTY
}

/** 返回 false 表示当前没有可写的编辑器（坞据此提示而不是静默失败） */
function writeEditor(text: string): boolean {
  if (!bridge || !text.trim()) return false
  bridge.write(text)
  return true
}

/** 左栏点开文件：优先走工作区守卫（脏检查）；桥未挂上时直接打开 */
function openEditorPath(path: string): void {
  if (bridge?.openPath) {
    bridge.openPath(path)
    return
  }
  void openPath(path)
}

function jumpEditorPos(pos: number): void {
  bridge?.jumpToPos?.(pos)
}

export { findEditorContext, jumpEditorPos, openEditorPath, rememberEditorBridge, writeEditor }
export type { EditorBridge, EditorContext }
