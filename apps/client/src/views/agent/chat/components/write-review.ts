/**
 * 写工具卡的「按块审阅」：把工具参数里的 before / after 原文做行级 diff，
 * 按上下文切成块，再把「保留 / 丢弃」的决定合回一份正文。
 *
 * 三条约束（来自「要真的落盘」这件事本身）：
 *
 * 1. **只认整文件的 before / after。** `edit` 这类工具给的是片段级 old_string / new_string，
 *    拿它重建会把整个文件写成那个片段。落盘前调用方还要把结果和磁盘现状比一次。
 * 2. **用原文，不用 trim 过的。** 首行缩进和结尾换行是文件内容的一部分。
 * 3. **换行风格跟随原文。** CRLF 文件写回去还是 CRLF。
 */
import {
  buildLineDiff,
  findBaseName,
  findWritePath,
  parseWriteTexts,
  readWritePairs,
  type WriteDiffKind
} from '@/views/agent/chat/components/parse-tool-result'

/** 块两侧各留几行上下文（与 git 默认的 -U3 一致） */
const HUNK_CONTEXT = 3

interface WriteReviewLine {
  kind: WriteDiffKind
  text: string
}

interface WriteReviewHunk {
  id: string
  /** `@@ -12,6 +12,7 @@` */
  range: string
  lines: readonly WriteReviewLine[]
}

interface WriteReview {
  fileName: string
  /** 这次写入后的整文件正文：落盘前用它核对磁盘现状 */
  after: string
  eol: string
  hasTrailingNewline: boolean
  lines: readonly WriteReviewLine[]
  hunks: readonly WriteReviewHunk[]
  /** 行下标 → 所属块下标（-1 = 不在任何块里） */
  hunkOfLine: readonly number[]
}

function normalizeEol(text: string) {
  return text.replace(/\r\n/g, '\n')
}

/** 两份正文是否同一份内容（按 LF 归一后比较，避免 CRLF 文件被误判成「已改过」） */
function isSameText(left: string, right: string) {
  return normalizeEol(left) === normalizeEol(right)
}

function findHunkGroups(
  lines: readonly WriteReviewLine[],
  context: number
): { start: number; end: number }[] {
  const groups: { start: number; end: number }[] = []
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].kind === 'context') continue
    const start = Math.max(0, index - context)
    const end = Math.min(lines.length - 1, index + context)
    const last = groups[groups.length - 1]
    // 相邻 / 重叠的窗口并成一块：否则中间那段「只隔着几行」的上下文会被切成两块
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end)
      continue
    }
    groups.push({ start, end })
  }
  return groups
}

function findLineNumbers(lines: readonly WriteReviewLine[]) {
  const oldAt: number[] = []
  const newAt: number[] = []
  let oldNo = 1
  let newNo = 1
  for (const line of lines) {
    oldAt.push(oldNo)
    newAt.push(newNo)
    if (line.kind !== 'added') oldNo += 1
    if (line.kind !== 'removed') newNo += 1
  }
  return { oldAt, newAt }
}

