import { toast } from 'sonner'

import { ensureMonacoLanguage } from '@/lib/monaco-language.ts'
import { useCodeStore } from '@/stores/code'
import { readCodeFile } from '@/views/code/lib/fs.ts'
import { findLanguageId } from '@/views/code/lib/language.ts'
import { findModel, findOrCreateModel } from '@/views/code/lib/monaco-models.ts'
import { isSamePath } from '@/views/code/lib/path.ts'

/**
 * 打开文件：模型已在内存时直接激活，不再读盘。
 * 之前「先读盘 → findOrCreateModel」会用磁盘内容覆盖未保存缓冲区（真 bug）。
 */
async function openAbsolutePath(absolutePath: string): Promise<void> {
  try {
    if (!findModel(absolutePath)) {
      // 语言贡献必须在建 model 之前注册（monaco 每个语言只处理一次「首次遇见」）
      await ensureMonacoLanguage(findLanguageId(absolutePath))
      const content = await readCodeFile(absolutePath)
      findOrCreateModel(absolutePath, content)
    }
    const store = useCodeStore.getState()
    store.toOpenTab({
      path: absolutePath,
      language: findLanguageId(absolutePath)
    })
    store.toPushRecentPath(absolutePath)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '打开文件失败')
  }
}

/**
 * 只登记标签：不读正文、不建 model、不抢激活态。
 *
 * 首屏恢复用（对齐 VS Code 的 `ModelService` 按需创建）：8 个 tab 的工作区
 * 只读当前那一个的全文，其余等用户点开时由 `MonacoHost` 的惰性读路径补上。
 * 不抢激活态是关键：`toOpenTab` 会激活，依次恢复 N 个就等于读 N 次全文。
 */
function registerTabWithoutContent(absolutePath: string): void {
  useCodeStore.getState().toRegisterTab({
    path: absolutePath,
    language: findLanguageId(absolutePath)
  })
}

/** 磁盘已更改 → 用户点「重新加载」：显式覆盖缓冲区 */
async function reloadFromDisk(absolutePath: string): Promise<void> {
  const content = await readCodeFile(absolutePath)
  findOrCreateModel(absolutePath, content, { force: true })
  const store = useCodeStore.getState()
  const tab = store.tabs.find(function (item) {
    return item.kind === 'file' && isSamePath(item.path, absolutePath)
  })
  if (tab) store.toMarkDirty(tab.id, false)
}

/**
 * 打开文件并定位到指定行列（搜索结果、问题列表跳转）。
 * 行列在这里先夹到有效范围，模型切换完成后由 MonacoHost 落实。
 */
async function revealLocation(absolutePath: string, line: number, column: number): Promise<void> {
  await openAbsolutePath(absolutePath)
  const model = findModel(absolutePath)
  if (!model) return
  const safeLine = Math.min(Math.max(1, line), Math.max(1, model.getLineCount()))
  const safeColumn = Math.min(Math.max(1, column), model.getLineMaxColumn(safeLine))
  useCodeStore
    .getState()
    .toRequestReveal({ path: absolutePath, line: safeLine, column: safeColumn })
}

export { openAbsolutePath, registerTabWithoutContent, reloadFromDisk, revealLocation }
