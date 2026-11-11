/**
 * 成本账本导出（S8）—— 前端只拿到「一份快照」，没有查询面。
 *
 * 与审计导出同一套口径：命令在 Rust 侧先按保留期裁一次，再给最近 N 条 + 汇总。
 * `priceMicros` / `currency` 为 null 表示**未计价**（模型不在内置价目表里），
 * 这种情况必须显示成「未计价」，不能显示成 0 —— 那是两件事。
 */
import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

import { CHANNELS } from './channels'

const CostEntrySchema = z.object({
  id: z.string(),
  usageId: z.string(),
  runId: z.string().nullish(),
  sessionId: z.string().nullish(),
  model: z.string(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  /** 微元（1 元 = 1_000_000）；null = 未计价 */
  priceMicros: z.number().int().nullish(),
  currency: z.string().nullish(),
  /** `YYYY-MM-DD`（UTC） */
  dayKey: z.string(),
  createdAt: z.number().int().nonnegative()
})

const CostTotalsSchema = z.object({
  runs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  priceMicros: z.number().int().nonnegative(),
  pricedRuns: z.number().int().nonnegative(),
  unpricedRuns: z.number().int().nonnegative()
})

export const CostExportSchema = z.object({
  exportedAt: z.number().int().nonnegative(),
  retentionMs: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  currency: z.string(),
  totals: CostTotalsSchema,
  entries: z.array(CostEntrySchema)
})

export type CostEntry = z.infer<typeof CostEntrySchema>
export type CostExport = z.infer<typeof CostExportSchema>

/** 取一份成本账快照（默认由 Rust 侧夹到上限）。 */
export async function exportRunCost(limit?: number): Promise<CostExport> {
  const raw = await invoke<unknown>(CHANNELS.SECURITY.COST_EXPORT, { limit })
  return CostExportSchema.parse(raw)
}

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
