import { afterEach, describe, expect, it } from 'vitest'

import {
  clearFinishedRun,
  clearRunState,
  findFinishedSnapshot,
  findRunSnapshot,
  hasRunningThreads,
  markRunFinished,
  markRunStarted
} from '@/features/agent/acp/run-state'

afterEach(function () {
  clearRunState()
})

describe('run-state', function () {
  it('tracks running threads and clears them on finish', function () {
    markRunStarted('a')
    markRunStarted('b')
    expect(findRunSnapshot()).toEqual(['a', 'b'])
    expect(hasRunningThreads()).toBe(true)

    markRunFinished('a')
    expect(findRunSnapshot()).toEqual(['b'])
  })

  it('records finished threads for the background inbox', function () {
    markRunStarted('a')
    markRunFinished('a')
    expect(findRunSnapshot()).toEqual([])
    expect(findFinishedSnapshot()).toEqual(['a'])
  })

  it('clears a finished entry when the run restarts or is collected', function () {
    markRunStarted('a')
    markRunFinished('a')
    expect(findFinishedSnapshot()).toEqual(['a'])

    // 重新开跑：不再是「待领取」
    markRunStarted('a')
    expect(findFinishedSnapshot()).toEqual([])

    markRunFinished('a')
    clearFinishedRun('a')
    expect(findFinishedSnapshot()).toEqual([])
  })

  it('clearRunState wipes both sets', function () {
    markRunStarted('a')
    markRunStarted('b')
    markRunFinished('b')
    clearRunState()
    expect(findRunSnapshot()).toEqual([])
    expect(findFinishedSnapshot()).toEqual([])
    expect(hasRunningThreads()).toBe(false)
  })
})
