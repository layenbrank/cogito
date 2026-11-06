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

export { HUNK_CONTEXT, isSameText, normalizeEol, parseWriteReview, rebuildReviewedText }
export type { WriteReview, WriteReviewHunk, WriteReviewLine }
