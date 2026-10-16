import { editorShortcut } from '@/keyboard/definitions/factory'
import { COMMAND } from '@/keyboard/definitions/ids'
import type { LocalShortcutDefinition } from '@/keyboard/types'

/* ─── 编辑器内（tiptap / ProseMirror） ─── */

/**
 * tiptap-ui 按钮的键位：原来由 `react-hotkeys-hook` 绑定，现由统一派发器接管。
 *
 * 这批是**真的只挂在 16 个 hook 里**的键位；由 ProseMirror 扩展自己处理的见下面那一组。
 */
export const EDITOR_SHORTCUTS: readonly LocalShortcutDefinition[] = [
  editorShortcut(COMMAND.EDITOR_AI_ASK, '编辑器：AI 提问', 'mod+j'),
  editorShortcut(COMMAND.EDITOR_COLOR_HIGHLIGHT, '编辑器：高亮颜色', 'mod+shift+h'),
  editorShortcut(COMMAND.EDITOR_COLOR_TEXT, '编辑器：文字颜色', 'mod+shift+t'),
  // `mod+ctrl+l` 在 Windows 上 mod 与 ctrl 折叠 → 实际就是 Ctrl+L，这是上游模板的写法，照搬
  editorShortcut(COMMAND.EDITOR_COPY_ANCHOR_LINK, '编辑器：复制锚点链接', 'mod+ctrl+l'),
  editorShortcut(COMMAND.EDITOR_COPY_TO_CLIPBOARD, '编辑器：复制到剪贴板', 'mod+c'),
  editorShortcut(COMMAND.EDITOR_DELETE_NODE, '编辑器：删除当前节点', 'backspace'),
  editorShortcut(COMMAND.EDITOR_DUPLICATE, '编辑器：复制节点', 'mod+d'),
  // 表情键原为 mod+shift+e，与文字居中对齐的 `mod+shift+l/e/r/j` 家族撞车（同窗口同作用域），
  // 让位给对齐并改用 `mod+shift+.`（与 Windows 系统表情面板 Win+. 的直觉一致）
  editorShortcut(COMMAND.EDITOR_EMOJI_TRIGGER, '编辑器：表情', 'mod+shift+.'),
  // 图片对齐是 `alt+shift+*` 家族（与文字对齐的 `mod+shift+*` 分开），且只有三条
  editorShortcut(COMMAND.EDITOR_IMAGE_ALIGN_LEFT, '编辑器：图片居左', 'alt+shift+l'),
  editorShortcut(COMMAND.EDITOR_IMAGE_ALIGN_CENTER, '编辑器：图片居中', 'alt+shift+e'),
  editorShortcut(COMMAND.EDITOR_IMAGE_ALIGN_RIGHT, '编辑器：图片居右', 'alt+shift+r'),
  editorShortcut(COMMAND.EDITOR_IMAGE_DOWNLOAD, '编辑器：下载图片', 'mod+shift+d'),
  editorShortcut(COMMAND.EDITOR_IMAGE_UPLOAD, '编辑器：上传图片', 'mod+shift+i'),
  editorShortcut(COMMAND.EDITOR_MENTION_TRIGGER, '编辑器：提及', 'mod+shift+2'),
  editorShortcut(COMMAND.EDITOR_MOVE_UP, '编辑器：上移节点', 'mod+shift+ArrowUp'),
  editorShortcut(COMMAND.EDITOR_MOVE_DOWN, '编辑器：下移节点', 'mod+shift+ArrowDown'),
  editorShortcut(COMMAND.EDITOR_RESET_FORMATTING, '编辑器：清除格式', 'mod+r'),
  editorShortcut(COMMAND.EDITOR_SLASH_TRIGGER, '编辑器：斜杠命令', 'mod+/'),
  editorShortcut(COMMAND.EDITOR_TEXT, '编辑器：普通段落', 'mod+alt+0'),
  // 文字对齐：`mod+shift+*` 家族（与图片对齐的 `alt+shift+*` 分开）。对齐字母沿用 Word 的
  // Ctrl+L / E / R / J 习惯，所以是 l/e/r/j
  editorShortcut(COMMAND.EDITOR_TEXT_ALIGN_LEFT, '编辑器：文字居左', 'mod+shift+l'),
  editorShortcut(COMMAND.EDITOR_TEXT_ALIGN_CENTER, '编辑器：文字居中', 'mod+shift+e'),
  editorShortcut(COMMAND.EDITOR_TEXT_ALIGN_RIGHT, '编辑器：文字居右', 'mod+shift+r'),
  editorShortcut(COMMAND.EDITOR_TEXT_ALIGN_JUSTIFY, '编辑器：文字两端对齐', 'mod+shift+j')
]

