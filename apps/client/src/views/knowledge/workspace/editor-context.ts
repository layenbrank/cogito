/**
 * 编辑器 ↔ 对话坞 / 左栏的桥。
 * 打开路径：由 bridge.openPath（含脏检查）在确认后再切 Wiki + 记 previewReturnTab。
 */
import { openPath } from '@/views/knowledge/lib/session.ts'
import { useSurfaceStore } from '@/views/knowledge/surface/store.ts'

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

/** 打开成功路径上调用：记 return 并切到 wiki（勿在脏确认前调用） */
function commitWikiReveal(): void {
  const surface = useSurfaceStore.getState()
  if (surface.tab === 'wiki') return
  surface.toCommitPreviewOpen(surface.tab)
}

/**
 * 左栏 / 检索 / 图谱等点开文件。
 * 有 bridge 时由 handleOpenPath 在确认后再切 wiki；无 bridge 时直接提交。
 */
function openEditorPath(path: string): void {
  if (bridge?.openPath) {
    bridge.openPath(path)
    return
  }
  commitWikiReveal()
  void openPath(path)
}

function jumpEditorPos(pos: number): void {
  bridge?.jumpToPos?.(pos)
}

export {
  commitWikiReveal,
  findEditorContext,
  jumpEditorPos,
  openEditorPath,
  rememberEditorBridge,
  writeEditor
}
export type { EditorBridge, EditorContext }
