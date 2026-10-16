/**
 * 键位字符串 DSL —— 解析 / 规范化 / 匹配 / 校验 / 冲突检测。
 *
 * 唯一真源是**字符串**（`mod+shift+p`、`alt+q`、`ctrl+alt+1`）：定义表、设置持久化、
 * tiptap 既有常量都用同一套写法，不再有「字符串一套、结构化一套」互相漂移的问题。
 * 结构化表示（`Binding`）只在本模块内部与匹配/冲突计算时临时使用。
 *
 * 平台差异全部吸收在这里：
 * - `mod` 在 macOS 是 ⌘、其余平台是 Ctrl。**只有局部键能用** —— 全局键写 `mod` 没法交给
 *   OS 注册（Tauri accelerator 没有这个别名），必须显式写 `Control` / `Super`。
 * - 展示按平台渲染（`⌘⇧P` / `Ctrl+Shift+P`），匹配一律先解析成结构化再比对。
 * - 匹配优先用 `event.code`（物理键），`event.key` 兜底 —— 这样 `mod+shift+8` 在美式键盘上
 *   按下 `*` 时依然命中（`event.key` 是 `*`，`event.code` 是 `Digit8`）。
 */

import type { ShortcutScope, ShortcutWindow } from '@/keyboard/types'

type Platform = 'mac' | 'other'

/** 结构化键位。`key` 是规范化后的键名（小写字母、数字、`escape`、`arrowup`、`f1`…） */
type Binding = {
  mod: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: string
}

/** 修饰键在 DSL 里的别名 → 规范名 */
const MODIFIER_ALIASES: Record<string, keyof Omit<Binding, 'key'>> = {
  mod: 'mod',
  cmdorctrl: 'mod',
  commandorcontrol: 'mod',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  super: 'meta',
  win: 'meta'
}

/** 主键别名 → 规范键名（Tauri accelerator 的写法也在这里兼容） */
const KEY_ALIASES: Record<string, string> = {
  ' ': 'space',
  spacebar: 'space',
  esc: 'escape',
  return: 'enter',
  del: 'delete',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  arrowup: 'arrowup',
  arrowdown: 'arrowdown',
  arrowleft: 'arrowleft',
  arrowright: 'arrowright',
  pageup: 'pageup',
  pagedown: 'pagedown',
  plus: '=',
  minus: '-',
  comma: ',',
  period: '.',
  slash: '/',
  semicolon: ';',
  quote: "'",
  backquote: '`',
  backslash: '\\',
  bracketleft: '[',
  bracketright: ']'
}

/** `event.code` → 规范键名（物理键，与布局无关） */
const CODE_ALIASES: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Space: 'space',
  Escape: 'escape',
  Enter: 'enter',
  NumpadEnter: 'enter',
  Tab: 'tab',
  Backspace: 'backspace',
  Delete: 'delete',
  ArrowUp: 'arrowup',
  ArrowDown: 'arrowdown',
  ArrowLeft: 'arrowleft',
  ArrowRight: 'arrowright',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  Insert: 'insert'
}

/** 只按下修饰键时 `event.code` 的取值（录制时用来判「还没按主键」） */
const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
  'MetaLeft',
  'MetaRight',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'AltGraph'
])

/** 规范修饰键的展示顺序（mac 用符号，其余平台用缩写） */
const MODIFIER_ORDER: readonly (keyof Omit<Binding, 'key'>)[] = [
  'mod',
  'ctrl',
  'alt',
  'shift',
  'meta'
]

const MAC_MODIFIER_LABELS: Record<keyof Omit<Binding, 'key'>, string> = {
  mod: '⌘',
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
  meta: '⌘'
}

const OTHER_MODIFIER_LABELS: Record<keyof Omit<Binding, 'key'>, string> = {
  mod: 'Ctrl',
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  meta: 'Super'
}

/** Tauri accelerator 用的修饰键名 */
const ACCELERATOR_MODIFIERS: Record<keyof Omit<Binding, 'key'>, string> = {
  mod: 'Control',
  ctrl: 'Control',
  alt: 'Alt',
  shift: 'Shift',
  meta: 'Super'
}

/** 主键在 Tauri accelerator 里的写法 */
const ACCELERATOR_KEYS: Record<string, string> = {
  ' ': 'Space',
  space: 'Space',
  escape: 'Esc',
  enter: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  pageup: 'PageUp',
  pagedown: 'PageDown'
}

/** 主键在 UI 里的写法 */
const KEY_LABELS: Record<string, string> = {
  ' ': 'Space',
  space: 'Space',
  escape: 'Esc',
  enter: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Del',
  insert: 'Ins',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  pageup: 'PgUp',
  pagedown: 'PgDn'
}

function findPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other'
  return /Mac|iPhone|iPad/.test(navigator.userAgent) ? 'mac' : 'other'
}

/** 规范主键名；无法识别时返回 null */
function normalizeKey(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  const aliased = KEY_ALIASES[lower]
  if (aliased) return aliased
  if (trimmed.length === 1) return lower
  if (/^f\d{1,2}$/.test(lower)) return lower
  if (/^numpad\d$/.test(lower)) return lower.slice(-1)
  return lower
}

/**
 * 解析 DSL 文本。修饰键大小写不敏感、顺序无关；必须恰好一个主键。
 */
function parseBinding(text: string): Binding | null {
  const parts = text
    .split('+')
    .map(function (part) {
      return part.trim()
    })
    .filter(function (part) {
      return part.length > 0
    })
  if (parts.length === 0) return null

  const binding: Binding = {
    mod: false,
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    key: ''
  }

  let key: string | null = null
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()]
    if (modifier) {
      binding[modifier] = true
      continue
    }
    // 已经有一个主键又要来第二个（如 `a+b`）→ 不是合法键位
    if (key) return null
    key = normalizeKey(part)
    if (!key) return null
  }
  if (!key) return null

  binding.key = key
  return binding
}

/** 修饰键解析到具体平台：`mod` 在 mac 是 ⌘、其余是 Ctrl */
function resolveModifiers(
  binding: Binding,
  platform: Platform
): { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; key: string } {
  return {
    ctrl: binding.ctrl || (binding.mod && platform !== 'mac'),
    alt: binding.alt,
    shift: binding.shift,
    meta: binding.meta || (binding.mod && platform === 'mac'),
    key: binding.key
  }
}

/**
 * 键位身份：把 `mod` 按平台解析后拼成可比较的串。
 * 冲突检测与「是否同一个键」的判断都用它 —— 否则 Windows 上 `mod+p` 与 `ctrl+p`
 * 会被当成两个不同的键，实际却是同一个。
 */
function bindingKey(binding: Binding, platform: Platform = findPlatform()): string {
  const resolved = resolveModifiers(binding, platform)
  const parts: string[] = []
  if (resolved.ctrl) parts.push('ctrl')
  if (resolved.alt) parts.push('alt')
  if (resolved.shift) parts.push('shift')
  if (resolved.meta) parts.push('super')
  parts.push(resolved.key)
  return parts.join('+')
}

/** 文本 → 身份串；无法解析时返回 null */
function bindingKeyOfText(text: string, platform: Platform = findPlatform()): string | null {
  const binding = parseBinding(text)
  if (!binding) return null
  return bindingKey(binding, platform)
}

function keyLabel(key: string): string {
  const label = KEY_LABELS[key]
  if (label) return label
  // 单字符（字母/数字/符号）大写；`f1` → `F1`
  if (key.length === 1) return key.toUpperCase()
  return key.charAt(0).toUpperCase() + key.slice(1)
}

/** 拆成供 UI 逐个渲染的片段（`Kbd` 用），如 mac 的 `['⌘', '⇧', 'P']` */
function bindingLabels(binding: Binding, platform: Platform = findPlatform()): string[] {
  const labels =
    platform === 'mac' ? MAC_MODIFIER_LABELS : OTHER_MODIFIER_LABELS
  const parts: string[] = []
  for (const modifier of MODIFIER_ORDER) {
    if (!binding[modifier]) continue
    // mac 上 mod 与 meta 都是 ⌘，别画两遍
    if (platform === 'mac' && modifier === 'meta' && binding.mod) continue
    parts.push(labels[modifier])
  }
  parts.push(keyLabel(binding.key))
  return parts
}

/** 单行展示，如 `Ctrl+Shift+P` / `⌘⇧P` */
function formatBinding(
  binding: Binding,
  platform: Platform = findPlatform()
): string {
  return bindingLabels(binding, platform).join(platform === 'mac' ? '' : '+')
}

/** 文本 → 展示串；无法解析时原样返回，方便 UI 显示脏数据 */
function formatBindingText(
  text: string,
  platform: Platform = findPlatform()
): string {
  const binding = parseBinding(text)
  return binding ? formatBinding(binding, platform) : text
}

/** 结构化 → DSL 文本（录制后用这个存盘，如 `ctrl+shift+p`、`meta+alt+q`） */
function bindingToText(binding: Binding): string {
  const parts: string[] = []
  if (binding.mod) parts.push('mod')
  if (binding.ctrl) parts.push('ctrl')
  if (binding.alt) parts.push('alt')
  if (binding.shift) parts.push('shift')
  if (binding.meta) parts.push('meta')
  parts.push(binding.key)
  return parts.join('+')
}

