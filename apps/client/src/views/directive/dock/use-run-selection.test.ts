import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import type { DirectiveEntry } from '@/shared/ipc/specs/sidecar'
import { useCorexStore, type CorexRun } from '@/stores/corex.ts'

import { useRunSelection } from './use-run-selection.ts'

function makeRun(id: string, patch: Partial<CorexRun> = {}): CorexRun {
  return {
    id,
    name: id,
    kind: 'directive',
    status: 'running',
    startedAt: new Date(1_000),
    endedAt: null,
    doneSteps: 0,
    result: null,
    error: null,
    trigger: 'manual',
    ...patch
  }
}

function makeEntry(name: string, stepCount: number): DirectiveEntry {
  return {
    name,
    folder: null,
    source: null,
    visible: true,
    updated_at_ms: 0,
    bucket: null,
    summary: {
      description: '',
      step_count: stepCount,
      input_count: 0,
      trigger_count: 0,
      has_cron: false,
      has_watch: false
    }
  }
}

function resetStore(runs: CorexRun[], focusRunId: string | null = null) {
  useCorexStore.setState({
    runs,
    focusRunId,
    directives: [],
    draft: null,
    editorName: null
  })
}

describe('useRunSelection', function () {
  beforeEach(function () {
    resetStore([])
  })

  it('没有运行时既没有标签也没有选中项', function () {
    const { result } = renderHook(function () {
      return useRunSelection()
    })

    expect(result.current.tabs).toHaveLength(0)
    expect(result.current.selected).toBeNull()
    expect(result.current.stepCount).toBe(0)
  })

  /** 并发跑多条指令时，每条都要有自己的一页标签，默认停在最新启动的那条 */
  it('并发运行各自占一页，默认停在最新启动的运行', function () {
    const older = makeRun('older', { name: 'a', startedAt: new Date(1_000) })
    const newer = makeRun('newer', { name: 'b', startedAt: new Date(2_000) })
    resetStore([newer, older])

    const { result } = renderHook(function () {
      return useRunSelection()
    })

    expect(
      result.current.tabs.map(function (run) {
        return run.id
      })
    ).toEqual(['older', 'newer'])
    expect(result.current.selected?.id).toBe('newer')
  })

  it('运行中的排在已结束之前，已结束按其启动时间倒序', function () {
    const doneOld = makeRun('done-old', {
      status: 'ok',
      startedAt: new Date(1_000),
      endedAt: new Date(2_000)
    })
    const doneNew = makeRun('done-new', {
      status: 'failed',
      startedAt: new Date(3_000),
      endedAt: new Date(4_000)
    })
    const alive = makeRun('alive', { startedAt: new Date(500) })
    resetStore([doneOld, doneNew, alive])

    const { result } = renderHook(function () {
      return useRunSelection()
    })

    expect(
      result.current.tabs.map(function (run) {
        return run.id
      })
    ).toEqual(['alive', 'done-new', 'done-old'])
  })

  it('焦点运行跟随 focusRunId 切换', function () {
    const first = makeRun('first', { name: 'a' })
    const second = makeRun('second', { name: 'b', startedAt: new Date(2_000) })
    resetStore([first, second], 'first')

    const { result } = renderHook(function () {
      return useRunSelection()
    })

    expect(result.current.selected?.id).toBe('first')
  })

  it('已结束标签只留最近几条，但焦点运行一定会补进标签', function () {
    const finished = Array.from({ length: 8 }, function (_, index) {
      return makeRun(`done-${index}`, {
        status: 'ok',
        startedAt: new Date(index * 1_000),
        endedAt: new Date(index * 1_000 + 500)
      })
    })
    resetStore(finished, 'done-0')

    const { result } = renderHook(function () {
      return useRunSelection()
    })

    expect(result.current.tabs).toHaveLength(7)
    expect(result.current.selected?.id).toBe('done-0')
    expect(
      result.current.tabs.some(function (run) {
        return run.id === 'done-0'
      })
    ).toBe(true)
  })

  it('步数按指令汇总补齐，缺汇总时为 0', function () {
    const run = makeRun('run-a', { name: 'a' })
    resetStore([run], 'run-a')
    useCorexStore.setState({ directives: [makeEntry('a', 4)] })

    const { result } = renderHook(function () {
      return useRunSelection()
    })

    expect(result.current.stepCount).toBe(4)

    resetStore([makeRun('run-b', { name: 'b' })], 'run-b')
    const missing = renderHook(function () {
      return useRunSelection()
    })

    expect(missing.result.current.stepCount).toBe(0)
  })
})
