import { useEffect, useState } from 'react'

/** 按 intervalMs 推进的时钟；`enabled` 为 false 时停表 */
function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(function () {
    return Date.now()
  })

  useEffect(
    function () {
      if (!enabled) return
      // 立刻对齐一次（0ms 宏任务）：effect 体里不直接 setState，避免级联渲染
      const immediate = window.setTimeout(function () {
        setNow(Date.now())
      }, 0)
      const timer = window.setInterval(function () {
        setNow(Date.now())
      }, intervalMs)
      return function () {
        window.clearTimeout(immediate)
        window.clearInterval(timer)
      }
    },
    [intervalMs, enabled]
  )

  return now
}

export { useNow }
