import { create } from 'zustand'

import type { Progress } from '@/lib/directive-ipc.ts'

type CorexProgress = Progress
type StepProgress = Exclude<CorexProgress, { kind: 'started' }>
type CorexFrame = StepProgress & { receivedAt: Date }

const FLUSH_MS = 80
const MAX_FRAMES = 3_000

interface RunFrames {
  frames: readonly CorexFrame[]
  dropped: number
}

const NO_FRAMES: RunFrames = { frames: [], dropped: 0 }

interface RunLogsStore {
  framesById: Record<string, RunFrames>
}

const useRunLogsStore = create<RunLogsStore>(function () {
  return { framesById: {} }
})

let pending: Map<string, CorexFrame[]> | null = null
let timer: ReturnType<typeof setTimeout> | null = null
const liveRuns = new Set<string>()

function registerRun(id: string): void {
  liveRuns.add(id)
}

function unregisterRun(id: string): void {
  liveRuns.delete(id)
  if (pending) pending.delete(id)
}

function flushRunFrames(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }

  const batch = pending
  pending = null
  if (!batch) return

  useRunLogsStore.setState(function (state) {
    const framesById = { ...state.framesById }
    batch.forEach(function (raw, id) {
      const kept = framesById[id] ?? NO_FRAMES
      const all = kept.frames.concat(raw)
      const overflow = all.length - MAX_FRAMES
      framesById[id] = {
        frames: overflow > 0 ? all.slice(overflow) : all,
        dropped: kept.dropped + Math.max(0, overflow)
      }
    })
    return { framesById }
  })
}

function isDuplicateControl(prev: CorexFrame | undefined, next: CorexFrame): boolean {
  if (!prev || next.kind === 'step_output' || prev.kind !== next.kind) return false
  return (
    prev.step === next.step &&
    prev.action === next.action &&
    ('ok' in prev && 'ok' in next ? prev.ok === next.ok : true) &&
    ('done' in prev && 'done' in next ? prev.done === next.done : true) &&
    ('total' in prev && 'total' in next ? prev.total === next.total : true) &&
    ('unit' in prev && 'unit' in next ? prev.unit === next.unit : true)
  )
}

function appendRunFrame(frame: CorexFrame): void {
  if (!liveRuns.has(frame.runId)) return

  if (!pending) pending = new Map()
  const frames = pending.get(frame.runId)
  const lastPending = frames?.[frames.length - 1]
  const lastLanded = findRunFrames(frame.runId).frames.at(-1)
  if (isDuplicateControl(lastPending ?? lastLanded, frame)) return

  if (frames) frames.push(frame)
  else pending.set(frame.runId, [frame])

  if (timer === null) timer = setTimeout(flushRunFrames, FLUSH_MS)
}

function findRunFrames(id: string): RunFrames {
  return useRunLogsStore.getState().framesById[id] ?? NO_FRAMES
}

function dropRunFrames(ids: readonly string[]): void {
  const dropped = new Set(ids)

  dropped.forEach(function (id) {
    liveRuns.delete(id)
  })

  if (pending) {
    dropped.forEach(function (id) {
      pending?.delete(id)
    })
  }

  useRunLogsStore.setState(function (state) {
    if (
      !ids.some(function (id) {
        return id in state.framesById
      })
    ) {
      return state
    }

    const framesById: Record<string, RunFrames> = {}
    Object.keys(state.framesById).forEach(function (id) {
      if (!dropped.has(id)) framesById[id] = state.framesById[id]
    })
    return { framesById }
  })
}

function useRunFrames(runId: string | null): RunFrames {
  return useRunLogsStore(function (state) {
    if (!runId) return NO_FRAMES
    return state.framesById[runId] ?? NO_FRAMES
  })
}

export {
  appendRunFrame,
  dropRunFrames,
  findRunFrames,
  flushRunFrames,
  MAX_FRAMES,
  registerRun,
  unregisterRun,
  useRunFrames
}
export type { CorexFrame, CorexProgress, RunFrames }
