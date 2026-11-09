/**
 * 自研 contentEditable 输入区。
 *
 * 分工：
 * - **文档真值**在 `atomsRef`（`ComposerAtom[]`），序列化后同步给 `aui.composer.setText()`。
 * - **DOM 是视图**：`renderDocument` 从 atoms 重建，`readDom` 从 DOM 反推 atoms。
 *   用户敲键时走浏览器默认行为（IME / 拼写检查 / 撤销栈都保留），
 *   `onInput` 之后才把 DOM 读回 atoms 并 push 给 runtime。
 * - **光标**用「逻辑 offset」表示，落在 chip 上时按整块长度算：
 *   `@browser-<uuid>` 视觉上是一个小方块，但在 offset 坐标里占整串长度。
 *
 * 键位、IME、粘贴、复制、触发器联动全部集中在这个文件，壳上的 `onKeyDownCapture`
 * （原 `useComposerQueueKeyCapture`）已并入，避免两条 Enter 决策路径。
 *
 * 剪贴板：`text/plain` 就是线格式（`@<id>`），另有私有 MIME 携带 chip 的
 * type / label / id —— 同框内复制粘贴语义不丢，粘到记事本再粘回则降级成 `@<id>` 并被重新识别。
 *
 * **撤销栈**：`renderDocument` 每次都 `replaceChildren()` 重建 DOM，浏览器原生撤销记录的是
 * 被摘掉的旧节点，所以在 chip 插入 / 删除 / 粘贴之后 `Ctrl+Z` 会让文本与 DOM 失配。
 * 这里自己维护 `ComposerAtom[]` 快照栈（连续输入 500ms 合并，离散操作各算一步）。
 *
 * 边界（**别当成多余代码删掉**）：撤销栈只记录**用户操作**。外部 `setText`
 * （发送后清空、切会话、编辑态回填）必须 `clearHistory()`，否则撤销会「复活」
 * 一条已经发出去的消息。判断依据是 `lastPushedRef`：不是自己 push 出去的变化就是外部变化。
 */
import { useAui, useAuiState } from '@assistant-ui/react'
import { cn } from 'cn'
import {
  useCallback,
  useEffect,
  useRef,
  type ClipboardEvent,
  type CompositionEvent,
  type KeyboardEvent
} from 'react'

import {
  atomLength,
  buildChip,
  deriveChipLabel,
  documentLength,
  findAtomEndingAt,
  findAtomStartingAt,
  locateOffset,
  parseDocument,
  parseInlineText,
  readDom,
  replaceRange,
  serializeDocument,
  serializeTriggerText,
  sliceAtoms,
  splitChipLabel,
  toChipType,
  type ComposerAtom,
  type ComposerChipAtom
} from './composer-document'
import { useComposerTrigger, type ComposerEditRequest } from './composer-trigger'
import { useAssistantLabels } from './labels'
import { sendFromComposer } from './composer-queue.aui'
import {
  createComposerHistory,
  type ComposerHistory,
  type ComposerHistoryEntry,
  type ComposerHistoryKind
} from './composer-history'

const CHIP_CLASS = 'aui-composer-chip'
/** 目录段可截断、末段保完整：窄窗口里得到「…/chat.tsx」而不是「apps/clien…」 */
const CHIP_DIR_CLASS = 'min-w-0 truncate'
const CHIP_BASE_CLASS = 'shrink-0'

/** 同框复制粘贴时携带 chip 语义的私有 MIME（text/plain 只有线格式） */
const COMPOSER_CLIPBOARD_MIME = 'application/x-cogito-composer'

/** 组合输入期间按下的键码（Chrome 在 IME 组合时会给 keyCode 229）。 */
const IME_KEY_CODE = 229

/** 输入框的类名也是「外部找得到它」的契约（队列的取回编辑要用） */
const COMPOSER_INPUT_SELECTOR = '.aui-composer-input'

