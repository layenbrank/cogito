import type { SignboardCheck, SignboardColumn, SignboardEntry } from '@/stores/signboard'

interface RatioProgress {
  done: number
  total: number
  /** 0–100；total≤0 时为 0 */
  pct: number
}

interface ColumnProgressRow {
  column: SignboardColumn
  count: number
  /** 有清单的卡片平均完成度；无清单卡时为 null */
  avgPct: number | null
  sharePct: number
}

function findRatioProgress(done: number, total: number): RatioProgress {
  const safeDone = Math.max(0, done)
  const safeTotal = Math.max(0, total)
  if (safeTotal <= 0) {
    return { done: 0, total: 0, pct: 0 }
  }
  return {
    done: Math.min(safeDone, safeTotal),
    total: safeTotal,
    pct: Math.max(0, Math.min(100, Math.round((safeDone / safeTotal) * 100)))
  }
}

function findChecklistProgress(checks: SignboardCheck[]): RatioProgress {
  const total = checks.length
  if (total === 0) return findRatioProgress(0, 0)
  const done = checks.filter(function (item) {
    return item.done
  }).length
  return findRatioProgress(done, total)
}

/** 卡面真相源：仅清单；无清单 → 0/0 */
function findCardProgress(checks: SignboardCheck[]): RatioProgress {
  return findChecklistProgress(checks)
}

/** 看板完成率：全板清单 Σdone / Σtotal，不依赖完成列 */
function findBoardProgress(
  entries: SignboardEntry[],
  checksForEntry: (entryID: string) => SignboardCheck[]
): RatioProgress {
  let done = 0
  let total = 0
  for (const card of entries) {
    if (card.archivedAt !== null && card.archivedAt !== undefined) continue
    const progress = findChecklistProgress(checksForEntry(card.id))
    done += progress.done
    total += progress.total
  }
  return findRatioProgress(done, total)
}

function findColumnProgress(
  columns: SignboardColumn[],
  entries: SignboardEntry[],
  checksForEntry: (entryID: string) => SignboardCheck[]
): ColumnProgressRow[] {
  const active = entries.filter(function (card) {
    return card.archivedAt === null || card.archivedAt === undefined
  })
  const totalCards = Math.max(active.length, 1)

  return columns.map(function (column) {
    const cards = active.filter(function (card) {
      return card.columnID === column.id
    })
    let scored = 0
    let pctSum = 0
    for (const card of cards) {
      const progress = findChecklistProgress(checksForEntry(card.id))
      if (progress.total === 0) continue
      scored += 1
      pctSum += progress.pct
    }
    return {
      column,
      count: cards.length,
      avgPct: scored === 0 ? null : Math.round(pctSum / scored),
      sharePct: Math.round((cards.length / totalCards) * 100)
    }
  })
}

export {
  findBoardProgress,
  findCardProgress,
  findChecklistProgress,
  findColumnProgress,
  findRatioProgress
}
export type { ColumnProgressRow, RatioProgress }
