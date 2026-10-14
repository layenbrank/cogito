import { useDocumentVisibility } from '@reactuses/core'
import dayjs, { type Dayjs } from 'dayjs'
import { useEffect, useRef, useState } from 'react'

/** 对齐到下一整秒的延迟（与 Vue getNextTickDelay 同源） */
function findNextTickDelay() {
  const now = performance.now()
  const remain = 1000 - (now % 1000)
  return remain === 0 ? 1000 : remain
}

function useSecondTick(): Dayjs {
  const [now, onUpdateNow] = useState(function () {
    return dayjs()
  })
  const timer = useRef(0)
  const visibility = useDocumentVisibility('visible')

  useEffect(
    function () {
      window.clearTimeout(timer.current)

      if (visibility === 'hidden') return

      function tick() {
        onUpdateNow(dayjs())
        schedule(findNextTickDelay())
      }

      function schedule(delay: number) {
        timer.current = window.setTimeout(tick, delay)
      }

      // 立刻对齐一次（0ms 宏任务）：effect 体里不直接 setState，避免级联渲染
      schedule(0)

      return function () {
        window.clearTimeout(timer.current)
      }
    },
    [visibility]
  )

  return now
}

export { findNextTickDelay, useSecondTick }
