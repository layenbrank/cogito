import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useCorexStore, type CorexRun } from '@/stores/corex.ts'

import { RunOutputTabs } from './run-output-tabs.tsx'
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

function Harness() {
  const selection = useRunSelection()
  return <RunOutputTabs selection={selection} />
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

describe('RunOutputTabs', function () {
  beforeEach(function () {
    resetStore([])
  })

  it('并发运行时每条指令各占一页标签', function () {
    resetStore([
      makeRun('run-a', { name: 'backup', startedAt: new Date(1_000) }),
      makeRun('run-b', { name: 'cleanup', startedAt: new Date(2_000) })
    ])

    render(<Harness />)

    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.getByRole('tab', { name: /backup/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /cleanup/ })).toBeTruthy()
  })

  it('点标签把回显切到那一页', function () {
    resetStore(
      [
        makeRun('run-a', { name: 'backup', startedAt: new Date(1_000) }),
        makeRun('run-b', { name: 'cleanup', startedAt: new Date(2_000) })
      ],
      'run-b'
    )

    render(<Harness />)

    expect(screen.getByRole('tab', { name: /cleanup/ }).getAttribute('aria-selected')).toBe('true')

    fireEvent.click(screen.getByRole('tab', { name: /backup/ }))

    expect(useCorexStore.getState().focusRunId).toBe('run-a')
  })

  it('选中运行中才给取消，结束后取消消失', function () {
    resetStore([makeRun('run-a', { name: 'backup' })], 'run-a')

    const view = render(<Harness />)
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy()

    resetStore(
      [makeRun('run-a', { name: 'backup', status: 'ok', endedAt: new Date(2_000) })],
      'run-a'
    )
    view.rerender(<Harness />)

    expect(screen.queryByRole('button', { name: '取消' })).toBeNull()
  })

  it('没有运行时整条标签栏不占位', function () {
    const view = render(<Harness />)

    expect(view.container.firstElementChild).toBeNull()
  })
})
