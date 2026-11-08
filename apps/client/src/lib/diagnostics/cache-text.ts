/**
 * 诊断页「Agent 缓存」两行文案的纯函数。
 *
 * 抽出来是为了能单测 —— 验证 #5 要求页面上真的能看到「缓存根 / 上次清理 / 已清理字节」，
 * 而这些值的拼装逻辑（0 字节、没清理过、读不到状态）最容易在改动里退化。
 */
import { formatBytes } from './capabilities'

/**
 * 缓存大小文案。
 *
 * `formatBytes` 把 0 显示成「—」，但清空缓存后必须能看出「确实空了」，所以这里补 0 B。
 */
function cacheSizeText(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null) return '—'
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  return formatBytes(bytes)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 本地时区的 `YYYY-MM-DD HH:mm`，便于和构建/终端日志对时间 */
function stampText(ms: number): string {
  const stamp = new Date(ms)
  if (Number.isNaN(stamp.getTime())) return '读不到'
  const date = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}`
  const time = `${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`
  return `${date} ${time}`
}

interface CachePruneInfo {
  /** 自动淘汰上限（字节） */
  maxBytes?: number | null
  /** 最近一次自动清理的时刻（epoch 毫秒） */
  lastPrunedAt?: number | null
  /** 最近一次自动清理释放的字节数 */
  lastPrunedBytes?: number | null
}

/**
 * 「自动清理」一行：上限 + 上次清理时间 + 释放字节。
 *
 * 没清理过时明说「还没触发过」而不是留空 —— 空白会让用户以为功能坏了。
 */
function cachePruneText(stats: CachePruneInfo | null | undefined): string {
  if (!stats) return '读不到缓存状态'
  const parts: string[] = []
  parts.push(stats.maxBytes && stats.maxBytes > 0 ? `上限 ${cacheSizeText(stats.maxBytes)}` : '默认上限 512 MB')
  if (stats.lastPrunedAt && stats.lastPrunedAt > 0) {
    parts.push(`上次清理 ${stampText(stats.lastPrunedAt)} 释放 ${cacheSizeText(stats.lastPrunedBytes ?? 0)}`)
  } else {
    parts.push('上次清理：还没触发过')
  }
  return parts.join(' · ')
}

export { cachePruneText, cacheSizeText, stampText }
export type { CachePruneInfo }