/**
 * 把焦点交回输入框并把光标落到末尾。
 *
 * 队列「取回编辑」这类外部入口用：按钮卸载后焦点会掉到 `body`，
 * 用户还得再点一次输入框才能继续打字（`placeCaret` 只在 `activeElement === root` 时才落点）。
 * 不引入全局状态：按类名找当前挂载的那个编辑器。
 */
function focusComposerInput(): boolean {
  if (typeof document === 'undefined') return false
  const root = document.querySelector<HTMLElement>(COMPOSER_INPUT_SELECTOR)
  if (!root) return false
  root.focus()
  const selection = window.getSelection()
  if (!selection) return true
  const range = document.createRange()
  range.selectNodeContents(root)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

/** 触发起始文本的 highlight 名（与下面注入的样式表一一对应）。 */
const TRIGGER_HIGHLIGHT = {
  mention: 'aui-composer-trigger-mention',
  skill: 'aui-composer-trigger-skill'
} as const

const TRIGGER_HIGHLIGHT_NAMES = Object.values(TRIGGER_HIGHLIGHT)

/**
 * `::highlight(name)` 的配色。
 *
 * 这里不写进 globals.css，是因为它是 CSS Custom Highlight API 的伪元素，而 Tailwind v4
 * 的 CSS 优化器（lightningcss）还没收录它，构建时会报
 * 「'highlight' is not recognized as a valid pseudo-element」并可能把规则丢掉。
 * 改成运行时注入一次：效果完全一致，构建也不再告警。
 */
const TRIGGER_HIGHLIGHT_STYLES = `
::highlight(${TRIGGER_HIGHLIGHT.mention}) {
  color: color-mix(in oklab, var(--color-primary) 78%, var(--color-foreground));
  background-color: color-mix(in oklab, var(--color-primary) 14%, transparent);
}

::highlight(${TRIGGER_HIGHLIGHT.skill}) {
  color: color-mix(in oklab, var(--color-warning) 55%, var(--color-foreground));
  background-color: color-mix(in oklab, var(--color-warning) 18%, transparent);
}
`

let triggerHighlightStylesInjected = false

function ensureTriggerHighlightStyles() {
  if (triggerHighlightStylesInjected || typeof document === 'undefined') return
  triggerHighlightStylesInjected = true
  const style = document.createElement('style')
  style.dataset.slot = 'composer-trigger-highlight'
  style.textContent = TRIGGER_HIGHLIGHT_STYLES
  document.head.appendChild(style)
}

function clearTriggerHighlights() {
  const highlights = typeof CSS !== 'undefined' ? CSS.highlights : undefined
  if (!highlights) return
  for (const name of TRIGGER_HIGHLIGHT_NAMES) highlights.delete(name)
}

/** 逻辑 offset → DOM 点；触发区间只落在文本节点上。 */
function pointAtOffset(
  root: HTMLElement,
  atoms: readonly ComposerAtom[],
  offset: number
): { node: Node; offset: number } | null {
  const { atomIndex, charOffset } = locateOffset(atoms, offset)
  const children = root.childNodes
  if (atomIndex >= children.length) {
    if (children.length === 0) return { node: root, offset: 0 }
    return { node: root, offset: children.length }
  }
  const node = children[atomIndex]
  if (!node) return null
  if (node.nodeType === Node.TEXT_NODE) {
    return { node, offset: Math.min(charOffset, node.nodeValue?.length ?? 0) }
  }
  // chip / br：offset 落在节点边界
  if (charOffset <= 0) return { node: root, offset: atomIndex }
  return { node: root, offset: atomIndex + 1 }
}

function findDomRange(
  root: HTMLElement,
  atoms: readonly ComposerAtom[],
  start: number,
  end: number
): Range | null {
  if (end <= start) return null
  const from = pointAtOffset(root, atoms, start)
  const to = pointAtOffset(root, atoms, end)
  if (!from || !to) return null
  try {
    const range = document.createRange()
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
    return range
  } catch (error) {
    console.warn('[composer-input] 无法定位触发高亮区间:', error)
    return null
  }
}

function paintTriggerHighlight(
  root: HTMLElement,
  atoms: readonly ComposerAtom[],
  match: {
    readonly trigger: { readonly id: string }
    readonly start: number
    readonly end: number
  } | null
) {
  clearTriggerHighlights()
  const highlights = typeof CSS !== 'undefined' ? CSS.highlights : undefined
  if (!highlights || match === null) return
  ensureTriggerHighlightStyles()
  const name =
    match.trigger.id === 'mention'
      ? TRIGGER_HIGHLIGHT.mention
      : match.trigger.id === 'skill'
        ? TRIGGER_HIGHLIGHT.skill
        : null
  if (name === null) return
  const range = findDomRange(root, atoms, match.start, match.end)
  if (!range) return
  highlights.set(name, new Highlight(range))
}

function renderChip(atom: ComposerChipAtom) {
  const span = document.createElement('span')
  span.dataset.chipType = atom.type
  span.dataset.chipLabel = atom.label
  span.dataset.chipId = atom.id
  span.contentEditable = 'false'
  span.className = CHIP_CLASS
  // 两段式：目录段可截断、末段完整
  const { dir, base } = splitChipLabel(atom.type, atom.label, atom.id)
  if (dir.length > 0) {
    const dirNode = document.createElement('span')
    dirNode.dataset.slot = 'chip-dir'
    dirNode.className = CHIP_DIR_CLASS
    dirNode.textContent = dir
    span.appendChild(dirNode)
  }
  const baseNode = document.createElement('span')
  baseNode.dataset.slot = 'chip-base'
  baseNode.className = CHIP_BASE_CLASS
  baseNode.textContent = base
  span.appendChild(baseNode)
  // 悬停给出完整 id（引用路径 / 浏览器 tab / 技能名）
  if (atom.id.length > 0) span.title = atom.id
  return span
}

/**
 * atoms → DOM。子节点与 atoms 严格一一对应（text→Text、break→BR、chip→span），
 * 后面 `placeCaret` / `readSelectionOffset` 都依赖这个对应关系。
 */
function renderDocument(root: HTMLElement, atoms: readonly ComposerAtom[]) {
  root.replaceChildren()
  if (atoms.length === 0) {
    root.appendChild(document.createElement('br'))
    return
  }
  for (const atom of atoms) {
    if (atom.kind === 'text') root.appendChild(document.createTextNode(atom.text))
    else if (atom.kind === 'break') root.appendChild(document.createElement('br'))
    else root.appendChild(renderChip(atom))
  }
}

/** 逻辑 offset → DOM 光标。 */
function placeCaret(root: HTMLElement, atoms: readonly ComposerAtom[], offset: number) {
  const { atomIndex, charOffset } = locateOffset(atoms, offset)
  const children = root.childNodes
  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  const node = children[atomIndex]
  if (!node) {
    // 落在末尾：收到最后一个可落点之后
    if (children.length === 0) return
    range.selectNodeContents(root)
    range.collapse(false)
  } else if (node.nodeType === Node.TEXT_NODE) {
    range.setStart(node, Math.min(charOffset, node.nodeValue?.length ?? 0))
    range.collapse(true)
  } else {
    range.setStartAfter(node)
    range.collapse(true)
  }
  selection.removeAllRanges()
  selection.addRange(range)
}

/** 单个 DOM 点 → 逻辑 offset；不在编辑器内时返回 `null`。 */
function offsetOfPoint(
  root: HTMLElement,
  atoms: readonly ComposerAtom[],
  node: Node,
  nodeOffset: number
): number | null {
  if (!root.contains(node) && node !== root) return null
  if (node === root) {
    const children = Array.from(root.childNodes)
    let offset = 0
    for (let index = 0; index < Math.min(nodeOffset, children.length); index += 1) {
      offset += atoms[index] ? atomLength(atoms[index]) : 0
    }
    return offset
  }

  const children = Array.from(root.childNodes)
  let offset = 0
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    const length = atoms[index] ? atomLength(atoms[index]) : 0
    if (child === node) return offset + Math.min(nodeOffset, length)
    if (child.contains(node)) return offset + length
    offset += length
  }
  return offset
}

