import {
  createContext,
  useContext,
  useMemo,
  type FC,
  type PropsWithChildren
} from 'react'

/**
 * 消息操作条的宿主能力（复制到剪贴板 / 导出 Markdown）。
 *
 * 库默认走浏览器 API；桌面壳（Tauri）用 `AssistantActionsProvider` 注入
 * `clipboard-manager` / `dialog.save`，否则 `<a download>` 与
 * `navigator.clipboard` 在 WebView 里会静默失败或截断。
 */
interface AssistantActions {
  copyText: (text: string) => void | Promise<void>
  exportMarkdown: (text: string, filename: string) => void | Promise<void>
}

type AssistantActionsOverride = Partial<AssistantActions>

const COPIED_DURATION_MS = 3000

async function copyTextBrowser(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    throw new Error('Clipboard API is unavailable')
  }
  await navigator.clipboard.writeText(text)
}

function exportMarkdownBrowser(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const ASSISTANT_ACTIONS_BROWSER: AssistantActions = {
  copyText: copyTextBrowser,
  exportMarkdown: exportMarkdownBrowser
}

const AssistantActionsContext = createContext<AssistantActions>(ASSISTANT_ACTIONS_BROWSER)

const AssistantActionsProvider: FC<
  PropsWithChildren<{ actions?: AssistantActionsOverride }>
> = function AssistantActionsProvider({ actions, children }) {
  const merged = useMemo(
    function () {
      if (!actions) return ASSISTANT_ACTIONS_BROWSER
      return { ...ASSISTANT_ACTIONS_BROWSER, ...actions }
    },
    [actions]
  )

  return (
    <AssistantActionsContext.Provider value={merged}>{children}</AssistantActionsContext.Provider>
  )
}

function useAssistantActions(): AssistantActions {
  return useContext(AssistantActionsContext)
}

export {
  ASSISTANT_ACTIONS_BROWSER,
  AssistantActionsProvider,
  COPIED_DURATION_MS,
  useAssistantActions
}
export type { AssistantActions, AssistantActionsOverride }
