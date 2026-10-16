import { viewShortcut } from '@/keyboard/definitions/factory'
import { COMMAND } from '@/keyboard/definitions/ids'
import type { LocalShortcutDefinition } from '@/keyboard/types'

/* ─── markdown（笔记）窗（视图级） ─── */

/**
 * 笔记窗的编辑器是 contenteditable，Monaco 源码模式是 textarea —— 两个开关都要开，
 * 否则「在编辑器里按 Ctrl+S」会直接落到浏览器默认行为上。
 */
function noteShortcut(id: string, title: string, defaultBinding: string): LocalShortcutDefinition {
  return viewShortcut(id, title, defaultBinding, {
    allowInEditable: true,
    allowInFormTags: true
  })
}

export const MARKDOWN_SHORTCUTS: readonly LocalShortcutDefinition[] = [
  noteShortcut(COMMAND.MARKDOWN_SAVE, '笔记窗：保存', 'mod+s'),
  noteShortcut(COMMAND.MARKDOWN_OPEN_FILE, '笔记窗：打开文件', 'mod+o'),
  noteShortcut(COMMAND.MARKDOWN_NEW, '笔记窗：新建', 'mod+n'),
  noteShortcut(COMMAND.MARKDOWN_FIND, '笔记窗：查找', 'mod+f'),
  noteShortcut(COMMAND.MARKDOWN_FIND_REPLACE, '笔记窗：查找并替换', 'mod+h'),
  noteShortcut(COMMAND.MARKDOWN_PRINT, '笔记窗：打印', 'mod+p'),
  noteShortcut(COMMAND.MARKDOWN_MODE_LIVE, '笔记窗：实时预览', 'mod+1'),
  noteShortcut(COMMAND.MARKDOWN_MODE_SOURCE, '笔记窗：源码模式', 'mod+2'),
  noteShortcut(COMMAND.MARKDOWN_MODE_SPLIT, '笔记窗：分屏模式', 'mod+3'),
  noteShortcut(COMMAND.MARKDOWN_FOCUS_TOGGLE, '笔记窗：专注模式', 'mod+shift+f'),
  noteShortcut(COMMAND.MARKDOWN_FOCUS_EXIT, '笔记窗：关闭查找 / 退出专注', 'escape')
]