/** 结构化 → Tauri accelerator（全局键持久化的写法就是它） */
function toAccelerator(binding: Binding, platform: Platform = findPlatform()): string {
  const resolved = resolveModifiers(binding, platform)
  const parts: string[] = []
  if (resolved.ctrl) parts.push(ACCELERATOR_MODIFIERS.ctrl)
  if (resolved.alt) parts.push(ACCELERATOR_MODIFIERS.alt)
  if (resolved.shift) parts.push(ACCELERATOR_MODIFIERS.shift)
  if (resolved.meta) parts.push(ACCELERATOR_MODIFIERS.meta)
  parts.push(ACCELERATOR_KEYS[resolved.key] ?? keyLabel(resolved.key))
  return parts.join('+')
}

/** 文本 → accelerator；无法解析时返回 null */
function toAcceleratorText(
  text: string,
  platform: Platform = findPlatform()
): string | null {
  const binding = parseBinding(text)
  return binding ? toAccelerator(binding, platform) : null
}

function tokenFromCode(code: string): string | null {
  if (!code) return null
  const aliased = CODE_ALIASES[code]
  if (aliased) return aliased
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1].toLowerCase()
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code)
  if (digit) return digit[1]
  const fn = /^F(\d{1,2})$/.exec(code)
  if (fn) return `f${fn[1]}`
  return null
}

function tokenFromKey(key: string): string | null {
  if (!key) return null
  const lower = key.toLowerCase()
  if (MODIFIER_ALIASES[lower] || MODIFIER_CODES.has(key)) return null
  const aliased = KEY_ALIASES[lower]
  if (aliased) return aliased
  if (key.length === 1) return lower
  return lower
}

/** 事件是否「只按了修饰键」（录制时据此判定还没按键） */
function isModifierEvent(event: KeyboardEvent): boolean {
  return MODIFIER_CODES.has(event.code) || MODIFIER_ALIASES[event.key.toLowerCase()] !== undefined
}

/** 事件的候选主键 token：物理键优先，字符键兜底 */
function tokensFromEvent(event: KeyboardEvent): string[] {
  const tokens: string[] = []
  const fromCode = tokenFromCode(event.code)
  if (fromCode) tokens.push(fromCode)
  const fromKey = tokenFromKey(event.key)
  if (fromKey && !tokens.includes(fromKey)) tokens.push(fromKey)
  return tokens
}

/** 录制用：把键盘事件转成结构化键位；只按了修饰键时返回 null */
function bindingFromEvent(event: KeyboardEvent): Binding | null {
  if (isModifierEvent(event)) return null
  const tokens = tokensFromEvent(event)
  const key = tokens[0]
  if (!key) return null
  return {
    mod: false,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    key
  }
}

/** 事件是否命中该键位 */
function matchesEvent(
  binding: Binding,
  event: KeyboardEvent,
  platform: Platform = findPlatform()
): boolean {
  const tokens = tokensFromEvent(event)
  if (!tokens.includes(binding.key)) return false
  const resolved = resolveModifiers(binding, platform)
  return (
    resolved.ctrl === event.ctrlKey &&
    resolved.alt === event.altKey &&
    resolved.shift === event.shiftKey &&
    resolved.meta === event.metaKey
  )
}

/** 文本是否与事件匹配（派发器的主路径） */
function matchesEventText(
  text: string,
  event: KeyboardEvent,
  platform: Platform = findPlatform()
): boolean {
  const binding = parseBinding(text)
  return binding ? matchesEvent(binding, event, platform) : false
}

/**
 * 校验键位文本，返回错误原因（null = 通过）。
 *
 * 全局键比局部键严：必须显式修饰键（不能 `mod`）、必须带修饰键 —— OS 注册不接受裸键。
 * 局部键允许裸键（`escape`、`space`、`s`），因为窗口内按键有焦点上下文。
 */
function validateBinding(text: string, scope: ShortcutScope): string | null {
  const trimmed = text.trim()
  if (!trimmed) return '请按下快捷键'
  const binding = parseBinding(trimmed)
  if (!binding) return '无法识别的快捷键'

  if (scope !== 'global') return null

  if (binding.mod) return '全局快捷键不能用 mod，请明确写 Control 或 Super'
  if (!(binding.ctrl || binding.alt || binding.shift || binding.meta)) {
    return '全局快捷键至少需要一个修饰键'
  }
  return null
}

/** 非阻断的软提示（全局键抢键风险） */
function findBindingWarnings(text: string, scope: ShortcutScope): string[] {
  if (scope !== 'global') return []
  const binding = parseBinding(text)
  if (!binding) return []
  if (binding.alt || binding.meta) return []
  return ['建议包含 Alt 或 Super：只用 Ctrl 做全局键会抢占前台应用的常用操作']
}

