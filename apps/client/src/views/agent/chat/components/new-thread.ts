/**
 * 新建会话的**唯一入口**。
 *
 * 会话归属哪个工作区，取决于用户点的是哪个「+」：工作区节点上的「+」归该工作区，
 * 顶部的「新的任务」归当前激活工作区，一个工作区都没有时归「未分组」。
 * 落库发生在首条消息触发 `adapter.initialize()` 那一刻 —— 所以必须把归属**先记下来**，
 * 否则中途切工作区就会把会话挂到别处。
 *
 * 以前只有侧栏的「+」记归属：`Ctrl+N` / 标题栏按钮直接从命令层 `switchToNewThread()`，
 * 落库时回落到「当下」的 `activeWorkspaceID` —— 用户在 A 工作区按下快捷键、
 * 中途点到 B，这条会话就挂到 B 去了（而且事后看不出是谁改的）。
 */
import { useAgentStore } from '@/stores/agent'

import {
  forgetNextThreadWorkspace,
  rememberNextThreadWorkspace
} from '@/features/agent/port/draft-workspace'

/** 能开新会话的最小依赖（assistant-ui 的 `threads` 控制器） */
interface NewThreadHost {
  switchToNewThread: () => void
}

/**
 * 开一个新会话并记下归属工作区，返回解析出的归属（供侧栏展开对应分支）。
 *
 * `workspaceID` 省略 = 跟随当前激活工作区；显式传 `null` = 明确「未分组」。
 */
function startNewThread(host: NewThreadHost, workspaceID?: string | null): string | null {
  const state = useAgentStore.getState()
  const target =
    workspaceID === undefined
      ? (state.activeWorkspaceID ?? state.workspaces[0]?.id ?? null)
      : workspaceID
  if (target) state.toActivateWorkspace(target)
  rememberNextThreadWorkspace(target)
  host.switchToNewThread()
  return target
}

/**
 * 切到**已有**会话时清掉草稿槽。
 *
 * 槽位是「下一个落库的新会话」的归属；用户放弃新会话去看旧会话时不清，
 * 下一次真正落库的会话会拿到这次点击留下的归属。
 */
function leaveNewThread(): void {
  forgetNextThreadWorkspace()
}

export { leaveNewThread, startNewThread }
export type { NewThreadHost }
