/**
 * 终端会话引导的行为断言。
 *
 * 这几个 bug 都属于「调用发生了，但状态被后者覆盖」，只看调用次数抓不到 ——
 * 所以用一份**照着真实 store 语义写的假 store**（hydrate 保留退出态、restore 尊重
 * onlyIfHidden、removeTab 补 active），断言落到最终的 `tabs` / `activeId` / `open` 上。
 *
 * 计划「验证 6」里的逻辑部分（切页签不重复 attach、同步按钮不把会话翻回运行态、
 * 进终端不重复开空壳）在这里是确定性的；剩下的真机观感仍需 GUI 验收。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

/** 只取类型：赋值给 `load()` 的返回类型，运行时由动态 import 拿新实例 */
import type * as AgentTabsModule from './agent-tabs'

interface TerminalInfo {
  id: string
  cwd: string
  pid: number | null
}

interface HydrateInput {
  id: string
  cwd: string
  pid: number | null
  origin?: 'user' | 'agent'
}

interface FakeTab {
  id: string
  origin: 'user' | 'agent'
  pid: number | null
  exited: boolean
  restored?: boolean
}

interface RestoreOptions {
  onlyIfHidden?: boolean
}

interface AgentTabInput {
  id: string
  cwd: string
  command: string
}

interface FakeStore {
  tabs: FakeTab[]
  activeId: string | null
  open: boolean
  activity: string
  openPanel: Mock<() => void>
  writeActive: Mock<(id: string) => void>
  newTab: Mock<(cwd: string) => void>
  revealAgentTab: Mock<(input: AgentTabInput) => void>
  removeTab: Mock<(id: string) => void>
  hydrateSession: Mock<(input: HydrateInput) => void>
  restoreAgentPanel: Mock<(options?: RestoreOptions) => void>
}

type AgentRunHandler = (event: { payload: AgentTabInput }) => void

const { fakeStore, listMock, listenMock, reportCaughtMock } = vi.hoisted(function () {
  const state: FakeStore = {
    tabs: [],
    activeId: null,
    open: false,
    activity: 'run',

    openPanel: vi.fn(function () {
      state.open = true
    }),

    writeActive: vi.fn(function (id: string) {
      state.activeId = id
      state.activity = 'terminal'
    }),

    newTab: vi.fn(),

    revealAgentTab: vi.fn(),

    removeTab: vi.fn(function (id: string) {
      const index = state.tabs.findIndex(function (item) {
        return item.id === id
      })
      if (index < 0) return
      state.tabs.splice(index, 1)
      if (state.activeId === id) {
        const fallback = state.tabs[Math.min(index, state.tabs.length - 1)]
        state.activeId = fallback?.id ?? null
      }
    }),

    // 与真实 store 一致：已有 tab 只补 pid + 标 restored，**不把 exited 翻回 false**
    hydrateSession: vi.fn(function (input: HydrateInput) {
      const existing = state.tabs.find(function (item) {
        return item.id === input.id
      })
      if (existing) {
        if (input.pid !== null) existing.pid = input.pid
        existing.restored = true
        return
      }
      const origin = input.origin ?? (input.id.startsWith('agent:') ? 'agent' : 'user')
      state.tabs.push({
        id: input.id,
        origin,
        pid: input.pid,
        exited: false,
        restored: true
      })
      const activeAlive = state.tabs.some(function (item) {
        return item.id === state.activeId
      })
      if (!activeAlive) state.activeId = input.id
    }),

    // 与真实 store 一致：onlyIfHidden 时面板已开且有 active 就不抢
    restoreAgentPanel: vi.fn(function (options?: RestoreOptions) {
      const agentTab =
        state.tabs.find(function (item) {
          return item.origin === 'agent' && !item.exited
        }) ??
        state.tabs.find(function (item) {
          return item.id.startsWith('agent:')
        })
      if (!agentTab) return
      const activeAlive = state.tabs.some(function (item) {
        return item.id === state.activeId
      })
      if (options?.onlyIfHidden === true && state.open && activeAlive) return
      state.open = true
      state.activity = 'terminal'
      if (!activeAlive || !state.activeId) state.activeId = agentTab.id
    })
  }

  return {
    fakeStore: state,
    listMock: vi.fn(function (): Promise<TerminalInfo[]> {
      return Promise.resolve([])
    }),
    listenMock: vi.fn(function (_event: string, _handler: AgentRunHandler): Promise<() => void> {
      return Promise.resolve(function () {})
    }),
    reportCaughtMock: vi.fn()
  }
})

