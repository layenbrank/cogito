/**
 * 自研 contentEditable 输入区。
 *
 * 分工：
 * - **文档真值**在 `atomsRef`（`ComposerAtom[]`），序列化后同步给 `aui.composer.setText()`。
 * - **DOM 是视图**：`renderDocument` 从 atoms 重建，`readDom` 从 DOM 反推 atoms。
 *   用户敲键时走浏览器默认行为（IME / 拼写检查 / 撤销栈都保留），
 *   `onInput` 之后才把 DOM 读回 atoms 并 push 给 runtime。
 * - **光标**用「逻辑 offset」表示，落在 chip 上时按整块长度算，
 *   所以 `:browser[browser-2]` 在视觉上是一个小方块，但在 offset 坐标里占 19 格。
 *
 * 键位、IME、粘贴、触发器联动全部集中在这个文件，壳上的 `onKeyDownCapture`
 * （原 `useComposerQueueKeyCapture`）已并入，避免两条 Enter 决策路径。
 */
import { useAui, useAuiState } from '@assistant-ui/react'
import { cn } from 'cn'
import { useCallback, useEffect, useRef, type ClipboardEvent, type CompositionEvent, type KeyboardEvent } from 'react'

import {
  atomLength,
  buildChip,
  documentLength,
  findAtomEndingAt,
  locateOffset,
  parseDocument,
  parseInlineText,
  readDom,
  replaceRange,
  serializeDocument,
  sliceAtoms,
  type ComposerAtom,
  type ComposerChipAtom
} from './composer-document'
import { useComposerTrigger, type ComposerEditRequest } from './composer-trigger'

const CHIP_CLASS = 'aui-composer-chip'

/** 组合输入期间按下的键码（Chrome 在 IME 组合时会给 keyCode 229）。 */
const IME_KEY_CODE = 229

