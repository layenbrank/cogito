/**
 * 播放中的播放头。不写 Zustand，避免每帧重渲染整条时间轴。
 */
let playheadMs = 0
const listeners = new Set<() => void>()

function readPlayheadMs(): number {
  return playheadMs
}

function writePlayheadMs(ms: number) {
  if (ms === playheadMs) return
  playheadMs = ms
  for (const listener of listeners) listener()
}

function subscribePlayhead(listener: () => void): () => void {
  listeners.add(listener)
  return function () {
    listeners.delete(listener)
  }
}

export { readPlayheadMs, writePlayheadMs, subscribePlayhead }
