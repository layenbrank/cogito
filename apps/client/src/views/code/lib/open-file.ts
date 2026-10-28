import { toast } from 'sonner'

import { useCodeStore } from '@/stores/code'
import { readCodeFile } from '@/views/code/lib/fs.ts'
import { findLanguageId } from '@/views/code/lib/language.ts'
import { findModel, findOrCreateModel } from '@/views/code/lib/monaco-models.ts'

async function openAbsolutePath(absolutePath: string): Promise<void> {
  try {
    const content = await readCodeFile(absolutePath)
    findOrCreateModel(absolutePath, content)
    useCodeStore.getState().toOpenTab({
      path: absolutePath,
      language: findLanguageId(absolutePath)
    })
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '打开文件失败')
  }
}

/**
 * 打开文件并定位到指定行列（搜索结果、问题列表跳转）。
 * 行列在这里先夹到有效范围，模型切换完成后由 MonacoHost 落实。
 */
async function revealLocation(
  absolutePath: string,
  line: number,
  column: number
): Promise<void> {
  await openAbsolutePath(absolutePath)
  const model = findModel(absolutePath)
  if (!model) return
  const safeLine = Math.min(Math.max(1, line), Math.max(1, model.getLineCount()))
  const safeColumn = Math.min(Math.max(1, column), model.getLineMaxColumn(safeLine))
  useCodeStore.getState().toRequestReveal({ path: absolutePath, line: safeLine, column: safeColumn })
}

export { openAbsolutePath, revealLocation }
