import { toast } from 'sonner'

import { useCodeStore } from '@/stores/code'
import { readCodeFile } from '@/views/code/lib/fs.ts'
import { findLanguageId } from '@/views/code/lib/language.ts'
import { findOrCreateModel } from '@/views/code/lib/monaco-models.ts'

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

export { openAbsolutePath }
