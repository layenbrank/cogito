/**
 * 从 composer 的上下文气泡打开右栏「详情」并展开上下文卡。
 * 由 `AgentAside` 订阅；气泡不直接持有 aside 状态。
 *
 * 事件是同步派发的：aside 收到后在同一次调用里切回「详情」页签，
 * 而 `AsideContextSection` 要等下一次渲染才挂载 —— 订阅者那时还不存在，事件就丢了。
 * 表现是点了「查看详情」，页签切过去了，卡片却还是收起的。
 * 所以先落一个模块级的一次性标记，卡片挂载时取一次。
 */

const AGENT_OPEN_ASIDE_CONTEXT = 'agent:open-aside-context'

/** 待消费的「展开详情」请求（一次性的） */
let pendingExpand = false

function openAsideContext() {
  pendingExpand = true
  window.dispatchEvent(new CustomEvent(AGENT_OPEN_ASIDE_CONTEXT))
}

/** 取走并清掉展开请求；卡片挂载时用 */
function takeAsideContextExpand(): boolean {
  if (!pendingExpand) return false
  pendingExpand = false
  return true
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

export {
  AGENT_OPEN_ASIDE_CONTEXT,
  openAsideContext,
  subscribeAsideContext,
  takeAsideContextExpand
}