vi.mock('@/lib/terminal', function () {
  return {
    Terminal: {
      list: listMock,
      kill: vi.fn(function (): Promise<void> {
        return Promise.resolve()
      })
    }
  }
})

vi.mock('@/stores/terminal', function () {
  return {
    useTerminalStore: {
      getState: function () {
        return fakeStore
      }
    }
  }
})

vi.mock('@tauri-apps/api/event', function () {
  return { listen: listenMock }
})

vi.mock('@/utils/exception-report', function () {
  return { reportCaught: reportCaughtMock }
})

function session(id: string, pid: number): TerminalInfo {
  return { id, cwd: `C:/work/${id}`, pid }
}

function tab(id: string, origin: 'user' | 'agent', restored?: boolean): FakeTab {
  return { id, origin, pid: null, exited: false, restored }
}

/**
 * 每个用例拿一份全新的模块实例：`bootstrapInFlight` / `bootstrapGeneration` 是模块级状态，
 * 复用同一实例会让上一个用例里 `void bootstrapTerminalSessions()` 的悬空 Promise 干扰下一个。
 */
async function load(): Promise<typeof AgentTabsModule> {
  return import('./agent-tabs')
}

beforeEach(function () {
  vi.resetModules()
  listMock.mockReset()
  listMock.mockImplementation(function () {
    return Promise.resolve([])
  })
  listenMock.mockReset()
  listenMock.mockImplementation(function () {
    return Promise.resolve(function () {})
  })
  reportCaughtMock.mockReset()

  fakeStore.tabs.length = 0
  fakeStore.activeId = null
  fakeStore.open = false
  fakeStore.activity = 'run'
  fakeStore.openPanel.mockClear()
  fakeStore.writeActive.mockClear()
  fakeStore.newTab.mockClear()
  fakeStore.revealAgentTab.mockClear()
  fakeStore.removeTab.mockClear()
  fakeStore.hydrateSession.mockClear()
  fakeStore.restoreAgentPanel.mockClear()
})

