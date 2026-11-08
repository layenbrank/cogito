/**
 * composer 的文档模型。
 *
 * `ComposerAtom[]` 是输入区的结构化真值，序列化后的字符串同步给
 * `aui.composer.setText()`。为什么不是「纯文本 DOM 即真值」：chip（`@apps/src/a.ts`）
 * 在 DOM 里只显示短名，DOM 文本长度与 runtime 文本长度不一致，光标 offset 会整体错位。
 * 节点模型让「逻辑 offset」与「DOM 位置」各持一套坐标，由 `locateOffset` / `readDom` 互转。
 *
 * **线格式（方案 B，Cursor 风格）**：`@` + id，id 就是引用路径本身。
 * - 文件 / 文件夹：`@apps/client/src/a.ts`；含空白时 `@"apps/my dir/a.ts"`
 * - 浏览器标签页：`@browser-<uuid>`
 * - 技能：`@skill:<name>`
 *
 * 不再复用 assistant-ui 的 `defaultDirectiveFormatter`（`:type[label]{name=id}`），
 * 也**不保留旧 directive 的解析分支**：旧文本从此按普通文本显示，见计划「不做兼容性代码」。
 * 好处是「光标 offset = 序列化长度」这条不变式只有一个来源，往返恒等：
 * `serialize(buildChip(...)) === '@' + id`。
 */

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
  /** 序列化后的文本（`@id`），parse 时算好，热路径直接用。 */
  readonly serialized: string
}

type ComposerAtom = ComposerTextAtom | ComposerBreakAtom | ComposerChipAtom

const BREAK: ComposerBreakAtom = { kind: 'break' }

/** 技能 id 前缀：与文件路径区分开（`@skill:dingtalk-aitable`） */
const SKILL_PREFIX = 'skill:'

