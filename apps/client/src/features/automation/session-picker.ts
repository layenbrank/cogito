/**
 * 「执行前选择对话」的取数与一次问答。
 *
 * 任务到点是无人值守的：这里只把「这次写进哪个对话」问出来。没有应答（关掉对话框、
 * 到点没人管）都按「新建对话」继续 —— 定时任务不该因为没人点就一直悬着，
 * 但也不能默认往用户正在聊的对话里塞内容，所以默认是新建。
 */
import { create } from 'zustand'

import { THREAD_PREFIX } from '@/features/automation/events'
import { useAgentStore } from '@/stores/agent'

/** 可选对话（列表项按最近活动倒序，最多 30 条） */
interface PickableSession {
  id: string
  title: string
  /** 归属工作区标题；null = 未分组 */
  workspaceTitle: string | null
}

const PICK_LIMIT = 30

/** 无人应答的等待上限：够用户看到弹窗并点一下，又不至于让这一轮排期白等一晚上 */
const ANSWER_TIMEOUT_MS = 120_000

/**
 * 列出可作为「固定对话」的会话。
 *
 * 排除 `automation-` 前缀：那些是每次执行生成的记录会话，绑过去只会让下一次执行
 * 再生成一个同前缀会话，越绑越乱。等宽读库再取快照，冷启动时列表才不是空的。
 *
 * `workspaceID` 给了就只列这个工作区里的对话：任务的执行目录属于一个工作区，
 * 绑上别的工作区的对话，跑起来会按那条对话自己的目录读写 —— 用户以为自己选了项目 A，
 * 实际动的是项目 B。默认（不传）保持全量，给「没有工作区」的任务用。
 */
async function listPickableSessions(workspaceID?: string | null): Promise<PickableSession[]> {
  const store = useAgentStore.getState()
  try {
    await store.toReadSessions()
  } catch (error) {
    console.warn('[automation/session-picker] 读取会话列表失败，按当前快照处理:', error)
  }
  const state = useAgentStore.getState()
  const workspaceTitles = new Map<string, string>()
  for (const workspace of state.workspaces) workspaceTitles.set(workspace.id, workspace.title)
  const scope = workspaceID?.trim() ?? ''
  return state.sessions
    .filter(function (item) {
      return !item.id.startsWith(THREAD_PREFIX)
    })
    .filter(function (item) {
      return scope ? item.workspaceID === scope : true
    })
    .toSorted(function (left, right) {
      return right.updatedAt - left.updatedAt
    })
    .slice(0, PICK_LIMIT)
    .map(function (item) {
      return {
        id: item.id,
        title: item.title,
        workspaceTitle: item.workspaceID ? (workspaceTitles.get(item.workspaceID) ?? null) : null
      }
    })
}

interface PickerRequest {
  taskName: string
  sessions: PickableSession[]
  /** 会话 id；null = 新建对话 */
  resolve: (sessionId: string | null) => void
}

interface PickerState {
  request: PickerRequest | null
  /** 挂起等用户选；超时 / 无人应答都返回 null（新建对话） */
  ask: (input: { taskName: string; sessions: PickableSession[] }) => Promise<string | null>
  /** 对话框作答（id 或 null = 新建） */
  settle: (sessionId: string | null) => void
}

const useAutomationSessionPicker = create<PickerState>(function (set, get) {
  return {
    request: null,

    ask(input) {
      return new Promise<string | null>(function (resolve) {
        let settled = false

        function finish(sessionId: string | null) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (get().request?.resolve === finish) set({ request: null })
          resolve(sessionId)
        }

        const timer = setTimeout(function () {
          console.info('[automation/session-picker] 无人应答，按「新建对话」继续:', input.taskName)
          finish(null)
        }, ANSWER_TIMEOUT_MS)

        // 上一条还没作答就又到期（同时两个任务）：旧的按新建收掉，不叠两个弹窗
        get().request?.resolve(null)
        set({
          request: { taskName: input.taskName, sessions: input.sessions, resolve: finish }
        })
      })
    },

    settle(sessionId) {
      const request = get().request
      if (!request) return
      set({ request: null })
      request.resolve(sessionId)
    }
  }
})

export { listPickableSessions, useAutomationSessionPicker }
export type { PickableSession }
