/**
 * agent 在嵌入式终端里跑命令时，Rust 会广播 `terminal://agent-run`。
 *
 * 前端据此开 / 选对应 tab，并把面板掀开 —— 用户总能看见 agent 正在跑什么，
 * 也可以直接在那个 shell 里接管（对齐 VS Code 的终端面板行为）。
 *
 * WebView 刷新后 zustand tabs 会丢，但 Rust PTY 可能仍在：`bootstrapTerminalSessions`
 * 用 `Terminal.list()` 把存活会话灌回 UI；有 agent 会话时再 restore 面板（reconnect）。
 *
 * **单飞 + generation**：这个函数会被 `main.tsx`、右栏挂载、`selectTab`、`openTerminal`、
 * `ensureTerminalTab`、「同步会话」按钮并发调用。早期没有去重，后一次 `Terminal.list()`
 * 的结果会覆盖前一次，`hydrateSession` 还会把刚被标成退出的 tab 翻回运行态 ——
 * 表现为「终端状态自己乱跳」。现在同一时刻只有一轮在跑；被 force 打断的旧轮直接丢弃结果。
 */
import { listen } from '@tauri-apps/api/event'

import { Terminal, type TerminalInfo } from '@/lib/terminal'
import { EVENTS } from '@/shared/ipc/channels'
import { useTerminalStore } from '@/stores/terminal'
import { reportCaught } from '@/utils/exception-report'

interface AgentRunEvent {
  /** Rust 侧派生的会话 id（`agent:<cwd>`），视图 attach 时用它 */
  id: string
  cwd: string
  command: string
}

interface BootstrapResult {
  sessions: TerminalInfo[]
  /** 是否恢复了 agent 会话并掀开面板 */
  recovered: boolean
}

interface BootstrapOptions {
  /** 已经有在跑的一轮时，丢掉它、重新 list（「同步会话」按钮用） */
  force?: boolean
}

function watchAgentTerminal(): void {
  void listen<AgentRunEvent>(EVENTS.TERMINAL_AGENT_RUN, function (event) {
    useTerminalStore.getState().revealAgentTab(event.payload)
  }).catch(function (error) {
    // 监听失败只影响「自动切到终端」，命令本身照跑，所以降级成 warning
    reportCaught('terminal.agentRun.watch', error, 'warning')
  })
}

/** 冷启动时 Rust 侧车可能还没注册好命令：重试 4 次，仍失败返回 null */
async function listTerminalSessions(): Promise<TerminalInfo[] | null> {
  let attempt = 0
  let lastError: unknown = null
  while (attempt < 4) {
    try {
      return await Terminal.list()
    } catch (error) {
      lastError = error
      console.warn('[terminal] bootstrap 暂失败，重试中:', error)
      attempt += 1
      if (attempt >= 4) break
      await new Promise(function (resolve) {
        window.setTimeout(resolve, 250 * attempt)
      })
    }
  }
  reportCaught('terminal.bootstrapSessions', lastError, 'warning')
  return null
}

function applyListedSessions(listed: TerminalInfo[]): BootstrapResult {
  const store = useTerminalStore.getState()
  const listedIds = new Set(
    listed.map(function (session) {
      return session.id
    })
  )

  // list ↔ tabs：Rust 已不存在的 agent/restored tab 摘掉（不 kill，Hub 里本就没了）
  for (const tab of [...store.tabs]) {
    if ((tab.origin === 'agent' || tab.restored) && !listedIds.has(tab.id)) {
      store.removeTab(tab.id)
    }
  }

  for (const session of listed) {
    store.hydrateSession({
      id: session.id,
      cwd: session.cwd,
      pid: session.pid,
      origin: session.id.startsWith('agent:') ? 'agent' : 'user'
    })
  }

  const hasAgent = listed.some(function (session) {
    return session.id.startsWith('agent:')
  })
  // 后台同步只补「面板没开 / active 失效」，不抢用户正在看的页签
  if (hasAgent) {
    useTerminalStore.getState().restoreAgentPanel({ onlyIfHidden: true })
  }
  return { sessions: listed, recovered: hasAgent }
}

let bootstrapInFlight: Promise<BootstrapResult> | null = null
/** 每发起一轮 +1；跑完发现不是最新一轮就丢弃结果 */
let bootstrapGeneration = 0

/**
 * 启动 / 右栏 mount：把 Rust 存活会话灌回 tabs。
 * 有 `agent:` 会话时掀开面板（页面重载后仍可管理正在跑的命令）。
 */
function bootstrapTerminalSessions(options: BootstrapOptions = {}): Promise<BootstrapResult> {
  if (bootstrapInFlight && options.force !== true) return bootstrapInFlight

  const generation = ++bootstrapGeneration
  const task = (async function (): Promise<BootstrapResult> {
    const listed = await listTerminalSessions()
    if (listed === null) return { sessions: [], recovered: false }
    if (generation !== bootstrapGeneration) {
      // 有更新的一轮已经跑过：这批结果可能已经过时，直接丢弃
      console.debug('[terminal] bootstrap 结果过期，丢弃', { generation, latest: bootstrapGeneration })
      return { sessions: listed, recovered: false }
    }
    return applyListedSessions(listed)
  })().finally(function () {
    if (bootstrapInFlight === task) bootstrapInFlight = null
  })

  bootstrapInFlight = task
  return task
}

/**
 * 「进终端页时一定要看到东西」：
 * 先把后台存活会话灌回来，**真的**一个都没有才新开一个空 shell。
 *
 * 早期是「先 newTab 再等同步」，结果是每次进终端都多出一个空 tab，
 * 而真正在跑的 agent 会话被挤到后面 —— 看起来就像「终端没启动」。
 */
async function ensureTerminalTab(cwd: string | null): Promise<void> {
  const store = useTerminalStore.getState()
  store.openPanel()

  function settleActive(next: ReturnType<typeof useTerminalStore.getState>) {
    // 已有 tabs 但没有 active（刷新 / 中断后常见）→ 右栏挂了壳却空白
    if (!next.activeId && next.tabs.length > 0) {
      next.writeActive(next.tabs[0].id)
    }
  }

  if (store.tabs.length > 0) {
    settleActive(store)
    // 已有 tab：仍然同步一次，避免后台新会话缺席
    void bootstrapTerminalSessions()
    return
  }
  await bootstrapTerminalSessions()
  const after = useTerminalStore.getState()
  if (after.tabs.length > 0) {
    settleActive(after)
    return
  }
  if (!cwd) return
  after.newTab(cwd)
}

export { bootstrapTerminalSessions, ensureTerminalTab, watchAgentTerminal }
export type { AgentRunEvent, BootstrapOptions, BootstrapResult }
