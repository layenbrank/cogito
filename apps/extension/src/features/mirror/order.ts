/** 把 source 插到 target 所在位置，其余磁贴顺序保持相对不变 */
export function moveTile(ids: readonly string[], sourceID: string, targetID: string): string[] {
  const next = ids.slice()
  const from = next.indexOf(sourceID)
  const to = next.indexOf(targetID)
  if (from < 0 || to < 0 || from === to) return next

  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}
