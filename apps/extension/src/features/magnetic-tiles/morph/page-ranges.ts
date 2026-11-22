/**
 * Page-range helpers for split preview (1-based human ranges ↔ 0-based offsets).
 */

function parseRangesToOffsets(rangesText: string, count: number): number[] {
  const offsets: number[] = []
  const parts = rangesText
    .split(/[,;\n]+/)
    .map(function (part) {
      return part.trim()
    })
    .filter(Boolean)

  for (const part of parts) {
    const bits = part.split('-').map(function (bit) {
      return Number(bit.trim())
    })
    const start = bits[0]
    const end = bits[1] ?? start
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const from = Math.max(1, Math.min(start, end))
    const to = Math.min(count, Math.max(start, end))
    for (let n = from; n <= to; n += 1) {
      offsets.push(n - 1)
    }
  }

  return [...new Set(offsets)].sort(function (a, b) {
    return a - b
  })
}

function buildRangesFromOffsets(offsets: number[]): string {
  if (!offsets.length) return ''
  const sorted = [...new Set(offsets)].sort(function (a, b) {
    return a - b
  })
  const ranges: string[] = []
  let start = sorted[0]
  let prev = sorted[0]

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]
    if (current === prev + 1) {
      prev = current
      continue
    }
    ranges.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`)
    start = current
    prev = current
  }
  ranges.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`)
  return ranges.join(', ')
}

function toggleOffset(offsets: ReadonlySet<number>, offset: number): Set<number> {
  const next = new Set(offsets)
  if (next.has(offset)) next.delete(offset)
  else next.add(offset)
  return next
}

export { parseRangesToOffsets, buildRangesFromOffsets, toggleOffset }
