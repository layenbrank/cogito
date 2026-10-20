/**
 * 通用保序去重：所有「同类只留一条」走这里，禁止各 provider 自写一套。
 */

function uniqueBy<T>(items: readonly T[], findKey: (item: T) => string): T[] {
  const seen = new Set<string>()
  const next: T[] = []
  for (const item of items) {
    const key = findKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    next.push(item)
  }
  return next
}

/** 多策略串联去重（先 id 再展示面等）；保留先出现的项 */
function uniqueByStrategies<T>(
  items: readonly T[],
  strategies: ReadonlyArray<(item: T) => string>
): T[] {
  let next = [...items]
  for (const findKey of strategies) {
    next = uniqueBy(next, findKey)
  }
  return next
}

export { uniqueBy, uniqueByStrategies }
