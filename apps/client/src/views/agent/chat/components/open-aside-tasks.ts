/**
 * 从侧栏 / 命令面板 / 自动化会话等线程外区域打开右栏「任务」。
 * 由 `AgentChatLayout`（展开右栏）与 `AgentAside` / `AsideTasks`（切页签、可选进详情）各自订阅；
 * 避免把 aside 状态塞进侧栏 props。
 */

const AGENT_OPEN_ASIDE_TASKS = 'agent:open-aside-tasks'

interface OpenAsideTasksDetail {
  /** 有值则打开后直接进该任务详情 */
  taskId?: string
}

function openAsideTasks(taskId?: string) {
  const detail: OpenAsideTasksDetail = {}
  if (taskId) detail.taskId = taskId
  window.dispatchEvent(new CustomEvent(AGENT_OPEN_ASIDE_TASKS, { detail }))
}

function subscribeAsideTasks(handler: (detail: OpenAsideTasksDetail) => void): () => void {
  function onEvent(event: Event) {
    const detail = (event as CustomEvent<OpenAsideTasksDetail>).detail ?? {}
    handler(detail)
  }
  window.addEventListener(AGENT_OPEN_ASIDE_TASKS, onEvent)
  return function () {
    window.removeEventListener(AGENT_OPEN_ASIDE_TASKS, onEvent)
  }
}

export { AGENT_OPEN_ASIDE_TASKS, openAsideTasks, subscribeAsideTasks }
export type { OpenAsideTasksDetail }