/** 当前选区 → 逻辑区间（`end` 不早于 `start`）。 */
function readSelectionRange(root: HTMLElement, atoms: readonly ComposerAtom[]) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  const start = offsetOfPoint(root, atoms, range.startContainer, range.startOffset)
  if (start === null) return null
  if (range.collapsed) return { start, end: start }
  const end = offsetOfPoint(root, atoms, range.endContainer, range.endOffset)
  return { start, end: Math.max(start, end ?? start) }
}

function readSelectionOffset(root: HTMLElement, atoms: readonly ComposerAtom[]) {
  return readSelectionRange(root, atoms)?.start ?? null
}

/** 剪贴板载荷：只带 chip 的语义字段，不带 `serialized`（由 buildChip 重算）。 */
function toClipboardPayload(atoms: readonly ComposerAtom[]) {
  return atoms.map(function (atom) {
    if (atom.kind === 'chip') {
      return { kind: 'chip', type: atom.type, label: atom.label, id: atom.id }
    }
    if (atom.kind === 'break') return { kind: 'break' }
    return { kind: 'text', text: atom.text }
  })
}

/** 私有 MIME → atoms；结构不合法时返回 `null`，调用方退回纯文本解析。 */
function fromClipboardPayload(raw: string): ComposerAtom[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null

  const atoms: ComposerAtom[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) return null
    const row = item as {
      kind?: unknown
      type?: unknown
      label?: unknown
      id?: unknown
      text?: unknown
    }
    if (row.kind === 'chip' && typeof row.id === 'string' && row.id.length > 0) {
      const type =
        typeof row.type === 'string' && row.type.length > 0 ? row.type : toChipType(row.id)
      const label =
        typeof row.label === 'string' && row.label.length > 0
          ? row.label
          : deriveChipLabel(type, row.id)
      atoms.push(buildChip(type, label, row.id))
      continue
    }
    if (row.kind === 'break') {
      atoms.push(...parseInlineText('\n'))
      continue
    }
    if (row.kind === 'text' && typeof row.text === 'string') {
      atoms.push(...parseInlineText(row.text))
      continue
    }
    return null
  }
  return atoms
}

