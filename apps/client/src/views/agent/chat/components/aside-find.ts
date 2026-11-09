/**
 * 右栏的「就地查找」域。
 *
 * Ctrl/Cmd+F 在右栏里应该落在**右栏自己的**查找目标上（文件树搜索框、或文本预览的
 * Monaco 查找框），而不是冒到 window 派发器去打开整个会话的搜索 —— 后者是 chat 的
 * `AGENT_FIND`，跟当前面板无关。
 * 做法是右栏用 `useShortcut(COMMAND.AGENT_FIND, ...)` 在处理器链前接管：焦点在右栏里就
 * 收下这一键，焦点在外面照旧交给会话搜索。
 *
 * 判定只看 DOM：右栏根节点带 `data-agent-aside`，搜索框带 `data-aside-find`，
 * 编辑器是 Monaco 的 `.monaco-editor`。这样各面板不用互相知道「当前是哪个页签」，
 * 也不用把页签状态抬进键位表。
 */

/** 右栏根节点标记（`AgentAside` 的容器） */
const ASIDE_ROOT_SELECTOR = '[data-agent-aside]'

/** 右栏内搜索框标记（文件树搜索输入框） */
const ASIDE_FIND_INPUT_SELECTOR = '[data-aside-find]'

/** Monaco 编辑器的根 DOM */
const ASIDE_EDITOR_SELECTOR = '.monaco-editor'

/** 焦点落在右栏里时返回右栏根节点，否则 `null` */
function findAsideFocusRoot(): Element | null {
  const active = document.activeElement
  if (!(active instanceof Element)) return null
  return active.closest(ASIDE_ROOT_SELECTOR)
}

/**
 * 把 Ctrl/Cmd+F 交给右栏自己的搜索框。
 *
 * 没有搜索框的页签（审阅 / 历史 / 计划…）返回 `false`；打开预览时文件树是 `hidden` 的，
 * 搜索框量不到布局，也返回 `false` —— 免得把焦点从编辑器上抢走。
 */
function focusAsideFind(root: Element): boolean {
  const input = root.querySelector<HTMLInputElement>(ASIDE_FIND_INPUT_SELECTOR)
  if (!input || input.disabled) return false
  if (input.offsetParent === null) return false
  input.focus()
  input.select()
  return true
}

/**
 * 焦点是否在右栏的编辑器里。
 *
 * Monaco 的查找框本身就挂在 `.monaco-editor` 内，所以在查找框里再按一次 Ctrl/Cmd+F
 * 也走同一条路径（重新聚焦 + 全选，不会把焦点丢到别处）。
 */
function isAsideEditorFocus(root: Element): boolean {
  const active = document.activeElement
  if (!(active instanceof Element)) return false
  const editor = active.closest(ASIDE_EDITOR_SELECTOR)
  return Boolean(editor && root.contains(editor))
}

export {
  ASIDE_EDITOR_SELECTOR,
  ASIDE_FIND_INPUT_SELECTOR,
  ASIDE_ROOT_SELECTOR,
  findAsideFocusRoot,
  focusAsideFind,
  isAsideEditorFocus
}
