/**
 * 检索块（retrieval-chunks）的展示刻度：分数只做「0..1 → 百分比 / 两位小数」这一件事。
 *
 * 为什么这里不算相关度：绝对分数是**领域问题**（本仓知识库用 bm25，越小越相关，
 * LIKE 回退恒 0），换算口径跟在 parser 里；元素只认 0..1，不管来源。
 * 但「越界分数」得在这里兜住 —— NaN / 负数 / 大于 1 都会把进度条画成一团。
 */

/** 元素认的一条检索命中 */
interface RetrievalChunk {
  /** 文档 / 片段的稳定 id（React key） */
  id: string
  /** 左边那行名字：文档标题，标题缺失时退回文件名 */
  source: string
  /** 定位串：相对路径、章节号、行号区间都行（元素不解释它） */
  locator: string
  /** 0..1 的相关度；低于 0.8 时元素用弱色 */
  score: number
  /** 片段正文（两行截断） */
  text: string
  /** 模糊匹配回退：没有可信分数，元素不画分数与分数条 */
  fuzzy?: boolean
}

/** 分数钳进 0..1；NaN 当 0，±Infinity 钳到两端（宁可条空，不要条崩） */
function clampScore(score: number): number {
  if (Number.isNaN(score)) return 0
  if (score <= 0) return 0
  if (score >= 1) return 1
  return score
}

/** 0..1 → 进度条宽度百分比（取整，和 aria-valuenow 同源） */
function toPercent(score: number): number {
  return Math.round(clampScore(score) * 100)
}

/** 行里印的分数：两位小数，跟 aria-valuetext 读同一个值 */
function formatScore(score: number): string {
  return clampScore(score).toFixed(2)
}

export { clampScore, formatScore, toPercent }
export type { RetrievalChunk }
