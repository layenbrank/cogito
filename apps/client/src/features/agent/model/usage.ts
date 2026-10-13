/**
 * 用量：本地 `agent_usage` 的汇总口径。
 *
 * 一条用量 = 一轮 prompt 的增量（`acp/session.ts::recordUsage` 用 session 累计值减基线得到），
 * 所以「会话合计」就是逐条相加，不做去重。
 */
type Usage = MagneticTile.Agent.Usage

interface UsageTotals {
  runs: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/** 汇总若干条用量；空数组给全 0（不返回 null，调用方少一层判空） */
function findUsageTotals(usages: readonly Usage[]): UsageTotals {
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  for (const usage of usages) {
    inputTokens += usage.inputTokens
    outputTokens += usage.outputTokens
    totalTokens += usage.totalTokens
  }
  return { runs: usages.length, inputTokens, outputTokens, totalTokens }
}

/** 千分位；负数按 0 处理（脏数据别显示成 -1） */
function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  return Math.floor(value).toLocaleString('zh-CN')
}

export type { UsageTotals }
export { findUsageTotals, formatTokens }
