/**
 * composer 的文档模型。
 *
 * `ComposerAtom[]` 是输入区的结构化真值，序列化后的字符串同步给
 * `aui.composer.setText()`。为什么不是「纯文本 DOM 即真值」：
 * chip（`:browser[browser-2]`）在 DOM 里只显示 `browser-2`，DOM 文本长度与
 * runtime 文本长度不一致，光标 offset 会整体错位。节点模型让「逻辑 offset」与
 * 「DOM 位置」各持一套坐标，由 `locateOffset` / `readDom` 互转。
 *
 * 序列化复用 `defaultDirectiveFormatter`（语法 `:type[label]{name=id}`），
 * 所以 `apps/client/src/features/agent/model/prompts.ts` 里
 * 「文本形如 :browser[browser-2]」的约定、以及 MCP 的 tab 参数解析都不用改。
 */
import { defaultDirectiveFormatter } from '@assistant-ui/react'

const LINE_BREAK = '\n'

/** 这些标签在 contentEditable 里代表「换行」，读 DOM 时要折成 `break`。 */
const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DIV',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'UL'
])

interface ComposerTextAtom {
  readonly kind: 'text'
  readonly text: string
}

interface ComposerBreakAtom {
  readonly kind: 'break'
}

interface ComposerChipAtom {
  readonly kind: 'chip'
  readonly type: string
  readonly label: string
  readonly id: string
  /** 序列化后的文本（`:type[label]{name=id}`），parse 时算好，热路径直接用。 */
  readonly serialized: string
}

type ComposerAtom = ComposerTextAtom | ComposerBreakAtom | ComposerChipAtom

const BREAK: ComposerBreakAtom = { kind: 'break' }

function buildChip(type: string, label: string, id: string): ComposerChipAtom {
  return { kind: 'chip', type, label, id, serialized: defaultDirectiveFormatter.serialize({ type, label, id }) }
}

function atomLength(atom: ComposerAtom) {
  if (atom.kind === 'text') return atom.text.length
  if (atom.kind === 'break') return LINE_BREAK.length
  return atom.serialized.length
}

function splitText(text: string): ComposerAtom[] {
  const atoms: ComposerAtom[] = []
  const parts = text.split(LINE_BREAK)
  parts.forEach(function (part, index) {
    if (index > 0) atoms.push(BREAK)
    if (part.length > 0) atoms.push({ kind: 'text', text: part })
  })
  return atoms
}

/**
 * 合并相邻文本、丢弃空文本；`break` 原样保留（`\n\n` 是有效空行）。
 */
function normalizeDocument(atoms: readonly ComposerAtom[]): ComposerAtom[] {
  const out: ComposerAtom[] = []
  atoms.forEach(function (atom) {
    if (atom.kind === 'text') {
      if (atom.text.length === 0) return
      const previous = out[out.length - 1]
      if (previous?.kind === 'text') {
        out[out.length - 1] = { kind: 'text', text: previous.text + atom.text }
        return
      }
      out.push(atom)
      return
    }
    out.push(atom)
  })
  return out
}

/** 文本 → 节点。directive 段折成 chip，其余按换行折成 `break`。 */
function parseDocument(text: string): ComposerAtom[] {
  if (text.length === 0) return []
  const atoms: ComposerAtom[] = []
  const segments = defaultDirectiveFormatter.parse(text)
  for (const segment of segments) {
    if (segment.kind === 'text') {
      atoms.push(...splitText(segment.text))
      continue
    }
    atoms.push(buildChip(segment.type, segment.label, segment.id))
  }
  return normalizeDocument(atoms)
}

/** 节点 → 文本。这是写给 runtime 的唯一字符串。 */
function serializeDocument(atoms: readonly ComposerAtom[]): string {
  let text = ''
  for (const atom of atoms) {
    if (atom.kind === 'text') text += atom.text
    else if (atom.kind === 'break') text += LINE_BREAK
    else text += atom.serialized
  }
  return text
}

function documentLength(atoms: readonly ComposerAtom[]) {
  let length = 0
  for (const atom of atoms) length += atomLength(atom)
  return length
}

function isEmptyDocument(atoms: readonly ComposerAtom[]) {
  return atoms.length === 0
}

/**
 * 逻辑 offset → 节点位置。正好落在某个节点末尾时归属该节点（`charOffset === length`），
 * 这样「光标在 chip 之后」与「光标在下一个文本开头」不会互相打架。
 */
function locateOffset(atoms: readonly ComposerAtom[], offset: number) {
  const total = documentLength(atoms)
  const clamped = Math.min(Math.max(offset, 0), total)
  let remaining = clamped
  for (let index = 0; index < atoms.length; index += 1) {
    const length = atomLength(atoms[index])
    if (remaining <= length) return { atomIndex: index, charOffset: remaining }
    remaining -= length
  }
  return { atomIndex: atoms.length, charOffset: 0 }
}