/** 浏览器标签页 id 形如 `browser-<uuid>`；用完整 UUID 正则避免把 `browser-2/a.ts` 误判 */
const BROWSER_TAB_ID = /^browser-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function needsQuote(id: string): boolean {
  return /[\s"]/.test(id)
}

function escapeId(id: string): string {
  return id.replace(/"/g, '\\"')
}

/** `@` 之后的那一串（含按需加的引号） */
function toSerializedPayload(id: string): string {
  return needsQuote(id) ? `"${escapeId(id)}"` : id
}

function buildChip(type: string, label: string, id: string): ComposerChipAtom {
  return { kind: 'chip', type, label, id, serialized: `@${toSerializedPayload(id)}` }
}

/** 线格式不带 type 字段：从 id 的形态反推。 */
function toChipType(id: string): string {
  if (id.startsWith(SKILL_PREFIX)) return 'skill'
  if (BROWSER_TAB_ID.test(id)) return 'browser'
  return 'file'
}

/**
 * label 不进线格式，解析时派生：
 * - file / browser：id 原样（文件路径本身就是最好的显示文本，视图层再截断）
 * - skill：去掉 `skill:` 前缀
 */
function deriveChipLabel(type: string, id: string): string {
  if (type === 'skill') {
    const name = id.slice(SKILL_PREFIX.length)
    return name.length > 0 ? name : id
  }
  return id
}

/**
 * chip 的两段式显示：「…/src/chat.tsx」。
 *
 * 目录段可以被截断（`min-w-0 truncate`），末段保持完整（`shrink-0`），
 * 这样窄窗口里看到的是「…/chat.tsx」而不是被截成「apps/clien…」。
 * skill chip 的 label 已经去掉 `skill:` 前缀，没有目录段。
 */
function splitChipLabel(type: string, label: string, id: string): { dir: string; base: string } {
  if (type === 'skill') return { dir: '', base: label }
  if (type === 'browser') return { dir: '', base: label }
  const slash = id.lastIndexOf('/')
  if (slash <= 0 || slash === id.length - 1) return { dir: '', base: label }
  return { dir: id.slice(0, slash + 1), base: id.slice(slash + 1) }
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

/**
 * `@` 左边允许的字符：行首、空白，或常见的中文/西文标点。
 *
 * 这挡住 `user@example.com`（`@` 左边是字母）与代码里的 `foo@bar`；
 * 而「看下@apps/a.ts」这种不打空格的写法也认。
 */
const BOUNDARY_BEFORE = /[\s\u00a0（(【[「『"'‘“，,、；;：:！!？?\u4e00-\u9fff]/

function isTokenBoundary(previous: string | undefined): boolean {
  if (previous === undefined) return true
  return BOUNDARY_BEFORE.test(previous)
}

/**
 * 只有这些形态才当 chip：含 `/`、`browser-<uuid>`、`skill:` 前缀。
 * `@media` / `@Component` / `@types` 因此仍是普通文本。
 */
function looksLikeMentionId(id: string): boolean {
  if (id.length === 0) return false
  if (id.startsWith(SKILL_PREFIX)) return id.length > SKILL_PREFIX.length
  if (BROWSER_TAB_ID.test(id)) return true
  return id.includes('/')
}

/**
 * 未加引号的 id 在这些字符处结束：空白 + 常见中英文标点。
 * 必须排除：`/` `.` `-` `_` `@` 是路径的一部分，ASCII `:` 是 `skill:` 前缀的分隔符。
 * 这挡住「@apps/a.ts，然后」把逗号并进 id、以及「@apps/a.ts）」
 */
const MENTION_TERMINATOR = /[\s\u00a0"'`,;()[\]{}<>，。；、：！？（）【】「」“”‘’]/

/** 从 `@` 起读一个 mention；引号未闭合时返回 null（按普通文本处理） */
function readMention(text: string, at: number): { id: string; end: number } | null {
  let index = at + 1
  if (text[index] === '"') {
    let id = ''
    index += 1
    while (index < text.length) {
      const char = text[index]
      if (char === '\\' && text[index + 1] === '"') {
        id += '"'
        index += 2
        continue
      }
      if (char === '"') return { id, end: index + 1 }
      id += char
      index += 1
    }
    return null
  }

  const begin = index
  while (index < text.length) {
    const char = text[index]
    if (MENTION_TERMINATOR.test(char)) break
    index += 1
  }
  return { id: text.slice(begin, index), end: index }
}

/** 文本 → 节点。`@mention` 折成 chip，其余按换行折成 `break`。 */
function parseDocument(text: string): ComposerAtom[] {
  if (text.length === 0) return []

  const atoms: ComposerAtom[] = []
  let buffer = ''
  let index = 0

  function flush() {
    if (buffer.length === 0) return
    atoms.push(...splitText(buffer))
    buffer = ''
  }

  while (index < text.length) {
    const char = text[index]
    const isMentionStart = char === '@' && isTokenBoundary(text[index - 1])
    if (!isMentionStart) {
      buffer += char
      index += 1
      continue
    }

    const mention = readMention(text, index)
    if (mention === null || !looksLikeMentionId(mention.id)) {
      buffer += char
      index += 1
      continue
    }

    flush()
    const type = toChipType(mention.id)
    atoms.push(buildChip(type, deriveChipLabel(type, mention.id), mention.id))
    index = mention.end
  }

  flush()
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
  return normalizeDocument([
    ...sliceAtoms(atoms, 0, from),
    ...insert,
    ...sliceAtoms(atoms, to, total)
  ])
}

function insertTextAt(
  atoms: readonly ComposerAtom[],
  offset: number,
  text: string
): ComposerAtom[] {
  return replaceRange(atoms, offset, offset, splitText(text))
}

function insertChipAt(
  atoms: readonly ComposerAtom[],
  offset: number,
  chip: ComposerChipAtom
): ComposerAtom[] {
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

/**
 * 光标（offset）是否正好在某个原子之前 —— Delete 用来决定「删一个字」还是「删整块 chip」。
 * 与 `findAtomEndingAt` 对称。
 */
function findAtomStartingAt(atoms: readonly ComposerAtom[], offset: number) {
  let position = 0
  for (const atom of atoms) {
    if (position === offset) return { atom, start: position }
    position += atomLength(atom)
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
  BROWSER_TAB_ID,
  LINE_BREAK,
  SKILL_PREFIX,
  atomLength,
  buildChip,
  deriveChipLabel,
  documentLength,
  findAtomEndingAt,
  findAtomStartingAt,
  insertChipAt,
  insertTextAt,
  isEmptyDocument,
  locateOffset,
  looksLikeMentionId,
  needsQuote,
  normalizeDocument,
  offsetOf,
  parseDocument,
  readDom,
  replaceRange,
  serializeDocument,
  sliceAtoms,
  splitChipLabel,
  splitText as parseInlineText,
  toChipType,
  toSerializedPayload
}
export type { ComposerAtom, ComposerBreakAtom, ComposerChipAtom, ComposerTextAtom }
