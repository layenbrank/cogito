import styles from './agent-sender.module.scss'
import type { SenderChip } from './sender-trigger'

const CHIP_ATTR = 'data-agent-chip'
const CHIP_VALUE_ATTR = 'data-value'
const CHIP_KIND_ATTR = 'data-kind'
const CHIP_PATH_ATTR = 'data-path'
const CHIP_CLOSE_ATTR = 'data-chip-close'

function normalizeChipPath(path: string) {
  return path.replace(/\\/g, '/')
}

function findChipPathKey(chip: Pick<SenderChip, 'meta' | 'value' | 'kind'>) {
  const fromMeta = chip.meta.path || chip.meta.relative || ''
  if (fromMeta) return normalizeChipPath(fromMeta)
  const raw = chip.value.replace(/^[@/]/, '')
  return raw ? normalizeChipPath(raw) : ''
}

function findChipPathsFromDom(root: HTMLElement) {
  const paths: string[] = []
  const seen = new Set<string>()
  root.querySelectorAll(`[${CHIP_ATTR}="true"]`).forEach(function (node) {
    const el = node as HTMLElement
    const path = el.getAttribute(CHIP_PATH_ATTR) || ''
    if (!path) return
    const normalized = normalizeChipPath(path)
    if (seen.has(normalized)) return
    seen.add(normalized)
    paths.push(normalized)
  })
  return paths
}

function findChipsFromDom(root: HTMLElement) {
  const chips: SenderChip[] = []
  root.querySelectorAll(`[${CHIP_ATTR}="true"]`).forEach(function (node, index) {
    const el = node as HTMLElement
    const path = el.getAttribute(CHIP_PATH_ATTR) || ''
    const kind = el.getAttribute(CHIP_KIND_ATTR) || 'file'
    const value = el.getAttribute(CHIP_VALUE_ATTR) || ''
    const label = el.dataset.label || el.querySelector(`.${styles.chipLabel}`)?.textContent || ''
    const relative = el.dataset.relative || ''
    chips.push({
      id: el.dataset.chipId || `chip-dom-${index}`,
      kind,
      label,
      value,
      meta: {
        path: path ? normalizeChipPath(path) : '',
        relative: relative ? normalizeChipPath(relative) : '',
        name: label
      }
    })
  })
  return chips
}

function findPlainTextFromDom(root: HTMLElement) {
  let result = ''
  root.childNodes.forEach(function (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent || ''
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    if (el.getAttribute(CHIP_ATTR) === 'true') {
      result += '\uFFFC'
      return
    }
    if (el.tagName === 'BR') {
      result += '\n'
      return
    }
    result += findPlainTextFromDom(el)
  })
  return result
}

/** 触发检测用：chip 按占位符计入，避免 @path 序列化导致幽灵触发 */
function findPlainTextBeforeCaret(root: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return findPlainTextFromDom(root)
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return findPlainTextFromDom(root)
  const pre = range.cloneRange()
  pre.selectNodeContents(root)
  pre.setEnd(range.startContainer, range.startOffset)
  const frag = pre.cloneContents()
  const holder = document.createElement('div')
  holder.appendChild(frag)
  return findPlainTextFromDom(holder)
}

function findValueFromDom(root: HTMLElement) {
  let result = ''
  root.childNodes.forEach(function (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent || ''
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    if (el.getAttribute(CHIP_ATTR) === 'true') {
      result += el.getAttribute(CHIP_VALUE_ATTR) || ''
      return
    }
    if (el.tagName === 'BR') {
      result += '\n'
      return
    }
    result += findValueFromDom(el)
  })
  return result
}

function findTextBeforeCaret(root: HTMLElement) {
  return findPlainTextBeforeCaret(root)
}

function placeCaretAfter(node: Node) {
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.setStartAfter(node)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function deleteTriggerToken(tokenLength: number) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || tokenLength <= 0) return

  let remaining = tokenLength
  while (remaining > 0) {
    const range = selection.getRangeAt(0)
    let node: Node | null = range.startContainer
    let offset = range.startOffset

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (offset === 0) break
      const child = el.childNodes[offset - 1]
      if (!child) break
      if (child.nodeType === Node.TEXT_NODE) {
        node = child
        offset = (child.textContent || '').length
      } else {
        break
      }
    }

    if (!node || node.nodeType !== Node.TEXT_NODE) break
    const text = node.textContent || ''
    const take = Math.min(remaining, offset)
    if (take <= 0) break
    node.textContent = text.slice(0, offset - take) + text.slice(offset)
    remaining -= take
    const nextOffset = offset - take
    const r = document.createRange()
    r.setStart(node, nextOffset)
    r.collapse(true)
    selection.removeAllRanges()
    selection.addRange(r)
    if (!(node.textContent || '').length) {
      node.parentNode?.removeChild(node)
    }
  }
}

export {
  CHIP_ATTR,
  CHIP_CLOSE_ATTR,
  CHIP_KIND_ATTR,
  CHIP_PATH_ATTR,
  CHIP_VALUE_ATTR,
  deleteTriggerToken,
  findChipPathKey,
  findChipPathsFromDom,
  findChipsFromDom,
  findTextBeforeCaret,
  findValueFromDom,
  normalizeChipPath,
  placeCaretAfter
}