function toRangeLabel(
  group: { start: number; end: number },
  lines: readonly WriteReviewLine[],
  numbers: { oldAt: number[]; newAt: number[] }
) {
  let oldCount = 0
  let newCount = 0
  for (let index = group.start; index <= group.end; index += 1) {
    const kind = lines[index].kind
    if (kind !== 'added') oldCount += 1
    if (kind !== 'removed') newCount += 1
  }
  // 长度为 0 的那一侧按 unified diff 的规矩落在「前一行」
  const oldStart = oldCount === 0 ? numbers.oldAt[group.start] - 1 : numbers.oldAt[group.start]
  const newStart = newCount === 0 ? numbers.newAt[group.start] - 1 : numbers.newAt[group.start]
  return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`
}

/** 工具参数 → 可审阅的块；不是整文件 before/after（或压根没改动）时返回 null */
function parseWriteReview(args: unknown): WriteReview | null {
  const { before, after } = parseWriteTexts(args)
  if (before === null || after === null) return null

  const diff = buildLineDiff(before, after)
  if (diff.additions === 0 && diff.deletions === 0) return null

  const lines = diff.lines
  const numbers = findLineNumbers(lines)
  const groups = findHunkGroups(lines, HUNK_CONTEXT)
  if (groups.length === 0) return null

  const hunks: WriteReviewHunk[] = groups.map(function (group) {
    return {
      id: `hunk-${group.start}-${group.end}`,
      range: toRangeLabel(group, lines, numbers),
      lines: lines.slice(group.start, group.end + 1)
    }
  })

  const hunkOfLine = new Array<number>(lines.length).fill(-1)
  for (let index = 0; index < groups.length; index += 1) {
    for (let line = groups[index].start; line <= groups[index].end; line += 1) {
      hunkOfLine[line] = index
    }
  }

  const path = findWritePath(args)
  return {
    fileName: path ? findBaseName(path) : 'file',
    after,
    eol: after.includes('\r\n') ? '\r\n' : '\n',
    hasTrailingNewline: after.endsWith('\n'),
    lines,
    hunks,
    hunkOfLine
  }
}

/** 定点替换的一块：一段 oldText → newText；丢弃时把这半截反向替换回磁盘现状 */
interface PatchReviewHunk {
  id: string
  range: string
  lines: readonly WriteReviewLine[]
  /** 丢弃这块时写回文件用的原文（after → before） */
  before: string
  after: string
}

interface PatchReview {
  fileName: string
  hunks: readonly PatchReviewHunk[]
}

/** 参数里是不是 `edits: [{ oldText, newText }]`（定点替换） */
function hasEditList(args: unknown): boolean {
  if (!args || typeof args !== 'object') return false
  const list = (args as Record<string, unknown>).edits
  return Array.isArray(list) && list.length > 0
}

/**
 * 定点替换 → 逐段审阅清单（一段改动 = 一块）。
 *
 * 与 `parseWriteReview` 的分工：那条要求「整文件 before / after」，落盘是按 before 侧重建全文；
 * 这里没有旧全文，落盘走 `rebuildPatchText`——把丢弃的那几段反向替换回磁盘现状。
 * 纯删除段（没有 after）没法反向定位，整份不开放审阅。
 */
function parsePatchReview(args: unknown): PatchReview | null {
  if (!hasEditList(args)) return null
  const pairs = readWritePairs(args)
  if (pairs.length === 0) return null
  if (
    pairs.some(function (pair) {
      return !pair.after
    })
  ) {
    return null
  }
  const path = findWritePath(args)
  const hunks: PatchReviewHunk[] = pairs.map(function (pair, index) {
    const diff = buildLineDiff(pair.before, pair.after)
    return {
      id: 'edit-' + String(index),
      range: '第 ' + String(index + 1) + ' 处',
      lines: diff.lines,
      before: pair.before,
      after: pair.after
    }
  })
  return { fileName: path ? findBaseName(path) : 'file', hunks }
}

/**
 * 把「丢弃」的段反向替换回去；保留 / 待定的段保持写完之后的样子。
 * 找不到 after 说明文件之后又被改过 —— 交给调用方按失败处理，这里只如实回报。
 */
function rebuildPatchText(
  current: string,
  review: PatchReview,
  decisions: Readonly<Record<string, 'pending' | 'kept' | 'discarded'>>
): { text: string; reverted: number; missing: string[] } {
  let text = current
  let reverted = 0
  const missing: string[] = []
  for (const hunk of review.hunks) {
    if ((decisions[hunk.id] ?? 'pending') !== 'discarded') continue
    if (!text.includes(hunk.after)) {
      missing.push(hunk.id)
      continue
    }
    text = text.replace(hunk.after, hunk.before)
    reverted += 1
  }
  return { text, reverted, missing }
}

/**
 * 按决定合成正文：保留的块按 after 侧、丢弃的块退回 before 侧，块外的上下文原样留着。
 * 待决定的块按「保留」处理 —— 调用方本来就不该在有待决定时落盘。
 */
function rebuildReviewedText(
  review: WriteReview,
  decisions: Readonly<Record<string, 'pending' | 'kept' | 'discarded'>>
): string {
  const out: string[] = []
  for (let index = 0; index < review.lines.length; index += 1) {
    const line = review.lines[index]
    const hunkIndex = review.hunkOfLine[index]
    const decision =
      hunkIndex < 0 ? 'kept' : (decisions[review.hunks[hunkIndex].id] ?? 'pending')
    const isKept = decision !== 'discarded'
    if (line.kind === 'context') out.push(line.text)
    else if (line.kind === 'added') {
      if (isKept) out.push(line.text)
    } else if (!isKept) out.push(line.text)
  }
  const text = out.join(review.eol)
  return review.hasTrailingNewline ? text + review.eol : text
}

export {
  HUNK_CONTEXT,
  isSameText,
  normalizeEol,
  parsePatchReview,
  parseWriteReview,
  rebuildPatchText,
  rebuildReviewedText
}
export type { PatchReview, PatchReviewHunk, WriteReview, WriteReviewHunk, WriteReviewLine }
