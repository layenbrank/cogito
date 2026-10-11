import {
  useEffect,
  useImperativeHandle,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type Ref
} from 'react'

import { buildChipElement } from './agent-sender-chip'
import {
  CHIP_ATTR,
  CHIP_CLOSE_ATTR,
  CHIP_PATH_ATTR,
  deleteTriggerToken,
  findChipPathKey,
  findChipPathsFromDom,
  findChipsFromDom,
  findTextBeforeCaret,
  findValueFromDom,
  normalizeChipPath,
  placeCaretAfter
} from './agent-sender-dom'
import { collectClipboardImages } from './paste-image'
import {
  parseTriggerToken,
  TRIGGER_RULES,
  type SenderChip,
  type TriggerMatch,
  type TriggerRule
} from './sender-trigger'

interface AgentSenderHandle {
  focus: () => void
  clear: (options?: { silent?: boolean }) => void
  writePlainText: (text: string) => void
  submit: () => void
  insertChip: (chip: Omit<SenderChip, 'id'> & { id?: string }) => void
  removeChipByPath: (path: string) => void
  findValue: () => string
  findChipPaths: () => string[]
  findChips: () => SenderChip[]
}

interface UseAgentSenderInput {
  ref: Ref<AgentSenderHandle>
  triggers?: TriggerRule[]
  minRows: number
  maxRows: number
  loading?: boolean
  blockSubmit?: boolean
  disabled?: boolean
  onChange?: (value: string) => void
  onSubmit?: (value: string) => void
  onPasteImages?: (files: File[]) => void
  onTriggerChange?: (match: TriggerMatch | null) => void
  onTriggerKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => boolean
}

const LINE_PX = 24

