/** 标题栏应用菜单 → 工作区：仅文件类窗口命令，不承载编辑器工具条 */

const MARKDOWN_COMMAND = 'markdown:command'

type MarkdownCommand =
  | { type: 'open-file' }
  | { type: 'open-folder' }
  | { type: 'new' }
  | { type: 'save' }
  | { type: 'export-html' }
  | { type: 'copy-md' }
  | { type: 'copy-html' }

function dispatchMarkdownCommand(command: MarkdownCommand): void {
  window.dispatchEvent(new CustomEvent(MARKDOWN_COMMAND, { detail: command }))
}

function subscribeMarkdownCommands(
  onCommand: (command: MarkdownCommand) => void
): () => void {
  function onEvent(event: Event) {
    const detail = (event as CustomEvent<MarkdownCommand>).detail
    if (!detail?.type) return
    onCommand(detail)
  }
  window.addEventListener(MARKDOWN_COMMAND, onEvent)
  return function () {
    window.removeEventListener(MARKDOWN_COMMAND, onEvent)
  }
}

export type { MarkdownCommand }
export { MARKDOWN_COMMAND, dispatchMarkdownCommand, subscribeMarkdownCommands }
