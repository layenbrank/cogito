/**
 * 从 composer 的上下文气泡打开右栏「上下文」页签。
 * 由 `AgentAside` 订阅；气泡不直接持有 aside 状态。
 */

const AGENT_OPEN_ASIDE_CONTEXT = 'agent:open-aside-context'

function openAsideContext() {
  window.dispatchEvent(new CustomEvent(AGENT_OPEN_ASIDE_CONTEXT))
}

function subscribeAsideContext(handler: () => void): () => void {
  function onEvent() {
    handler()
  }
  window.addEventListener(AGENT_OPEN_ASIDE_CONTEXT, onEvent)
  return function () {
    window.removeEventListener(AGENT_OPEN_ASIDE_CONTEXT, onEvent)
  }
}

export { AGENT_OPEN_ASIDE_CONTEXT, openAsideContext, subscribeAsideContext }
