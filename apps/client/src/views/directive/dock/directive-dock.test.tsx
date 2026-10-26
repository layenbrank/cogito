import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCorexStore, type CorexRun } from '@/stores/corex.ts'
import { useTerminalStore } from '@/stores/terminal.ts'
import { createDirective } from '@/views/directive/model/draft.ts'

import { DirectiveDock } from './directive-dock.tsx'

vi.mock('@/features/terminal/terminal-tabs', function () {
  return {
    TerminalTabs: function TerminalTabs() {
      return <div data-testid="terminal-tabs" />
    }
  }
})

/** xterm 在 jsdom 里跑不起来，这里只关心底栏把哪个运行实例交给输出区 */
vi.mock('@/features/terminal/terminal-output-tab', function () {
  return {
    TerminalOutputTab: function TerminalOutputTab(props: { runId: string | null }) {
      return <div data-testid="terminal-output">{props.runId ?? 'none'}</div>
    }
  }
})

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

function resetStores(runs: CorexRun[], focusRunId: string | null, activity: 'run' | 'input') {
  useCorexStore.setState({
    runs,
    focusRunId,
    directives: [],
    catalog: [],
    draft: {
      ...createDirective('nightly'),
      inputs: [{ name: 'env', description: '环境', required: true }]
    },
    editorName: 'nightly'
  })
  useTerminalStore.setState({
    open: true,
    activity,
    tabs: [],
    activeId: null
  })
}

function renderDock(path = '/directive/nightly') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/directive"
          element={<DirectiveDock />}
        />
        <Route
          path="/directive/:name"
          element={<DirectiveDock />}
        />
      </Routes>
    </MemoryRouter>
  )
}

describe('DirectiveDock', function () {
  beforeEach(function () {
    resetStores([], null, 'run')
  })

  /** 输入参数只在「参数」页，输出页不再叠表单 */
  it('参数表单落在「参数」页，输出页只剩标签与回显', function () {
    resetStores([makeRun('run-a', { name: 'nightly' })], 'run-a', 'input')
    const view = renderDock()

    const field = screen.getByLabelText(/env/)
    expect(field.closest('[aria-hidden="true"]')).toBeNull()
    expect(screen.getByText('试跑动作')).toBeTruthy()

    view.unmount()
    useTerminalStore.setState({ activity: 'run' })
    renderDock()

    expect(screen.getByLabelText(/env/).closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('输出页展示全部并发运行的标签，回显跟随选中的那个', function () {
    resetStores(
      [
        makeRun('run-a', { name: 'nightly', startedAt: new Date(1_000) }),
        makeRun('run-b', { name: 'cleanup', startedAt: new Date(2_000) })
      ],
      'run-b',
      'run'
    )
    renderDock()

    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.getByTestId('terminal-output').textContent).toBe('run-b')
  })

  it('列表页没有指令上下文时不显示「参数」页', function () {
    resetStores([], null, 'run')
    renderDock('/directive')

    expect(screen.queryByRole('button', { name: '参数' })).toBeNull()
    expect(screen.getByRole('button', { name: '输出' })).toBeTruthy()
  })
})