function renderChip(atom: ComposerChipAtom) {
  const span = document.createElement('span')
  span.dataset.chipType = atom.type
  span.dataset.chipLabel = atom.label
  span.dataset.chipId = atom.id
  span.contentEditable = 'false'
  span.className = CHIP_CLASS
  span.textContent = atom.label
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

interface ComposerInputProps {
  readonly placeholder?: string | undefined
  readonly className?: string | undefined
  readonly autoFocus?: boolean | undefined
  readonly submitMode?: 'enter' | 'ctrlEnter' | undefined
  readonly 'aria-label'?: string | undefined
}

function ComposerInput(props: ComposerInputProps) {
  const { placeholder, className, autoFocus = false, submitMode = 'enter', 'aria-label': ariaLabel } = props
  const aui = useAui()
  const trigger = useComposerTrigger()
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

  /** 把 atoms 写回 DOM + runtime，并把光标放到指定 offset。 */
  const commit = useCallback(
    function (atoms: ComposerAtom[], cursor: number) {
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
    [aui]
  )

  /** 触发器选中后回写文本。 */
  const applyEdit = useCallback(
    function (edit: ComposerEditRequest) {
      const atoms = atomsRef.current
      if (edit.kind === 'chip') {
        const chip = buildChip(edit.chip.type, edit.chip.label, edit.chip.id)
        commit(replaceRange(atoms, edit.start, edit.end, [chip]), edit.start + chip.serialized.length)
        return
      }
      if (edit.kind === 'text') {
        commit(replaceRange(atoms, edit.start, edit.end, parseInlineText(edit.text)), edit.start + edit.text.length)
        return
      }
      commit(replaceRange(atoms, edit.start, edit.end, []), edit.start)
    },
    [commit]
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
      lastPushedRef.current = text
      const atoms = parseDocument(text)
      atomsRef.current = atoms
      const root = editorRef.current
      if (!root) return
      renderDocument(root, atoms)
      if (document.activeElement === root) placeCaret(root, atoms, documentLength(atoms))
    },
    [text]
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
        editorRef.current?.focus()
      })
    },
    [aui]
  )

  // 纯光标移动（点选/方向键）也要刷新触发器命中
  useEffect(
    function () {
      if (!trigger) return undefined
      function handleSelectionChange() {
        const root = editorRef.current
        if (!root || document.activeElement !== root) return
        const cursor = readSelectionOffset(root, atomsRef.current)
        if (cursor === null) return
        trigger?.sync(serializeDocument(atomsRef.current), cursor)
      }
      document.addEventListener('selectionchange', handleSelectionChange)
      return function () {
        document.removeEventListener('selectionchange', handleSelectionChange)
      }
    },
    [trigger]
  )

  const handleInput = useCallback(
    function (event: React.FormEvent<HTMLDivElement>) {
      const root = editorRef.current
      if (!root) return
      const atoms = readDom(root)
      atomsRef.current = atoms
      const next = serializeDocument(atoms)
      const composing = (event.nativeEvent as InputEvent).isComposing === true || composingRef.current

      if (next !== lastPushedRef.current) {
        lastPushedRef.current = next
        aui.composer.setText(next, { origin: 'user' })
      }
      if (composing || !trigger) return
      const cursor = readSelectionOffset(root, atoms)
      if (cursor === null) return
      trigger.sync(next, cursor)
    },
    [aui, trigger]
  )

  const handleKeyDown = useCallback(
    function (event: KeyboardEvent<HTMLDivElement>) {
      // 组合输入期间一律放行：Enter 是「确认候选词」，方向键是选词
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === IME_KEY_CODE) return

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
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault()
          trigger?.pick()
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          trigger?.close()
          return
        }
      }

      if (event.key !== 'Enter' || event.shiftKey) return

      const root = editorRef.current
      const cursor = root ? readSelectionOffset(root, atomsRef.current) : null
      if (cursor !== null) {
        const ending = findAtomEndingAt(atomsRef.current, cursor)
        // 光标紧跟 chip：整块删除（不同浏览器对 contenteditable=false 的行为不一致）
        if (ending?.atom.kind === 'chip') {
          event.preventDefault()
          commit(replaceRange(atomsRef.current, ending.start, cursor, []), ending.start)
          return
        }
      }

      if (submitMode === 'ctrlEnter' && !event.ctrlKey && !event.metaKey) return
      if (submitMode === 'enter' && (event.ctrlKey || event.metaKey)) return

      const thread = aui.thread.getState()
      const composer = aui.composer.getState()
      if (!composer.canSend) return
      if (thread.isRunning && !thread.capabilities.queue) return

      event.preventDefault()
      aui.composer.send(thread.isRunning && thread.capabilities.queue ? { steer: event.ctrlKey || event.metaKey } : undefined)
    },
    [aui, commit, submitMode, trigger]
  )

  const handlePaste = useCallback(
    function (event: ClipboardEvent<HTMLDivElement>) {
      // 带文件的粘贴交给壳（ComposerPaste → attachPastedFiles）
      if ((event.clipboardData?.files.length ?? 0) > 0) return
      const plain = event.clipboardData?.getData('text/plain')
      if (plain === undefined || plain.length === 0) return
      event.preventDefault()

      const root = editorRef.current
      if (!root) return
      const atoms = atomsRef.current
      const range = readSelectionRange(root, atoms)
      const start = range?.start ?? documentLength(atoms)
      const end = range?.end ?? start
      commit(replaceRange(atoms, start, end, parseInlineText(plain)), start + plain.length)
    },
    [commit]
  )

  /**
   * 复制时把 chip 写成序列化文本，否则带出去只有 `browser-2` 这串标签，
   * 粘到别处 / 粘贴回来都会丢掉 directive 语义。
   */
  const handleCopy = useCallback(function (event: ClipboardEvent<HTMLDivElement>) {
    const root = editorRef.current
    if (!root) return
    const range = readSelectionRange(root, atomsRef.current)
    if (range === null || range.start === range.end) return
    const text = serializeDocument(sliceAtoms(atomsRef.current, range.start, range.end))
    event.preventDefault()
    event.clipboardData.setData('text/plain', text)
  }, [])

  const handleCompositionStart = useCallback(function () {
    composingRef.current = true
  }, [])
  const handleCompositionEnd = useCallback(
    function (_event: CompositionEvent<HTMLDivElement>) {
      composingRef.current = false
      const root = editorRef.current
      if (!root || !trigger) return
      const cursor = readSelectionOffset(root, atomsRef.current)
      if (cursor === null) return
      trigger.sync(serializeDocument(atomsRef.current), cursor)
    },
    [trigger]
  )

  const isEmpty = text.length === 0

  return (
    <div
      ref={editorRef}
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel ?? placeholder}
      aria-disabled={isDisabled}
      aria-placeholder={placeholder}
      data-placeholder={placeholder}
      data-empty={isEmpty ? 'true' : undefined}
      contentEditable={!isDisabled}
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
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
    />
  )
}

export { CHIP_CLASS, ComposerInput }
export type { ComposerInputProps }