function useAgentSender(input: UseAgentSenderInput) {
  const editableRef = useRef<HTMLDivElement>(null)
  const isComposing = useRef(false)
  const lastTriggerKey = useRef<string | null>(null)
  const chipSeq = useRef(0)
  const triggers = input.triggers ?? TRIGGER_RULES
  const onTriggerChangeRef = useRef(input.onTriggerChange)
  const triggersRef = useRef(triggers)
  const onTriggerKeyDownRef = useRef(input.onTriggerKeyDown)

  useEffect(
    function () {
      onTriggerChangeRef.current = input.onTriggerChange
      triggersRef.current = triggers
      onTriggerKeyDownRef.current = input.onTriggerKeyDown
    },
    [input.onTriggerChange, input.onTriggerKeyDown, triggers]
  )

  function syncPlaceholder(root: HTMLElement) {
    const empty = findValueFromDom(root).replace(/\s/g, '').length === 0
    root.dataset.empty = empty && root.innerText.trim() === '' ? 'true' : 'false'
    if (root.childNodes.length === 0) root.dataset.empty = 'true'
  }

  function syncHeight(root: HTMLElement) {
    root.style.height = 'auto'
    const minH = input.minRows * LINE_PX
    const maxH = input.maxRows * LINE_PX
    const next = Math.min(maxH, Math.max(minH, root.scrollHeight))
    root.style.height = `${next}px`
  }

  function emitChange() {
    const root = editableRef.current
    if (!root) return
    syncPlaceholder(root)
    syncHeight(root)
    input.onChange?.(findValueFromDom(root))
  }

  function emitTrigger() {
    if (isComposing.current) {
      if (lastTriggerKey.current !== null) {
        lastTriggerKey.current = null
        onTriggerChangeRef.current?.(null)
      }
      return
    }
    const root = editableRef.current
    if (!root) return
    const before = findTextBeforeCaret(root)
    const match = parseTriggerToken(before, triggersRef.current)
    const key = match ? `${match.char}:${match.query}:${match.behaviorId}` : null
    if (key === lastTriggerKey.current) return
    lastTriggerKey.current = key
    onTriggerChangeRef.current?.(match)
  }

  function insertChip(chipInput: Omit<SenderChip, 'id'> & { id?: string }) {
    const root = editableRef.current
    if (!root) return
    const before = findTextBeforeCaret(root)
    const match = parseTriggerToken(before, triggersRef.current)
    if (match) deleteTriggerToken(match.tokenLength)

    const pathKey = findChipPathKey(chipInput)
    if (pathKey && findChipPathsFromDom(root).includes(pathKey)) {
      lastTriggerKey.current = null
      onTriggerChangeRef.current?.(null)
      emitChange()
      root.focus()
      return
    }

    chipSeq.current += 1
    const chip: SenderChip = {
      id: chipInput.id || `chip-${chipSeq.current}`,
      kind: chipInput.kind,
      label: chipInput.label,
      value: chipInput.value,
      meta: chipInput.meta
    }

    const chipEl = buildChipElement(chip)
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0 && root.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0)
      range.collapse(true)
      range.insertNode(chipEl)
      const space = document.createTextNode(' ')
      chipEl.after(space)
      placeCaretAfter(space)
    } else {
      root.appendChild(chipEl)
      const space = document.createTextNode(' ')
      root.appendChild(space)
      placeCaretAfter(space)
    }

    lastTriggerKey.current = null
    onTriggerChangeRef.current?.(null)
    emitChange()
    root.focus()
  }

  function removeChipByPath(path: string) {
    const root = editableRef.current
    if (!root) return
    const normalized = normalizeChipPath(path)
    root.querySelectorAll(`[${CHIP_ATTR}="true"]`).forEach(function (node) {
      const el = node as HTMLElement
      const chipPath = normalizeChipPath(el.getAttribute(CHIP_PATH_ATTR) || '')
      if (chipPath !== normalized) return
      el.remove()
    })
    emitChange()
  }

  function clear(options?: { silent?: boolean }) {
    const root = editableRef.current
    if (!root) return
    root.innerHTML = ''
    lastTriggerKey.current = null
    onTriggerChangeRef.current?.(null)
    if (options?.silent) {
      syncPlaceholder(root)
      syncHeight(root)
      return
    }
    emitChange()
  }

  function writePlainText(text: string) {
    const root = editableRef.current
    if (!root) return
    root.textContent = text
    lastTriggerKey.current = null
    onTriggerChangeRef.current?.(null)
    const selection = window.getSelection()
    if (selection) {
      const range = document.createRange()
      range.selectNodeContents(root)
      range.collapse(false)
      selection.removeAllRanges()
      selection.addRange(range)
    }
    emitChange()
    root.focus()
  }

  function submitFromEditor() {
    if (input.loading || input.blockSubmit || input.disabled) return
    const root = editableRef.current
    if (!root) return
    const value = findValueFromDom(root).trim()
    if (!value) return
    input.onSubmit?.(value)
  }

  useImperativeHandle(input.ref, function () {
    return {
      focus: function () {
        editableRef.current?.focus()
      },
      clear,
      writePlainText,
      submit: submitFromEditor,
      insertChip,
      removeChipByPath,
      findValue: function () {
        const root = editableRef.current
        return root ? findValueFromDom(root) : ''
      },
      findChipPaths: function () {
        const root = editableRef.current
        return root ? findChipPathsFromDom(root) : []
      },
      findChips: function () {
        const root = editableRef.current
        return root ? findChipsFromDom(root) : []
      }
    }
  })

  useEffect(function () {
    function onSelectionChange() {
      const root = editableRef.current
      if (!root) return
      const selection = window.getSelection()
      if (!selection?.anchorNode || !root.contains(selection.anchorNode)) {
        if (lastTriggerKey.current !== null) {
          lastTriggerKey.current = null
          onTriggerChangeRef.current?.(null)
        }
        return
      }
      emitTrigger()
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return function () {
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [])

  function handleInput() {
    emitChange()
    if (!isComposing.current) emitTrigger()
  }

  function handleCompositionStart() {
    isComposing.current = true
    lastTriggerKey.current = null
    onTriggerChangeRef.current?.(null)
  }

  function handleCompositionEnd() {
    isComposing.current = false
    emitChange()
    emitTrigger()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isComposing.current || event.nativeEvent.isComposing) return

    if (onTriggerKeyDownRef.current?.(event)) {
      event.preventDefault()
      return
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitFromEditor()
      return
    }

    if (event.key === 'Backspace') {
      const selection = window.getSelection()
      if (!selection?.isCollapsed || !selection.rangeCount) return
      const range = selection.getRangeAt(0)
      if (range.startOffset !== 0) return
      let prev: Node | null = null
      const node = range.startContainer
      if (node.nodeType === Node.TEXT_NODE) {
        prev = node.previousSibling
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement
        prev = el.childNodes[range.startOffset - 1] || null
      }
      if (prev && (prev as HTMLElement).getAttribute?.(CHIP_ATTR) === 'true') {
        event.preventDefault()
        prev.parentNode?.removeChild(prev)
        emitChange()
        emitTrigger()
      }
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const images = collectClipboardImages(event.clipboardData)
    if (images.length > 0 && input.onPasteImages) {
      event.preventDefault()
      input.onPasteImages(images)
      return
    }
    event.preventDefault()
    const text = event.clipboardData.getData('text/plain')
    if (text) document.execCommand('insertText', false, text)
  }

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    const closeBtn = target.closest<HTMLElement>(`[${CHIP_CLOSE_ATTR}="true"]`)
    if (closeBtn) {
      event.preventDefault()
      event.stopPropagation()
      const chip = closeBtn.closest<HTMLElement>(`[${CHIP_ATTR}="true"]`)
      chip?.remove()
      emitChange()
      emitTrigger()
      editableRef.current?.focus()
      return
    }
    emitTrigger()
  }

  function handleMouseDown(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    if (target.closest(`[${CHIP_CLOSE_ATTR}="true"]`)) return
    if (target.closest(`[${CHIP_ATTR}="true"]`)) {
      event.preventDefault()
    }
  }

  return {
    editableRef,
    handleInput,
    handleCompositionStart,
    handleCompositionEnd,
    handleKeyDown,
    handlePaste,
    handleClick,
    handleMouseDown
  }
}

export { useAgentSender }
export type { AgentSenderHandle }