/**
 * 由 ProseMirror / tiptap 扩展**自己的 keymap** 处理的键位：只登记、不接管。
 *
 * 它们没有 `useHotkeys`，键位写在扩展的 `addKeyboardShortcuts()` 里 —— 我们若也插一手，
 * 会与扩展抢同一个键（且无法可靠地 `preventDefault`）。登记它们是为了让设置页能完整列出，
 * 并让冲突检测看得见这批键。
 */
export const NATIVE_EDITOR_SHORTCUTS: readonly LocalShortcutDefinition[] = [
  editorShortcut(COMMAND.NATIVE_EDITOR_BOLD, '编辑器：加粗', 'mod+b', { owner: 'native' }),
  editorShortcut(COMMAND.NATIVE_EDITOR_ITALIC, '编辑器：斜体', 'mod+i', { owner: 'native' }),
  editorShortcut(COMMAND.NATIVE_EDITOR_UNDERLINE, '编辑器：下划线', 'mod+u', {
    owner: 'native'
  }),
  editorShortcut(COMMAND.NATIVE_EDITOR_STRIKE, '编辑器：删除线', 'mod+shift+s', {
    owner: 'native'
  }),
  editorShortcut(COMMAND.NATIVE_EDITOR_CODE, '编辑器：行内代码', 'mod+e', {
    owner: 'native'
  }),
  editorShortcut(COMMAND.NATIVE_EDITOR_SUPERSCRIPT, '编辑器：上标', 'mod+.', {
    owner: 'native'
  }),
  editorShortcut(COMMAND.NATIVE_EDITOR_SUBSCRIPT, '编辑器：下标', 'mod+,', {
    owner: 'native'
  }),
  editorShortcut(COMMAND.NATIVE_EDITOR_HEADING_1, '编辑器：标题 1', 'ctrl+alt+1', {
    owner: 'native'
  }),
  editorShortcut(COMMAND.NATIVE_EDITOR_HEADING_2, '编辑器：标题 2', 'ctrl+alt+2', {
    owner: 'native'
  }),
  editorShortcut(COMMAND.NATIVE_EDITOR_HEADING_3, '编辑器：标题 3', 'ctrl+alt+3', {
    owner: 'native'
  }),
  editorShortcut(COMMAND.NATIVE_EDITOR_HEADING_4, '编辑器：标题 4', 'ctrl+alt+4', {
    owner: 'native'
  }),
  editorShortcut(COMMAND.NATIVE_EDITOR_HEADING_5, '编辑器：标题 5', 'ctrl+alt+5', {
    owner: 'native'
  }),
  editorShortcut(COMMAND.NATIVE_EDITOR_HEADING_6, '编辑器：标题 6', 'ctrl+alt+6', {
    owner: 'native'
  }),
  editorShortcut(COMMAND.NATIVE_EDITOR_LIST_BULLET, '编辑器：无序列表', 'mod+shift+8', {
    owner: 'native'
  }),
  editorShortcut(COMMAND.NATIVE_EDITOR_LIST_ORDERED, '编辑器：有序列表', 'mod+shift+7', {
    owner: 'native'
  }),
  editorShortcut(COMMAND.NATIVE_EDITOR_LIST_TASK, '编辑器：任务列表', 'mod+shift+9', {
    owner: 'native'
  }),
  editorShortcut(COMMAND.NATIVE_EDITOR_UNDO, '编辑器：撤销', 'mod+z', { owner: 'native' }),
  editorShortcut(COMMAND.NATIVE_EDITOR_REDO, '编辑器：重做', 'mod+shift+z', {
    owner: 'native'
  }),
  editorShortcut(COMMAND.NATIVE_EDITOR_BLOCKQUOTE, '编辑器：引用', 'mod+shift+b', {
    owner: 'native'
  }),
  editorShortcut(COMMAND.NATIVE_EDITOR_CODE_BLOCK, '编辑器：代码块', 'mod+alt+c', {
    owner: 'native'
  })
]