type ShortcutBindingEntry = {
  id: string
  title: string
  scope: ShortcutScope
  window?: ShortcutWindow
  binding: string
}

type BindingConflict = {
  /** 冲突的键位身份串，如 `ctrl+shift+p` */
  key: string
  /** 涉事键位 id */
  ids: string[]
  /** `block` = 会双触发或直接抢键，必须拦；`warn` = 有意的覆盖，提示即可 */
  severity: 'block' | 'warn'
  message: string
}

function isSameWindow(a?: ShortcutWindow, b?: ShortcutWindow): boolean {
  if (!a || !b) return true
  return a === b || a === 'any' || b === 'any'
}

/** 找出窗口有重叠的局部键对；分属不同窗口的组合互不相干 */
function findOverlappingPairs(
  locals: readonly ShortcutBindingEntry[]
): [ShortcutBindingEntry, ShortcutBindingEntry][] {
  const pairs: [ShortcutBindingEntry, ShortcutBindingEntry][] = []
  for (let index = 0; index < locals.length; index++) {
    for (let other = index + 1; other < locals.length; other++) {
      const left = locals[index]
      const right = locals[other]
      if (isSameWindow(left.window, right.window)) pairs.push([left, right])
    }
  }
  return pairs
}

/**
 * 冲突检测（表内静态可查）。
 *
 * 阻断（会双触发或直接抢键）：
 * - global × global：同一组合抢两次注册
 * - global × local：前台按下既触发 OS 回调又触发 DOM 派发
 * - 同窗口、同作用域的 local × local（`app` × `app`、`editor` × `editor`）
 * 仅提示：
 * - `app` 与 `view` / `editor` 重叠：app 键在打开该视图时会被静默盖住（作用域具体度优先）
 * 不报告：
 * - `view` × `view`、`view` × `editor`：两边不会同时在场 —— code 与 markdown 的 Ctrl+S
 *   本来就都该是 Ctrl+S，天天报警只会训练用户忽略徽标
 * - 分属不同窗口（main / overlay 是两套 JS 上下文，互不相干）
 */
function findConflicts(
  entries: readonly ShortcutBindingEntry[],
  platform: Platform = findPlatform()
): BindingConflict[] {
  const groups = new Map<string, ShortcutBindingEntry[]>()
  for (const entry of entries) {
    const key = bindingKeyOfText(entry.binding, platform)
    if (!key) continue
    const group = groups.get(key) ?? []
    group.push(entry)
    groups.set(key, group)
  }

  const conflicts: BindingConflict[] = []
  for (const [key, group] of groups) {
    if (group.length < 2) continue
    const ids = group.map(function (entry) {
      return entry.id
    })
    const titles = group
      .map(function (entry) {
        return `「${entry.title}」`
      })
      .join('、')
    const globals = group.filter(function (entry) {
      return entry.scope === 'global'
    })
    const locals = group.filter(function (entry) {
      return entry.scope !== 'global'
    })

    if (globals.length > 1) {
      conflicts.push({
        key,
        ids,
        severity: 'block',
        message: `全局快捷键与其他全局键重复：${titles}`
      })
      continue
    }
    if (globals.length === 1 && locals.length > 0) {
      conflicts.push({
        key,
        ids,
        severity: 'block',
        message: `与全局键同键，前台按下会触发两次：${titles}`
      })
      continue
    }

    const pairs = findOverlappingPairs(locals)
    if (pairs.length === 0) continue
    // 只报「两边真的同时在场」的组合（见函数头注释）
    const isHard = pairs.some(function ([left, right]) {
      return left.scope === right.scope && left.scope !== 'view'
    })
    const isSoft =
      !isHard &&
      pairs.some(function ([left, right]) {
        return left.scope === 'app' || right.scope === 'app'
      })
    if (!isHard && !isSoft) continue
    conflicts.push({
      key,
      ids,
      severity: isHard ? 'block' : 'warn',
      message: isHard ? `同窗口内重复：${titles}` : `同键但作用域不同，本视图会覆盖对方：${titles}`
    })
  }

  return conflicts
}

export type {
  Binding,
  BindingConflict,
  Platform,
  ShortcutBindingEntry
}
export {
  bindingFromEvent,
  bindingKey,
  bindingKeyOfText,
  bindingLabels,
  bindingToText,
  findBindingWarnings,
  findConflicts,
  findPlatform,
  formatBinding,
  formatBindingText,
  isModifierEvent,
  matchesEvent,
  matchesEventText,
  parseBinding,
  toAccelerator,
  toAcceleratorText,
  validateBinding
}
