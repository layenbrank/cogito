/**
 * 右栏「任务」面板：卡片列表 / 详情 / 表单三视图在窄栏里切换，不跳页面。
 *
 * 这里只盯**组合逻辑**（点卡片进详情、返回、新建后回列表、启停与立即执行接到 store），
 * 表单与执行记录用桩替代 —— 它们各有自己的用例，不必在这里再跑一遍 IPC。
 */
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Automation } from '@/shared/ipc/specs/automation'

const OWNER_CLIENT = '021'
const OWNER_CLOUD = '023'

const mock = vi.hoisted(function () {
  return {
    automation: {
      items: [] as unknown[],
      cloudItems: [] as unknown[],
      cloudStatus: 'off',
      cloudError: null as string | null,
      isLoading: false,
      running: {},
      phases: {},
      runs: [] as unknown[],
      allRuns: [] as unknown[],
      refresh: vi.fn(async function () {}),
      toggle: vi.fn(async function () {}),
      remove: vi.fn(async function () {}),
      runNow: vi.fn(async function () {}),
      openRuns: vi.fn(async function () {}),
      openAllRuns: vi.fn(async function () {})
    },
    agent: {
      workspaces: [] as unknown[],
      workspaceFolders: [] as unknown[],
      toReadWorkspaces: vi.fn(async function () {}),
      toReadWorkspaceFolders: vi.fn(async function () {})
    },
    dict: {
      bootstrap: vi.fn(async function () {})
    },
    base: {
      bases: [] as unknown[],
      refresh: vi.fn(async function () {})
    },
    provider: {
      providers: [] as unknown[],
      toReadProviders: vi.fn(async function () {
        return []
      })
    }
  }
})

vi.mock('@assistant-ui/react', function () {
  return {
    useAui: function () {
      return {
        threads: {
          reload: vi.fn(async function () {}),
          switchToThread: vi.fn()
        }
      }
    }
  }
})

vi.mock('@/stores/provider', function () {
  const useProviderStore = function (selector: (state: typeof mock.provider) => unknown) {
    return selector(mock.provider)
  }
  return { useProviderStore }
})

vi.mock('@/stores/automation', function () {
  const useAutomationStore = function (selector: (state: typeof mock.automation) => unknown) {
    return selector(mock.automation)
  }
  return { useAutomationStore }
})

vi.mock('@/stores/agent.ts', function () {
  const useAgentStore = function (selector: (state: typeof mock.agent) => unknown) {
    return selector(mock.agent)
  }
  useAgentStore.getState = function () {
    return mock.agent
  }
  return { useAgentStore }
})

vi.mock('@/stores/dict', function () {
  const LABELS: Record<string, string> = {
    [OWNER_CLIENT]: '本机',
    '022': 'goose',
    [OWNER_CLOUD]: '服务端'
  }
  const useDictStore = function (selector: (state: Record<string, unknown>) => unknown) {
    return selector({
      bootstrap: mock.dict.bootstrap,
      findLabel: function (_type: string, value: string) {
        return LABELS[value] ?? value
      }
    })
  }
  useDictStore.getState = function () {
    return { bootstrap: mock.dict.bootstrap }
  }
  return { useDictStore }
})

vi.mock('@/stores/knowledge-base', function () {
  const useKnowledgeBaseStore = function (selector: (state: typeof mock.base) => unknown) {
    return selector(mock.base)
  }
  useKnowledgeBaseStore.getState = function () {
    return mock.base
  }
  return { useKnowledgeBaseStore }
})

vi.mock('@/views/agent/tasks/task-form', function () {
  return {
    TaskForm: function (props: { draft: { id?: string | null }; onCancel: () => void }) {
      return (
        <div>
          <p>{props.draft.id ? '编辑任务（桩）' : '新建任务（桩）'}</p>
          <button
            type="button"
            onClick={props.onCancel}>
            取消
          </button>
        </div>
      )
    }
  }
})

vi.mock('@/views/agent/tasks/task-runs', function () {
  return {
    TaskRuns: function (props: { runs: unknown[] }) {
      return <p>记录 {props.runs.length} 条</p>
    }
  }
})

vi.mock('@iconify/react/offline', function () {
  return {
    Icon: function () {
      return <span />
    }
  }
})

