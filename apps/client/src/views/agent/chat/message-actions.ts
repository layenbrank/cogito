/**
 * Agent 消息操作条：主窗走 Tauri 插件；嵌套 / 无 Tauri 降级到 Web API，
 * 避免右栏自载时 invoke 报错把预览打断。
 */
import { save } from '@/shared/ipc/dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import type { AssistantActions } from '@cogito/design/assistant/actions'

import { hasTauriRuntime, isEmbeddedShell } from '@/features/window/shell-mode'

async function copyTextTauri(text: string): Promise<void> {
  await writeText(text)
}

async function exportMarkdownTauri(text: string, filename: string): Promise<void> {
  const target = await save({
    defaultPath: filename,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  })
  if (!target) return
  await writeTextFile(target, text)
}

async function copyTextWeb(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  throw new Error('当前环境无法复制到剪贴板')
}

function exportMarkdownWeb(text: string, filename: string): Promise<void> {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = filename
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(href)
  }
  return Promise.resolve()
}

const ASSISTANT_ACTIONS_TAURI: AssistantActions = {
  copyText: copyTextTauri,
  exportMarkdown: exportMarkdownTauri
}

const ASSISTANT_ACTIONS_WEB: AssistantActions = {
  copyText: copyTextWeb,
  exportMarkdown: exportMarkdownWeb
}

function findAssistantActions(): AssistantActions {
  if (isEmbeddedShell() || !hasTauriRuntime()) return ASSISTANT_ACTIONS_WEB
  return ASSISTANT_ACTIONS_TAURI
}

export { ASSISTANT_ACTIONS_TAURI, ASSISTANT_ACTIONS_WEB, findAssistantActions }