function offsetOf(atoms: readonly ComposerAtom[], atomIndex: number, charOffset: number) {
  const limit = Math.min(Math.max(atomIndex, 0), atoms.length)
  let offset = 0
  for (let index = 0; index < limit; index += 1) offset += atomLength(atoms[index])
  const atom = atoms[limit]
  if (!atom) return offset
  return offset + Math.min(Math.max(charOffset, 0), atomLength(atom))
}

/** 取 `[from, to)` 区间内的节点；chip / break 被部分覆盖时整体计入。 */
function sliceAtoms(atoms: readonly ComposerAtom[], from: number, to: number): ComposerAtom[] {
  const out: ComposerAtom[] = []
  let offset = 0
  for (const atom of atoms) {
    const length = atomLength(atom)
    const atomStart = offset
    const atomEnd = atomStart + length
    offset = atomEnd
    if (atomEnd <= from || atomStart >= to) continue
    if (atom.kind === 'text') {
      const sliceStart = Math.max(0, from - atomStart)
      const sliceEnd = Math.min(length, to - atomStart)
      const text = atom.text.slice(sliceStart, sliceEnd)
      if (text.length > 0) out.push({ kind: 'text', text })
      continue
    }
    if (atomStart >= from && atomEnd <= to) out.push(atom)
  }
  return out
}

function replaceRange(
  atoms: readonly ComposerAtom[],
  start: number,
  end: number,
  insert: readonly ComposerAtom[]
): ComposerAtom[] {
  const from = Math.min(Math.max(start, 0), end)
  const to = Math.max(start, end)
  const total = documentLength(atoms)
  return normalizeDocument([...sliceAtoms(atoms, 0, from), ...insert, ...sliceAtoms(atoms, to, total)])
}

function insertTextAt(atoms: readonly ComposerAtom[], offset: number, text: string): ComposerAtom[] {
  return replaceRange(atoms, offset, offset, splitText(text))
}

function insertChipAt(atoms: readonly ComposerAtom[], offset: number, chip: ComposerChipAtom): ComposerAtom[] {
  return replaceRange(atoms, offset, offset, [chip])
}

/**
 * 光标（offset）是否紧跟某个原子之后 —— Backspace 用来决定「删一个字」还是「删整块 chip」。
 * 返回该原子的起点，没有则 `null`。
 */
function findAtomEndingAt(atoms: readonly ComposerAtom[], offset: number) {
  let position = 0
  for (const atom of atoms) {
    position += atomLength(atom)
    if (position === offset) return { atom, start: position - atomLength(atom) }
  }
  return null
}

function pushText(atoms: ComposerAtom[], text: string) {
  if (text.length === 0) return
  atoms.push(...splitText(text))
}

function collectNode(node: ChildNode, atoms: ComposerAtom[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    pushText(atoms, node.nodeValue ?? '')
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return

  const element = node as HTMLElement
  const chipType = element.dataset.chipType
  if (chipType !== undefined) {
    atoms.push(buildChip(chipType, element.dataset.chipLabel ?? '', element.dataset.chipId ?? ''))
    return
  }
  if (element.tagName === 'BR') {
    atoms.push(BREAK)
    return
  }
  if (BLOCK_TAGS.has(element.tagName)) {
    // 块级元素之间是一处换行；首个块不额外补（文档开头没有前驱）
    if (atoms.length > 0) atoms.push(BREAK)
    for (const child of Array.from(element.childNodes)) collectNode(child, atoms)
    return
  }
  for (const child of Array.from(element.childNodes)) collectNode(child, atoms)
}

/**
 * 从 contentEditable 的 DOM 重建节点。
 *
 * chip 的全部信息都在 `data-chip-*` 属性上，不依赖任何运行时注册表 ——
 * 页面刷新、消息回填、复制粘贴过来的 chip 都能原样恢复。
 */
function readDom(root: HTMLElement): ComposerAtom[] {
  // 空编辑器：浏览器会留一个占位 `<br>`，它不是用户输入的换行
  if (root.childNodes.length === 1 && root.firstChild?.nodeName === 'BR') return []

  const atoms: ComposerAtom[] = []
  for (const child of Array.from(root.childNodes)) collectNode(child, atoms)
  return normalizeDocument(atoms)
}

export {
  LINE_BREAK,
  atomLength,
  buildChip,
  documentLength,
  findAtomEndingAt,
  insertChipAt,
  insertTextAt,
  isEmptyDocument,
  locateOffset,
  normalizeDocument,
  offsetOf,
  parseDocument,
  readDom,
  replaceRange,
  serializeDocument,
  sliceAtoms,
  splitText as parseInlineText
}
export type { ComposerAtom, ComposerBreakAtom, ComposerChipAtom, ComposerTextAtom }