const { AsideTasks } = await import('./aside-tasks')

function makeTask(partial: Partial<Automation>): Automation {
  return {
    id: 'task-1',
    name: '每日整理',
    prompt: '把今天的知识库变更汇总成简报',
    knowledgeBaseId: null,
    workspaceId: null,
    approval: 'readonly',
    providerId: null,
    modelId: null,
    mode: 'agent',
    goalBudget: 6,
    planThenGoal: false,
    planFilePath: null,
    schedule: '0 9 * * *',
    timezone: 'Asia/Shanghai',
    enabled: true,
    owner: OWNER_CLIENT,
    runAsKind: 'user',
    runAsUserId: null,
    tenantId: null,
    remoteId: null,
    nextRunAt: null,
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: 0,
    updatedAt: 0,
    ...partial
  }
}

beforeEach(function () {
  mock.automation.items = []
  mock.automation.cloudItems = []
  mock.automation.cloudStatus = 'off'
  mock.automation.cloudError = null
  mock.automation.isLoading = false
  mock.automation.running = {}
  mock.automation.phases = {}
  mock.automation.runs = []
  mock.automation.allRuns = []
  mock.automation.refresh.mockClear()
  mock.automation.toggle.mockClear()
  mock.automation.remove.mockClear()
  mock.provider.toReadProviders.mockClear()
  mock.automation.runNow.mockClear()
  mock.automation.openRuns.mockClear()
  mock.automation.openAllRuns.mockClear()
})

describe('AsideTasks', function () {
  it('没有任务时给空态与新建入口，并在挂载时拉三源数据', function () {
    render(<AsideTasks />)

    expect(screen.getByText('还没有任务')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /新建任务/ })).toBeInTheDocument()
    expect(mock.automation.refresh).toHaveBeenCalled()
    expect(mock.agent.toReadWorkspaces).toHaveBeenCalled()
    expect(mock.base.refresh).toHaveBeenCalled()
    expect(mock.dict.bootstrap).toHaveBeenCalled()
  })

  it('卡片显示计划与人话排期，点卡片进详情，返回回到列表', function () {
    mock.automation.items = [makeTask({})]
    render(<AsideTasks />)

    const card = screen.getByRole('button', { name: /每日整理/ })
    expect(card).toHaveTextContent('每天 09:00')
    expect(card).toHaveTextContent('未排期')

    fireEvent.click(card)
    // 进详情顺带拉这条任务的执行记录
    expect(mock.automation.openRuns).toHaveBeenCalledWith('task-1')
    expect(screen.getByText('把今天的知识库变更汇总成简报')).toBeInTheDocument()
    expect(screen.getByText('计划')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '返回任务列表' }))
    expect(screen.getByRole('button', { name: /每日整理/ })).toBeInTheDocument()
  })

  it('新建走面板内表单，取消后回到列表（不跳页面）', function () {
    render(<AsideTasks />)

    fireEvent.click(screen.getByRole('button', { name: /^新建$/ }))
    expect(screen.getByText('新建任务（桩）')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByText('还没有任务')).toBeInTheDocument()
  })

  it('卡片的启停与立即执行接到 store；服务端任务不给手动触发', function () {
    mock.automation.items = [makeTask({})]
    mock.automation.cloudItems = [makeTask({ id: 'cloud-1', name: '云端日报', owner: OWNER_CLOUD })]
    render(<AsideTasks />)

    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[0])
    expect(mock.automation.toggle).toHaveBeenCalledWith('task-1', false)

    const runButtons = screen.getAllByRole('button', { name: '立即执行' })
    fireEvent.click(runButtons[0])
    expect(mock.automation.runNow).toHaveBeenCalledWith('task-1')

    // 服务端任务没有 run-now 接口：按钮禁用，不会误发请求
    expect(runButtons[1]).toBeDisabled()
  })

  it('删除要先确认：确认框里点了才真正删，取消则什么都不动', function () {
    mock.automation.items = [makeTask({})]
    render(<AsideTasks />)

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }))

    expect(screen.getByText('删除这个任务？')).toBeInTheDocument()
    // 只是打开确认框，还没删
    expect(mock.automation.remove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(mock.automation.remove).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /每日整理/ })).toBeInTheDocument()
  })
})
