/**
 * 行级 diff：只服务「AI 改写预览」这一处，不追求最小编辑距离之外的任何能力。
 *
 * 手写而不引依赖：只有 LCS + 回溯，几十行；引入 `diff` 包为了这一个用处不值得。
 */

type DiffKind = 'same' | 'add' | 'remove'

interface DiffRow {
  kind: DiffKind
  text: string
}

/**
 * 超大输入的保险丝：AI 改写一般几百行以内，超过就退化成「整块删 + 整块加」。
 * 这不是能力缺失，而是避免 LCS 表把一次预览算成卡顿。
 */
const MAX_DIFF_LINES = 1200

function toLines(value: string): string[] {
  return value.replace(/\r\n/g, '\n').split('\n')
}

function diffLarge(left: string[], right: string[]): DiffRow[] {
  return [
    ...left.map(function (text) {
      return { kind: 'remove' as const, text }
    }),
    ...right.map(function (text) {
      return { kind: 'add' as const, text }
    })
  ]
}

function diffLines(before: string, after: string): DiffRow[] {
  const left = toLines(before)
  const right = toLines(after)
  if (left.length > MAX_DIFF_LINES || right.length > MAX_DIFF_LINES) {
    return diffLarge(left, right)
  }

  // 后缀 LCS 表：`table[i][j]` = left[i..] 与 right[j..] 的最长公共子序列长度
  const table: Uint32Array[] = []
  for (let index = 0; index <= left.length; index += 1) {
    table.push(new Uint32Array(right.length + 1))
  }
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        left[i] === right[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      rows.push({ kind: 'same', text: left[i] })
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      rows.push({ kind: 'remove', text: left[i] })
      i += 1
    } else {
      rows.push({ kind: 'add', text: right[j] })
      j += 1
    }
  }
  while (i < left.length) {
    rows.push({ kind: 'remove', text: left[i] })
    i += 1
  }
  while (j < right.length) {
    rows.push({ kind: 'add', text: right[j] })
    j += 1
  }
  return rows
}

/** 摘要：「+12 −3 行」，给预览标题用 */
function countDiff(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const row of rows) {
    if (row.kind === 'add') added += 1
    if (row.kind === 'remove') removed += 1
  }
  return { added, removed }
}

export { countDiff, diffLines, MAX_DIFF_LINES }
export type { DiffKind, DiffRow }
