/**
 * 百分比尺寸工具（0..1），对标 ant-design Splitter sizeUtil + 容器缩小时 re-clamp。
 */

type SizeUnit = number | undefined

/**
 * 将显式尺寸夹到 min（已折叠的 0 与 undefined 不动）。
 * max 侧不强制，避免冲掉折叠恢复缓存。
 */
function limitPtgSizes(sizes: number[], minSizes: SizeUnit[], collapsedFlags: boolean[]): number[] {
  return sizes.map(function (size, index) {
    if (collapsedFlags[index]) return size
    const min = minSizes[index] ?? 0
    return Math.max(min, size)
  })
}

function fitPtgSizes(sizes: number[], minSizes: SizeUnit[], maxSizes: SizeUnit[]): number[] {
  // 已折叠（size≈0）的栏 min/max 视为 0，避免被 min 弹开
  const mergedMin = sizes.map(function (size, index) {
    return size <= Number.EPSILON ? 0 : (minSizes[index] ?? 0)
  })
  const mergedMax = sizes.map(function (size, index) {
    return size <= Number.EPSILON ? 0 : (maxSizes[index] ?? 1)
  })

  const invalidLimits = mergedMin.some(function (min, index) {
    return min > mergedMax[index]
  })
  const totalMin = mergedMin.reduce(function (sum, size) {
    return sum + size
  }, 0)
  const totalMax = mergedMax.reduce(function (sum, size) {
    return sum + size
  }, 0)

  if (invalidLimits || totalMin > 1 || totalMax < 1) {
    return sizes
  }

  const result = sizes.map(function (size, index) {
    return Math.min(mergedMax[index], Math.max(mergedMin[index], size))
  })
  const total = result.reduce(function (sum, size) {
    return sum + size
  }, 0)

  if (Math.abs(total - 1) < 1e-6) {
    return result
  }

  const grow = total < 1
  const spaces = result.map(function (size, index) {
    return grow ? mergedMax[index] - size : size - mergedMin[index]
  })
  const totalSpace = spaces.reduce(function (sum, space) {
    return sum + space
  }, 0)
  if (totalSpace <= Number.EPSILON) {
    return result
  }
  const rest = 1 - total
  return result.map(function (size, index) {
    return size + rest * (spaces[index] / totalSpace)
  })
}

/**
 * 填满未指定的栏，并对全体做 min/max 拟合。输入输出均为 0..1。
 */
function autoPtgSizes(
  ptgSizes: SizeUnit[],
  minPtgSizes: SizeUnit[],
  maxPtgSizes: SizeUnit[]
): number[] {
  let currentTotal = 0
  const undefinedIndexes: number[] = []
  ptgSizes.forEach(function (size, index) {
    if (size === undefined) {
      undefinedIndexes.push(index)
    } else {
      currentTotal += size
    }
  })

  const rest = 1 - currentTotal
  const undefinedCount = undefinedIndexes.length

  if (ptgSizes.length && undefinedCount === 0 && Math.abs(currentTotal - 1) > 1e-6) {
    if (currentTotal <= Number.EPSILON) {
      const avg = 1 / ptgSizes.length
      return ptgSizes.map(function () {
        return avg
      })
    }
    const scale = 1 / currentTotal
    const scaled = ptgSizes.map(function (size) {
      return (size as number) * scale
    })
    // 缩小时只压缩「高于 min」的余量，避免把 min 本身按比例压破
    const collapsedFlags = scaled.map(function (size) {
      return size <= Number.EPSILON
    })
    const limited = limitPtgSizes(scaled, minPtgSizes, collapsedFlags)
    return fitPtgSizes(limited, minPtgSizes, maxPtgSizes)
  }

  if (rest < 0) {
    const scale = 1 / currentTotal
    return ptgSizes.map(function (size) {
      return size === undefined ? 0 : size * scale
    })
  }

  let sumMin = 0
  let sumMax = 0
  let limitMin = 0
  let limitMax = 1
  for (const index of undefinedIndexes) {
    const min = minPtgSizes[index] || 0
    const max = maxPtgSizes[index] || 1
    sumMin += min
    sumMax += max
    limitMin = Math.max(limitMin, min)
    limitMax = Math.min(limitMax, max)
  }

  if (sumMin > 1 && sumMax < 1) {
    const avg = 1 / undefinedCount
    return ptgSizes.map(function (size) {
      return size === undefined ? avg : size
    })
  }

  const restAvg = rest / undefinedCount
  if (undefinedCount > 0 && limitMin <= restAvg && restAvg <= limitMax) {
    return ptgSizes.map(function (size) {
      return size === undefined ? restAvg : size
    })
  }

  const result = [...ptgSizes] as number[]
  let remain = rest - sumMin
  for (let i = 0; i < undefinedCount; i += 1) {
    const index = undefinedIndexes[i]!
    const min = minPtgSizes[index] || 0
    const max = maxPtgSizes[index] || 1
    result[index] = min
    const canAdd = max - min
    const add = Math.min(canAdd, Math.max(0, remain))
    result[index] += add
    remain -= add
  }
  return result
}

function isPctString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().endsWith('%')
}

function parsePct(value: string): number {
  return Number(value.trim().slice(0, -1)) / 100
}

/**
 * 把 size 配置转成 0..1 比例；数字按像素 / container 换算。
 * container 为 0 时返回 undefined（跳过）。
 */
function sizeToPtg(value: number | string | undefined, containerPx: number): number | undefined {
  if (value === undefined || value === '') return undefined
  if (containerPx <= 0) return undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.endsWith('%')) return parsePct(trimmed)
    if (trimmed.endsWith('px')) {
      const px = Number(trimmed.slice(0, -2))
      if (!Number.isFinite(px)) return undefined
      return px / containerPx
    }
    const num = Number(trimmed)
    if (!Number.isFinite(num)) return undefined
    // 无单位字符串在旧库里当 %
    if (num <= 100) return num / 100
    return num / containerPx
  }
  if (!Number.isFinite(value)) return undefined
  return value / containerPx
}

function ptgToLayoutPct(ptgs: number[]): number[] {
  // 对外 layout 用 0..100；浮点余量塞进最后一栏
  const raw = ptgs.map(function (ptg) {
    return ptg * 100
  })
  if (raw.length === 0) return raw
  const sum = raw.reduce(function (a, b) {
    return a + b
  }, 0)
  const last = raw.length - 1
  raw[last] = (raw[last] ?? 0) + (100 - sum)
  return raw
}

export {
  autoPtgSizes,
  fitPtgSizes,
  isPctString,
  limitPtgSizes,
  parsePct,
  ptgToLayoutPct,
  sizeToPtg
}
export type { SizeUnit }