interface ComposerInputProps {
  readonly placeholder?: string | undefined
  readonly className?: string | undefined
  readonly autoFocus?: boolean | undefined
  readonly submitMode?: 'enter' | 'ctrlEnter' | undefined
  readonly 'aria-label'?: string | undefined
}

function ComposerInput(props: ComposerInputProps) {
  const {
    placeholder,
    className,
    autoFocus = false,
    submitMode = 'enter',
    'aria-label': ariaLabel
  } = props
  const aui = useAui()
  const trigger = useComposerTrigger()
  const labels = useAssistantLabels()
  const text = useAuiState(function (state) {
    return state.composer.text
  })
  const threadDisabled = useAuiState(function (state) {
    return state.thread.isDisabled
  })
  const dictationDisabled = useAuiState(function (state) {
    return state.composer.dictation?.inputDisabled === true
  })
  const isDisabled = threadDisabled || dictationDisabled

  const editorRef = useRef<HTMLDivElement>(null)
  const atomsRef = useRef<ComposerAtom[]>([])
  /** 自己写出去的文本，用来区分「runtime 变化」与「我刚 push 的回声」。 */
  const lastPushedRef = useRef<string | null>(null)
  const composingRef = useRef(false)

  /**
   * 撤销 / 重做栈。`renderDocument` 会重建整个 DOM，原生撤销栈记的是旧节点，
   * 所以 chip 相关操作之后必须自己接管（逻辑在 `composer-history.ts`，见文件头注）。
   */
  const historyRef = useRef<ComposerHistory | null>(null)
  if (historyRef.current === null) historyRef.current = createComposerHistory()

  /** 当前逻辑光标（不在编辑器里时按「末尾」算，撤销后落点仍在末尾） */
  const readCursor = useCallback(function (atoms: ComposerAtom[]) {
    const root = editorRef.current
    const cursor = root ? readSelectionOffset(root, atoms) : null
    return cursor ?? documentLength(atoms)
  }, [])

  const snapshot = useCallback(
    function () {
      return { atoms: atomsRef.current, cursor: readCursor(atomsRef.current) }
    },
    [readCursor]
  )

  /** 入栈：连续输入 500ms 内合并，离散操作各算一步（规则见 composer-history.ts） */
  const rememberHistory = useCallback(
    function (kind: ComposerHistoryKind) {
      historyRef.current?.remember(kind, snapshot())
    },
    [snapshot]
  )

  /** 外部变化（发送清空 / 切会话 / 回填）清栈：撤销不能复活已经发出去的内容 */
  const clearHistory = useCallback(function () {
    historyRef.current?.clear()
  }, [])

  /** 把快照写回 DOM + runtime（撤销 / 重做共用，不参与「用户操作」入栈） */
  const applySnapshot = useCallback(
    function (entry: ComposerHistoryEntry) {
      atomsRef.current = entry.atoms
      const root = editorRef.current
      if (root) {
        renderDocument(root, entry.atoms)
        if (document.activeElement === root) placeCaret(root, entry.atoms, entry.cursor)
      }
      const next = serializeDocument(entry.atoms)
      lastPushedRef.current = next
      aui.composer.setText(next, { origin: 'user' })
    },
    [aui]
  )

  const undo = useCallback(
    function () {
      const entry = historyRef.current?.undo(snapshot())
      if (entry) applySnapshot(entry)
    },
    [applySnapshot, snapshot]
  )

  const redo = useCallback(
    function () {
      const entry = historyRef.current?.redo(snapshot())
      if (entry) applySnapshot(entry)
    },
    [applySnapshot, snapshot]
  )

  /** 把 atoms 写回 DOM + runtime，并把光标放到指定 offset。 */
  const commit = useCallback(
    function (atoms: ComposerAtom[], cursor: number) {
      // 走到这里的一定是离散的用户操作（chip 删除 / 粘贴 / 触发器选中）
      rememberHistory('discrete')
      atomsRef.current = atoms
      const root = editorRef.current
      if (root) {
        renderDocument(root, atoms)
        if (document.activeElement === root) placeCaret(root, atoms, cursor)
      }
      const next = serializeDocument(atoms)
      lastPushedRef.current = next
      aui.composer.setText(next, { origin: 'user' })
    },
    [aui, rememberHistory]
  )

  /**
   * 触发器回写文本。
   *
   * `complete`（Tab 补全）**不关面板**：补完立刻用新文本再 sync 一次，让候选按补全后的
   * query 继续过滤，用户接着敲字或再按 Tab / Enter 落 chip。
   */
  const applyEdit = useCallback(
    function (edit: ComposerEditRequest) {
      const atoms = atomsRef.current
      if (edit.kind === 'chip') {
        const chip = buildChip(edit.chip.type, edit.chip.label, edit.chip.id)
        commit(
          replaceRange(atoms, edit.start, edit.end, [chip]),
          edit.start + chip.serialized.length
        )
        return
      }
      if (edit.kind === 'text') {
        const next = replaceRange(atoms, edit.start, edit.end, parseInlineText(edit.text))
        const cursor = edit.start + edit.text.length
        commit(next, cursor)
        if (edit.complete === true) {
          const root = editorRef.current
          const matched = trigger?.sync(serializeTriggerText(next), cursor) ?? null
          if (root) paintTriggerHighlight(root, next, matched)
        }
        return
      }
      commit(replaceRange(atoms, edit.start, edit.end, []), edit.start)
    },
    [commit, trigger]
  )

  useEffect(
    function () {
      return trigger?.attachApply(applyEdit)
    },
    [trigger, applyEdit]
  )

  // runtime → DOM：外部 setText（发送后清空、恢复草稿、编辑态回填）时重建
  useEffect(
    function () {
      if (text === lastPushedRef.current) return
      // 不是自己 push 出去的变化：撤销栈必须清掉，否则撤销会「复活」已发送的内容
      clearHistory()
      lastPushedRef.current = text
      const atoms = parseDocument(text)
      atomsRef.current = atoms
      const root = editorRef.current
      if (!root) return
      renderDocument(root, atoms)
      if (document.activeElement === root) placeCaret(root, atoms, documentLength(atoms))
    },
    [clearHistory, text]
  )

  // 首次挂载 + 消息切换时按 runtime 现状渲染
  useEffect(
    function () {
      const root = editorRef.current
      if (!root) return
      const atoms = parseDocument(aui.composer.getState().text)
      lastPushedRef.current = serializeDocument(atoms)
      atomsRef.current = atoms
      renderDocument(root, atoms)
      if (autoFocus) {
        root.focus()
        // 编辑已有消息时光标要落在末尾，而不是默认的行首
        placeCaret(root, atoms, documentLength(atoms))
      }
    },
    [aui, autoFocus]
  )

  // 新一轮 run 开始时把焦点交回输入框（对齐旧 Input 的 FocusPlugin 行为）
  useEffect(
    function () {
      return aui.on('thread.runStart', function () {
        // 新回合意味着上一段草稿已成历史，撤销不该跨回合复活它
        clearHistory()
        editorRef.current?.focus()
      })
    },
    [aui, clearHistory]
  )

  // 纯光标移动（点选/方向键）也要刷新触发器命中
  useEffect(
    function () {
      if (!trigger) return undefined
      function handleSelectionChange() {
        const root = editorRef.current
        if (!root || document.activeElement !== root) return
        const atoms = atomsRef.current
        const cursor = readSelectionOffset(root, atoms)
        if (cursor === null) return
        const matched = trigger?.sync(serializeTriggerText(atoms), cursor) ?? null
        paintTriggerHighlight(root, atoms, matched)
      }
      document.addEventListener('selectionchange', handleSelectionChange)
      return function () {
        document.removeEventListener('selectionchange', handleSelectionChange)
      }
    },
    [trigger]
  )

  // 触发命中时给 `@…` / `/…` 上色；关闭或卸载时清掉
  useEffect(
    function () {
      const root = editorRef.current
      if (!root) return
      paintTriggerHighlight(root, atomsRef.current, trigger?.match ?? null)
      return clearTriggerHighlights
    },
    [trigger?.match]
  )

  const handleInput = useCallback(
    function (event: React.FormEvent<HTMLDivElement>) {
      const root = editorRef.current
      if (!root) return
      const atoms = readDom(root)
      const composing =
        (event.nativeEvent as InputEvent).isComposing === true || composingRef.current
      // 组合输入期间的中间态不进撤销栈（候选词确认后那一次输入已经记过）
      if (!composing) rememberHistory('typing')
      atomsRef.current = atoms
      const next = serializeDocument(atoms)

      if (next !== lastPushedRef.current) {
        lastPushedRef.current = next
        aui.composer.setText(next, { origin: 'user' })
      }
      if (composing || !trigger) {
        if (!composing) paintTriggerHighlight(root, atoms, null)
        return
      }
      const cursor = readSelectionOffset(root, atoms)
      if (cursor === null) return
      // sync 同步返回命中，立刻上色，不等 React 状态回写
      const matched = trigger.sync(serializeTriggerText(atoms), cursor)
      paintTriggerHighlight(root, atoms, matched)
    },
    [aui, rememberHistory, trigger]
  )

  const handleKeyDown = useCallback(
    function (event: KeyboardEvent<HTMLDivElement>) {
      // 组合输入期间一律放行：Enter 是「确认候选词」，方向键是选词
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === IME_KEY_CODE) return

      // 撤销 / 重做自己接管：DOM 每次都是重建的，浏览器原生栈与文档真值已经对不上
      const withModifier = event.ctrlKey || event.metaKey
      if (withModifier && !event.altKey) {
        const key = event.key.toLowerCase()
        if (key === 'z') {
          event.preventDefault()
          if (event.shiftKey) redo()
          else undo()
          return
        }
        if (key === 'y') {
          event.preventDefault()
          redo()
          return
        }
      }

      // Escape：先关候选；没有候选时退出输入（不清空草稿 —— 误按不该毁掉一屏文本）
      if (event.key === 'Escape' && !trigger?.match) {
        const root = editorRef.current
        if (root && document.activeElement === root) {
          event.preventDefault()
          root.blur()
          return
        }
      }

      const active = trigger?.match ?? null
      if (active) {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          trigger?.move(1)
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          trigger?.move(-1)
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          trigger?.pick()
          return
        }
        // Tab 只补全，不确认：补完继续打字能缩小范围，Enter 才落成 chip
        if (event.key === 'Tab') {
          event.preventDefault()
          trigger?.complete()
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          trigger?.close()
          return
        }
      }

      // chip 整块删除：contenteditable=false 的默认行为各浏览器不一致，自己算
      if (event.key === 'Backspace' || event.key === 'Delete') {
        const root = editorRef.current
        const atoms = atomsRef.current
        const cursor = root ? readSelectionRange(root, atoms) : null
        if (cursor !== null && cursor.start === cursor.end) {
          if (event.key === 'Backspace') {
            const ending = findAtomEndingAt(atoms, cursor.start)
            if (ending?.atom.kind === 'chip') {
              event.preventDefault()
              commit(replaceRange(atoms, ending.start, cursor.start, []), ending.start)
              return
            }
          } else {
            const starting = findAtomStartingAt(atoms, cursor.start)
            if (starting?.atom.kind === 'chip') {
              const end = starting.start + atomLength(starting.atom)
              event.preventDefault()
              commit(replaceRange(atoms, starting.start, end, []), starting.start)
              return
            }
          }
        }
        // 普通字符删除交回浏览器（含跨 chip 的选区删除）
        return
      }

      if (event.key !== 'Enter' || event.shiftKey) return

      if (submitMode === 'ctrlEnter' && !event.ctrlKey && !event.metaKey) return
      if (submitMode === 'enter' && (event.ctrlKey || event.metaKey)) return

      const thread = aui.thread.getState()
      const composer = aui.composer.getState()
      if (!composer.canSend) return
      if (thread.isRunning && !thread.capabilities.queue) return

      event.preventDefault()
      // 与发送按钮共用同一出口：运行中 Enter = 入队，Ctrl/Cmd+Enter = 插队
      sendFromComposer(aui, { steer: event.ctrlKey || event.metaKey })
    },
    [aui, commit, redo, submitMode, trigger, undo]
  )

  const handlePaste = useCallback(
    function (event: ClipboardEvent<HTMLDivElement>) {
      // 带文件的粘贴交给壳（ComposerPaste → attachPastedFiles）
      if ((event.clipboardData?.files.length ?? 0) > 0) return

      // 同框复制优先：私有 MIME 保住了 chip 的语义
      const payload = event.clipboardData?.getData(COMPOSER_CLIPBOARD_MIME) ?? ''
      const fromPayload = payload.length > 0 ? fromClipboardPayload(payload) : null
      const plain = event.clipboardData?.getData('text/plain') ?? ''
      const insert = fromPayload ?? (plain.length > 0 ? parseDocument(plain) : null)
      if (insert === null || insert.length === 0) return
      event.preventDefault()

      const root = editorRef.current
      if (!root) return
      const atoms = atomsRef.current
      const range = readSelectionRange(root, atoms)
      const start = range?.start ?? documentLength(atoms)
      const end = range?.end ?? start
      commit(replaceRange(atoms, start, end, insert), start + documentLength(insert))
    },
    [commit]
  )

  /**
   * 复制：`text/plain` 写线格式（`@<id>`），另存一份私有 MIME 保住 chip 语义；
   * 只带 `text/plain` 的话，粘回来只剩一段裸文本。
   */
  const handleCopy = useCallback(function (event: ClipboardEvent<HTMLDivElement>) {
    const root = editorRef.current
    if (!root) return
    const range = readSelectionRange(root, atomsRef.current)
    if (range === null || range.start === range.end) return
    const sliced = sliceAtoms(atomsRef.current, range.start, range.end)
    if (sliced.length === 0) return
    event.preventDefault()
    event.clipboardData.setData('text/plain', serializeDocument(sliced))
    event.clipboardData.setData(COMPOSER_CLIPBOARD_MIME, JSON.stringify(toClipboardPayload(sliced)))
  }, [])

  const handleCompositionStart = useCallback(function () {
    composingRef.current = true
  }, [])
  const handleCompositionEnd = useCallback(
    function (_event: CompositionEvent<HTMLDivElement>) {
      composingRef.current = false
      const root = editorRef.current
      if (!root || !trigger) return
      const atoms = atomsRef.current
      const cursor = readSelectionOffset(root, atoms)
      if (cursor === null) return
      const matched = trigger.sync(serializeTriggerText(atoms), cursor)
      paintTriggerHighlight(root, atoms, matched)
    },
    [trigger]
  )

  /** 失焦关掉候选；点候选面板时 mousedown 已 preventDefault，不会误关。 */
  const handleBlur = useCallback(
    function () {
      window.setTimeout(function () {
        if (editorRef.current === document.activeElement) return
        trigger?.close()
        clearTriggerHighlights()
      }, 0)
    },
    [trigger]
  )

  /** 重新聚焦时若仍停在 `@…` / `/…` 上，再打开候选并上色。 */
  const handleFocus = useCallback(
    function () {
      const root = editorRef.current
      if (!root || !trigger) return
      const atoms = atomsRef.current
      const cursor = readSelectionOffset(root, atoms) ?? documentLength(atoms)
      const matched = trigger.sync(serializeTriggerText(atoms), cursor)
      paintTriggerHighlight(root, atoms, matched)
    },
    [trigger]
  )

  // 去空白后为空才算空：几个空格不该让占位符消失、也不该让发送亮起来
  const isEmpty = text.trim().length === 0

  return (
    <div
      ref={editorRef}
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel ?? placeholder}
      aria-disabled={isDisabled}
      title={isDisabled ? labels.composerDisabledHint : undefined}
      aria-placeholder={placeholder}
      data-placeholder={placeholder}
      data-empty={isEmpty ? 'true' : undefined}
      contentEditable={!isDisabled}
      spellCheck={false}
      suppressContentEditableWarning
      className={cn(
        'aui-composer-input caret-primary min-h-12 w-full overflow-y-auto px-1 py-1 text-sm leading-6 outline-none',
        'max-h-36 whitespace-pre-wrap wrap-break-word',
        isDisabled && 'cursor-not-allowed opacity-60',
        className
      )}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onCopy={handleCopy}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
    />
  )
}

export {
  CHIP_CLASS,
  COMPOSER_CLIPBOARD_MIME,
  COMPOSER_INPUT_SELECTOR,
  ComposerInput,
  focusComposerInput
}
export type { ComposerInputProps }
