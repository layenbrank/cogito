/**
 * agent 在嵌入式终端里跑命令时，Rust 会广播 `terminal://agent-run`。
 *
 * 前端据此开 / 选对应 tab，并把面板掀开 —— 用户总能看见 agent 正在跑什么，
 * 也可以直接在那个 shell 里接管（对齐 VS Code 的终端面板行为）。
 */
import { listen } from '@tauri-apps/api/event'

import { EVENTS } from '@/shared/ipc/channels'
import { useTerminalStore } from '@/stores/terminal'
import { reportCaught } from '@/utils/exception-report'

interface AgentRunEvent {
  /** Rust 侧派生的会话 id（`agent:<cwd>`），视图 attach 时用它 */
  id: string
  cwd: string
  command: string
}

function watchAgentTerminal(): void {
  void listen<AgentRunEvent>(EVENTS.TERMINAL_AGENT_RUN, function (event) {
    useTerminalStore.getState().revealAgentTab(event.payload)
  }).catch(function (error) {
    // 监听失败只影响「自动切到终端」，命令本身照跑，所以降级成 warning
    reportCaught('terminal.agentRun.watch', error, 'warning')
  })
}

export { watchAgentTerminal }
export type { AgentRunEvent }
