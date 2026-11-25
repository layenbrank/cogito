/**
 * 成本账本导出（S8）—— 前端只拿到「一份快照」，没有查询面。
 *
 * 与审计导出同一套口径：命令在 Rust 侧先按保留期裁一次，再给最近 N 条 + 汇总。
 * `priceMicros` / `currency` 为 null 表示**未计价**（模型不在内置价目表里），
 * 这种情况必须显示成「未计价」，不能显示成 0 —— 那是两件事。
 *
 * 取数 + 契约校验在 `@/apis/security`（schema 在 `specs/security.ts`），这里只剩文案。
 */
import type { CostExport } from '@/shared/ipc/specs/security'

export { CostEntrySchema, CostExportSchema, CostTotalsSchema } from '@/shared/ipc/specs/security'
export type { CostEntry, CostExport } from '@/shared/ipc/specs/security'

/** 微元 → 「¥1.23」；币种不认识就原样带上代码。 */
export function formatMicros(micros: number, currency = 'CNY'): string {
  const symbol =
    currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : currency ? `${currency} ` : ''
  const safe = Number.isFinite(micros) ? Math.max(0, micros) : 0
  return `${symbol}${(safe / 1_000_000).toFixed(2)}`
}

/**
 * 一行摘要：`12 条 · 合计 ¥1.23 · 2 条未计价`。
 *
 * 「未计价」必须单独说出来：不然用户会以为那就是全部花费。
 */
export function describeCost(result: CostExport): string {
  const scope =
    result.entries.length === result.total
      ? `${result.total} 条`
      : `${result.entries.length} / ${result.total} 条`
  const parts = [scope, `合计 ${formatMicros(result.totals.priceMicros, result.currency)}`]
  if (result.totals.unpricedRuns > 0) {
    parts.push(`${result.totals.unpricedRuns} 条未计价`)
  }
  return parts.join(' · ')
}
