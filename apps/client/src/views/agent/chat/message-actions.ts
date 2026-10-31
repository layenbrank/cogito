/**
 * Agent 消息操作条的桌面实现：剪贴板与另存为走 Tauri 插件。
 *
 * WebView 里 `navigator.clipboard` / `<a download>` 对长文与落盘不可靠
 * （复制截断、导出无感），与诊断页同一套 `clipboard-manager` + `dialog.save`。
 */
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import type { AssistantActions } from '@cogito/design/assistant/actions'

async function copyText(text: string): Promise<void> {
  await writeText(text)
}

async function exportMarkdown(text: string, filename: string): Promise<void> {
  const target = await save({
    defaultPath: filename,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  })
  if (!target) return
  await writeTextFile(target, text)
}

const ASSISTANT_ACTIONS_TAURI: AssistantActions = {
  copyText,
  exportMarkdown
}

export { ASSISTANT_ACTIONS_TAURI }
