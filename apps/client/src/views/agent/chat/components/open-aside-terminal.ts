/**
 * 从工具卡等线程外区域打开右栏「终端」并定位到某条命令的会话。
 * 由 `AgentChatLayout`（展开右栏）与 `AgentAside`（切页签 + 命中会话）各自订阅；
 * 避免把 aside 状态塞进 tool-card props（与 `open-aside-browser` 同一套约定）。
 *
 * 对话流里的命令卡只做收据：真正可滚动的输出在右栏终端，点这里过去看，
 * 不在消息里再摆一个终端。
 */

const AGENT_OPEN_ASIDE_TERMINAL = 'agent:open-aside-terminal'

interface AsideTerminalDetail {
  /** 这条命令本身：用来在已有 agent tab 里命中同一个会话 */
  command?: string | null
  /** 会话 cwd：命中不到命令时按工作目录回退 */
  workdir?: string | null
}

function openAsideTerminal(detail: AsideTerminalDetail = {}) {
  window.dispatchEvent(
    new CustomEvent<AsideTerminalDetail>(AGENT_OPEN_ASIDE_TERMINAL, {
      detail: {
        command: detail.command ?? null,
        workdir: detail.workdir ?? null
      }
    })
  )
}

function subscribeAsideTerminal(handler: (detail: AsideTerminalDetail) => void): () => void {
  function onEvent(event: Event) {
    const custom = event as CustomEvent<AsideTerminalDetail>
    handler(custom.detail ?? {})
  }
  window.addEventListener(AGENT_OPEN_ASIDE_TERMINAL, onEvent)
  return function () {
    window.removeEventListener(AGENT_OPEN_ASIDE_TERMINAL, onEvent)
  }
}

export { AGENT_OPEN_ASIDE_TERMINAL, openAsideTerminal, subscribeAsideTerminal }
export type { AsideTerminalDetail }
