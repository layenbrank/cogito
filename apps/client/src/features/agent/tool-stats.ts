/**
 * 一组工具调用的失败计数（对齐 studio / Qoder「执行工具 N 次，其中 M 次失败」）。
 */

interface ToolPartLike {
  type: string
  isError?: boolean
  status?: { type: string }
}

function isFailedToolPart(part: ToolPartLike): boolean {
  if (part.type !== 'tool-call') return false
  return part.isError === true || part.status?.type === 'incomplete'
}

function countToolFailures(parts: readonly ToolPartLike[], indices: readonly number[]): number {
  let failed = 0
  for (const index of indices) {
    const part = parts[index]
    if (!part) continue
    if (isFailedToolPart(part)) failed += 1
  }
  return failed
}

export { countToolFailures, isFailedToolPart }
export type { ToolPartLike }
