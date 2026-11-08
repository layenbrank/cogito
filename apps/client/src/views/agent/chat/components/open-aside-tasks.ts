/**
 * 从侧栏 / 命令面板等线程外区域打开右栏「任务」面板。
 * 由 `AgentChatLayout`（展开右栏）与 `AgentAside`（切到任务页签）各自订阅；
 * 避免把 aside 状态塞进侧栏 props。
 */

const AGENT_OPEN_ASIDE_TASKS = 'agent:open-aside-tasks'

function openAsideTasks() {
  window.dispatchEvent(new CustomEvent(AGENT_OPEN_ASIDE_TASKS))
}

function subscribeAsideTasks(handler: () => void): () => void {
  function onEvent() {
    handler()
  }
  window.addEventListener(AGENT_OPEN_ASIDE_TASKS, onEvent)
  return function () {
    window.removeEventListener(AGENT_OPEN_ASIDE_TASKS, onEvent)
  }
}

export { AGENT_OPEN_ASIDE_TASKS, openAsideTasks, subscribeAsideTasks }