afterEach(function () {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('bootstrapTerminalSessions：单飞与代际', function () {
  it('并发调用复用同一个 Promise，只 list 一次', async function () {
    const { bootstrapTerminalSessions } = await load()

    const first = bootstrapTerminalSessions()
    const second = bootstrapTerminalSessions()
    const third = bootstrapTerminalSessions({ force: false })

    expect(second).toBe(first)
    expect(third).toBe(first)
    await first
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('一轮跑完后再调，会重新 list（不是永久缓存）', async function () {
    const { bootstrapTerminalSessions } = await load()

    await bootstrapTerminalSessions()
    await bootstrapTerminalSessions()
    expect(listMock).toHaveBeenCalledTimes(2)

    await bootstrapTerminalSessions({ force: true })
    expect(listMock).toHaveBeenCalledTimes(3)
  })

  it('force 打断：晚到的旧结果直接丢弃，不覆盖新一轮', async function () {
    const { bootstrapTerminalSessions } = await load()

    // 旧一轮卡在 IPC 上
    let releaseStale: (value: TerminalInfo[]) => void = function () {}
    listMock.mockImplementationOnce(function () {
      return new Promise<TerminalInfo[]>(function (resolve) {
        releaseStale = resolve
      })
    })
    const stale = bootstrapTerminalSessions()

    // 新一轮（同步按钮）先把结果写进 store
    listMock.mockImplementationOnce(function () {
      return Promise.resolve([session('agent:a', 11)])
    })
    const fresh = bootstrapTerminalSessions({ force: true })
    await fresh
    expect(fakeStore.tabs.map(function (item) { return item.id })).toEqual(['agent:a'])

    // 旧一轮现在才回来：两个会话都不该被灌进去
    releaseStale([session('agent:a', 11), session('user:u1', 12)])
    const staleResult = await stale

    expect(staleResult.recovered).toBe(false)
    expect(fakeStore.hydrateSession).toHaveBeenCalledTimes(1)
    expect(fakeStore.tabs.map(function (item) { return item.id })).toEqual(['agent:a'])
  })

  it('list 连续失败：重试 4 次后返回空结果并上报', async function () {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(function () {})
    listMock.mockImplementation(function () {
      return Promise.reject(new Error('ipc 未就绪'))
    })
    const { bootstrapTerminalSessions } = await load()

    const task = bootstrapTerminalSessions()
    await vi.advanceTimersByTimeAsync(1600)
    const result = await task

    expect(listMock).toHaveBeenCalledTimes(4)
    expect(result).toEqual({ sessions: [], recovered: false })
    expect(reportCaughtMock).toHaveBeenCalledWith(
      'terminal.bootstrapSessions',
      expect.any(Error),
      'warning'
    )
    expect(warn).toHaveBeenCalled()
    // 失败也不能让后续调用被一个已 rejected 的 in-flight 挡住
    listMock.mockImplementation(function () {
      return Promise.resolve([session('agent:a', 7)])
    })
    await expect(bootstrapTerminalSessions()).resolves.toMatchObject({ recovered: true })
  })
})

describe('bootstrapTerminalSessions：list ↔ tabs 对齐', function () {
  it('摘掉 Rust 已不存在的 agent / restored tab，用户自建 tab 保留', async function () {
    fakeStore.tabs.push(
      tab('agent:gone', 'agent'),
      tab('user:restored', 'user', true),
      tab('user:mine', 'user')
    )
    fakeStore.activeId = 'user:mine'
    listMock.mockImplementation(function () {
      return Promise.resolve([session('user:mine', 42)])
    })
    const { bootstrapTerminalSessions } = await load()

    const result = await bootstrapTerminalSessions()

    expect(fakeStore.tabs.map(function (item) { return item.id })).toEqual(['user:mine'])
    expect(fakeStore.tabs[0]?.pid).toBe(42)
    expect(fakeStore.tabs[0]?.restored).toBe(true)
    expect(result.recovered).toBe(false)
  })

  it('hydrate 传 origin：agent: 前缀算 agent，其余算 user', async function () {
    listMock.mockImplementation(function () {
      return Promise.resolve([session('agent:a', 7), session('user:u1', 8)])
    })
    const { bootstrapTerminalSessions } = await load()

    await bootstrapTerminalSessions()

    expect(
      fakeStore.hydrateSession.mock.calls.map(function (call) {
        return call[0].origin
      })
    ).toEqual(['agent', 'user'])
    expect(fakeStore.tabs.map(function (item) { return item.origin })).toEqual(['agent', 'user'])
  })

  it('有 agent 会话时只补面板，不抢用户正在看的页签', async function () {
    fakeStore.tabs.push(tab('user:mine', 'user'))
    fakeStore.activeId = 'user:mine'
    fakeStore.open = true
    listMock.mockImplementation(function () {
      return Promise.resolve([session('agent:a', 7), session('user:mine', 42)])
    })
    const { bootstrapTerminalSessions } = await load()

    const result = await bootstrapTerminalSessions()

    expect(result.recovered).toBe(true)
    expect(fakeStore.restoreAgentPanel).toHaveBeenCalledWith({ onlyIfHidden: true })
    expect(fakeStore.activeId).toBe('user:mine')
    expect(fakeStore.tabs.map(function (item) { return item.id })).toEqual([
      'user:mine',
      'agent:a'
    ])
  })

  it('面板收起且 active 失效时才接管', async function () {
    fakeStore.open = false
    fakeStore.activeId = 'user:gone'
    listMock.mockImplementation(function () {
      return Promise.resolve([session('agent:a', 7)])
    })
    const { bootstrapTerminalSessions } = await load()

    await bootstrapTerminalSessions()

    expect(fakeStore.open).toBe(true)
    expect(fakeStore.activeId).toBe('agent:a')
  })

  it('没有 agent 会话时不碰面板', async function () {
    listMock.mockImplementation(function () {
      return Promise.resolve([session('user:u1', 8)])
    })
    const { bootstrapTerminalSessions } = await load()

    const result = await bootstrapTerminalSessions()

    expect(result.recovered).toBe(false)
    expect(fakeStore.restoreAgentPanel).not.toHaveBeenCalled()
    expect(fakeStore.open).toBe(false)
  })
})

describe('ensureTerminalTab：不重复开空壳', function () {
  it('已有 tab 时不 newTab，只补 active 并后台同步一次', async function () {
    fakeStore.tabs.push(tab('user:mine', 'user'))
    const { ensureTerminalTab } = await load()

    await ensureTerminalTab('C:/work')

    expect(fakeStore.openPanel).toHaveBeenCalledTimes(1)
    expect(fakeStore.writeActive).toHaveBeenCalledWith('user:mine')
    expect(fakeStore.newTab).not.toHaveBeenCalled()
    await vi.waitFor(function () {
      expect(listMock).toHaveBeenCalledTimes(1)
    })
  })

  it('没有 tab 且 Rust 也没有会话：才新开一个空 shell', async function () {
    const { ensureTerminalTab } = await load()

    await ensureTerminalTab('C:/work')

    expect(fakeStore.newTab).toHaveBeenCalledWith('C:/work')
  })

  it('没有 tab 但 Rust 有存活 agent 会话：复用，不新开', async function () {
    listMock.mockImplementation(function () {
      return Promise.resolve([session('agent:a', 7)])
    })
    const { ensureTerminalTab } = await load()

    await ensureTerminalTab('C:/work')

    expect(fakeStore.newTab).not.toHaveBeenCalled()
    expect(fakeStore.activeId).toBe('agent:a')
  })

  it('cwd 为空时即便没有任何会话也不新开', async function () {
    const { ensureTerminalTab } = await load()

    await ensureTerminalTab(null)

    expect(fakeStore.newTab).not.toHaveBeenCalled()
  })

  it('有 tab 但 active 失效：先补 active，不新开', async function () {
    fakeStore.tabs.push(tab('user:a', 'user'), tab('user:b', 'user'))
    fakeStore.activeId = 'user:gone'
    const { ensureTerminalTab } = await load()

    await ensureTerminalTab('C:/work')

    expect(fakeStore.writeActive).toHaveBeenCalledWith('user:a')
    expect(fakeStore.newTab).not.toHaveBeenCalled()
  })
})

describe('watchAgentTerminal', function () {
  it('收到 terminal://agent-run 时把面板切到该会话', async function () {
    const captured: { handler: AgentRunHandler | null } = { handler: null }
    listenMock.mockImplementation(function (_event: string, handler: AgentRunHandler) {
      captured.handler = handler
      return Promise.resolve(function () {})
    })
    const { watchAgentTerminal } = await load()

    watchAgentTerminal()
    await vi.waitFor(function () {
      expect(captured.handler).not.toBeNull()
    })
    expect(listenMock).toHaveBeenCalledWith(expect.stringContaining('agent-run'), expect.any(Function))

    captured.handler?.({ payload: { id: 'agent:a', cwd: 'C:/w', command: 'pnpm test' } })

    expect(fakeStore.revealAgentTab).toHaveBeenCalledWith({
      id: 'agent:a',
      cwd: 'C:/w',
      command: 'pnpm test'
    })
  })

  it('监听注册失败只降级上报，不抛出', async function () {
    listenMock.mockImplementation(function () {
      return Promise.reject(new Error('no event bridge'))
    })
    const { watchAgentTerminal } = await load()

    expect(function () { watchAgentTerminal() }).not.toThrow()
    await vi.waitFor(function () {
      expect(reportCaughtMock).toHaveBeenCalledWith(
        'terminal.agentRun.watch',
        expect.any(Error),
        'warning'
      )
    })
  })
})
