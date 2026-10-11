import { useEffect, useState } from 'react'

/** 按 intervalMs 推进的时钟；`enabled` 为 false 时停表 */
function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(function () {
    return Date.now()
  })

  useEffect(
    function () {
      if (!enabled) return
      setNow(Date.now())
      const timer = window.setInterval(function () {
        setNow(Date.now())
      }, intervalMs)
      return function () {
        window.clearInterval(timer)
      }
    },
    [intervalMs, enabled]
  )

  return now
}

export { useNow }
