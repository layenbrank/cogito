import { startTransition, useEffect, useState } from 'react'

import { STREAM_SECTION_CHUNK } from '@/views/gallery/constraints'

const IDLE_TIMEOUT_MS = 48

function scheduleIdle(task: () => void): () => void {
  const idle = (
    globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }
  ).requestIdleCallback

  if (typeof idle === 'function') {
    const id = idle(task, { timeout: IDLE_TIMEOUT_MS })
    return function () {
      globalThis.cancelIdleCallback?.(id)
    }
  }

  const id = globalThis.setTimeout(task, 0)
  return function () {
    globalThis.clearTimeout(id)
  }
}

function findFirstCount(total: number, chunkSize: number): number {
  const safeTotal = Math.max(total, 0)
  const step = Math.max(chunkSize, 1)
  return Math.min(step, safeTotal)
}

/** 分片挂载计数：首屏 chunk，空闲时段补齐（对齐 studio useStreamedCount） */
function useStreamedCount(
  total: number,
  resetKey: string | number,
  chunkSize: number = STREAM_SECTION_CHUNK
): number {
  const first = findFirstCount(total, chunkSize)
  const safeTotal = Math.max(total, 0)
  const [count, onCount] = useState(first)
  const [seenKey, onSeenKey] = useState(resetKey)
  const [seenChunk, onSeenChunk] = useState(chunkSize)

  const isReset = seenKey !== resetKey || seenChunk !== chunkSize
  const isOver = !isReset && count > safeTotal
  const shown = isReset ? first : isOver ? safeTotal : count

  if (isReset) {
    onSeenKey(resetKey)
    onSeenChunk(chunkSize)
    onCount(first)
  } else if (isOver) {
    onCount(safeTotal)
  }

  useEffect(
    function () {
      const step = Math.max(chunkSize, 1)
      let next = Math.min(step, safeTotal)
      let cancelSchedule: (() => void) | null = null
      let isAlive = true

      function pump() {
        if (!isAlive) return
        startTransition(function () {
          onCount(next)
        })
        if (next >= safeTotal) return
        next = Math.min(next + step, safeTotal)
        cancelSchedule = scheduleIdle(pump)
      }

      cancelSchedule = scheduleIdle(pump)
      return function () {
        isAlive = false
        cancelSchedule?.()
      }
    },
    [safeTotal, resetKey, chunkSize]
  )

  return shown
}

export { useStreamedCount }
