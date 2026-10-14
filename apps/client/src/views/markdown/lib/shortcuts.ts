/** 笔记窗快捷键表：展示文案与匹配逻辑共用 */

interface ShortcutBinding {
  id: string
  /** 用于 UI 展示，如 Ctrl+S */
  label: string
  /** 匹配 key（小写字母 / Escape / Digit） */
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  /** 单独修饰键快捷：仅 Escape 等 */
  bare?: boolean
}

const SHORTCUTS = {
  SAVE: {
    id: 'save',
    label: 'Ctrl+S',
    key: 's',
    ctrl: true
  },
  OPEN: {
    id: 'open',
    label: 'Ctrl+O',
    key: 'o',
    ctrl: true
  },
  NEW: {
    id: 'new',
    label: 'Ctrl+N',
    key: 'n',
    ctrl: true
  },
  FIND: {
    id: 'find',
    label: 'Ctrl+F',
    key: 'f',
    ctrl: true
  },
  PRINT: {
    id: 'print',
    label: 'Ctrl+P',
    key: 'p',
    ctrl: true
  },
  MODE_LIVE: {
    id: 'mode-live',
    label: 'Ctrl+1',
    key: '1',
    ctrl: true
  },
  MODE_SOURCE: {
    id: 'mode-source',
    label: 'Ctrl+2',
    key: '2',
    ctrl: true
  },
  MODE_SPLIT: {
    id: 'mode-split',
    label: 'Ctrl+3',
    key: '3',
    ctrl: true
  },
  FOCUS_TOGGLE: {
    id: 'focus-toggle',
    label: 'Ctrl+Shift+F',
    key: 'f',
    ctrl: true,
    shift: true
  },
  FOCUS_EXIT: {
    id: 'focus-exit',
    label: 'Esc',
    key: 'escape',
    bare: true
  }
} as const satisfies Record<string, ShortcutBinding>

function matchesShortcut(event: KeyboardEvent, binding: ShortcutBinding): boolean {
  const key = event.key.toLowerCase()
  if (key !== binding.key) return false

  if (binding.bare) {
    // Esc 允许带修饰键也退出专注，避免卡死
    return binding.key === 'escape' || (!event.ctrlKey && !event.metaKey && !event.altKey)
  }

  const wantsCtrl = Boolean(binding.ctrl)
  const wantsShift = Boolean(binding.shift)
  const wantsAlt = Boolean(binding.alt)
  const hasCtrl = event.ctrlKey || event.metaKey

  if (wantsCtrl !== hasCtrl) return false
  if (wantsShift !== event.shiftKey) return false
  if (wantsAlt !== event.altKey) return false
  return true
}

export type { ShortcutBinding }
export { SHORTCUTS, matchesShortcut }
