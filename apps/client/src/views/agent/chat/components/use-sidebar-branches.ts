import { useAuiState } from '@assistant-ui/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { compareByPinnedRecency, latestTime, orderSessions } from './session-order.ts'
import type { WorkspaceBranch } from './sidebar-workspace-tree.tsx'
import {
  buildThreadItemIndex,
  findIndexedThreadItem,
  type ThreadItemSnapshot
} from './thread-items.ts'
import { useRunningThreads } from '@/features/agent/acp/run-state'
import { THREAD_PREFIX as AUTOMATION_PREFIX } from '@/features/automation/events'
import { UNGROUPED_WORKSPACE } from '@/features/agent/model/workspace'
import { useAgentStore, type Session } from '@/stores/agent.ts'

/**
 * 侧栏会话条目：标识 / 草稿 / 归属来自 assistant-ui 的线程列表（`threadIds` + `threadItems`），
 * 「最近活动」则**以库里的行（`stores/agent.ts` 的 `sessions`）为准**。
 *
 * 为什么不能只用列表项的 `lastMessageAt`：它来自 `list()` 返回的元数据，只在启动或
 * `threads.reload()` 时刷新，发消息不会动它。于是新建会话的第一条消息落库后（列表项
 * 已从草稿变成正式会话，但 `lastMessageAt` 还是空的）会直接沉到工作区最底；老会话收了
 * 新消息也不会浮上来。库里那一行的 `updatedAt` 由消息写入时 touch（Rust
 * `agent_message::Service::write_one` + 客户端 `toTouchSession`），两个来源取较新者才跟得上。
 *
 * 自动展开只在「出现新工作区 id」时写一次 state；依赖稳定的 id 串，
 * 避免流式时 `threadItems` 每帧换引用 → effect 与 Collapsible `onOpenChange` 互殴
 * （Maximum update depth / 页面崩溃、会话流被中断）。
 *
 * 排序规则本身在 `session-order.ts`：草稿 → 置顶 → 最近活动 → id。
 */
interface SidebarSession {
  id: string
  title: string
  pinned: boolean
  /** 还没落库的新会话（排最前，见 `session-order.ts`） */
  draft: boolean
  workspaceID: string | null
  /** 最近活动（epoch ms），0 = 从没有过活动；两个来源都已归一，NaN 进不了比较 */
  updatedAt: number
  /** 列表插入顺序（只有草稿的排序用得上，越小越靠前） */
  order: number
  /** 这一轮仍在生成（切走的会话也会继续跑，左栏要能看出来） */
  isRunning: boolean
}

/** assistant-ui 给「还没落库的新会话」的列表项 id 前缀（`initialize()` 之后才有 remoteId） */
const DRAFT_THREAD_PREFIX = '__LOCALID_'

/**
 * 是不是草稿（未落库）。
 *
 * 列表项缺失时只认 id 前缀：快照还没水合就把整张列表判成草稿，只会让它们按 id 乱序挤在最上面。
 */
function isDraftThread(id: string, item: ThreadItemSnapshot | null): boolean {
  if (!item) return id.startsWith(DRAFT_THREAD_PREFIX)
  // 落库前没有 remoteId；`status === 'new'` 是同一件事的显式说法
  return item.status === 'new' || !item.remoteId
}

/**
 * 归属取列表项的 `custom.workspaceID`（`updateCustom` 会同步它），
 * 列表项缺失时回退到库里那一行 —— 刚启动、快照还没水合时也不会掉进「未分组」。
 */
function toWorkspaceID(
  custom: ThreadItemSnapshot['custom'],
  stored: Session | undefined
): string | null {
  const value = custom?.workspaceID
  if (typeof value === 'string') return value
  if (value === null) return null
  return stored?.workspaceID ?? null
}

function useSidebarBranches() {
  const workspaces = useAgentStore(function (state) {
    return state.workspaces
  })
  const workspaceFolders = useAgentStore(function (state) {
    return state.workspaceFolders
  })
  const storedSessions = useAgentStore(function (state) {
    return state.sessions
  })
  const threadIds = useAuiState(function (state) {
    return state.threads.threadIds
  })
  const threadItems = useAuiState(function (state) {
    return state.threads.threadItems
  })
  const runningThreadIDs = useRunningThreads()

  const [expandedKeys, updateExpandedKeys] = useState<string[]>([])
  const expandedKeySet = useMemo(function () {
    return new Set(expandedKeys)
  }, [expandedKeys])

  function isAutomationThread(id: string, remoteId?: string | null): boolean {
    return id.startsWith(AUTOMATION_PREFIX) || Boolean(remoteId?.startsWith(AUTOMATION_PREFIX))
  }

  const sessions: SidebarSession[] = useMemo(
    function () {
      const storedByID = new Map<string, Session>()
      for (const stored of storedSessions) storedByID.set(stored.id, stored)
      // 一次建索引：数组形态下逐个 `.find()` 是 O(会话数²)
      const itemIndex = buildThreadItemIndex(threadItems)

      return threadIds.map(function (id, index) {
        const item = findIndexedThreadItem(itemIndex, id)
        const stored = storedByID.get(item?.remoteId ?? id)
        const custom = item?.custom
        return {
          id,
          title: item?.title ?? '新对话',
          pinned: custom?.pinned === true,
          draft: isDraftThread(id, item),
          workspaceID: toWorkspaceID(custom, stored),
          // 列表项的时间可能停在启动那一刻；库里那一行才是活的，取较新者
          updatedAt: latestTime(
            item?.lastMessageAt ? item.lastMessageAt.getTime() : 0,
            stored?.updatedAt
          ),
          // 草稿之间按列表顺序（最新插入的在前），不拿随机 UUID 兜底
          order: index,
          isRunning: runningThreadIDs.has(id) || runningThreadIDs.has(item?.remoteId ?? id)
        }
      })
    },
    [threadIds, threadItems, storedSessions, runningThreadIDs]
  )

  /**
   * 自动化会话：不进工作区树。
   * 以落库行为准（runner 直写 `agent_session`），再与 aui 列表对齐 id/running。
   */
  const automationSessions: SidebarSession[] = useMemo(
    function () {
      const fromAui = new Map<string, SidebarSession>()
      for (const session of sessions) {
        if (!isAutomationThread(session.id)) continue
        fromAui.set(session.id, session)
      }
      const merged: SidebarSession[] = []
      for (const stored of storedSessions) {
        if (!stored.id.startsWith(AUTOMATION_PREFIX)) continue
        const live = fromAui.get(stored.id)
        merged.push({
          id: stored.id,
          title: live?.title || stored.title || '自动化执行',
          pinned: live?.pinned ?? stored.pinned,
          draft: false,
          workspaceID: stored.workspaceID,
          updatedAt: latestTime(live?.updatedAt ?? 0, stored.updatedAt),
          order: live?.order ?? 0,
          isRunning: live?.isRunning || runningThreadIDs.has(stored.id)
        })
        fromAui.delete(stored.id)
      }
      // aui 里有、库里还没水合到的也收进来
      for (const leftover of fromAui.values()) merged.push(leftover)
      return merged.toSorted(function (left, right) {
        if (left.isRunning !== right.isRunning) return left.isRunning ? -1 : 1
        return right.updatedAt - left.updatedAt
      })
    },
    [sessions, storedSessions, runningThreadIDs]
  )

  const branches: WorkspaceBranch[] = useMemo(
    function () {
      const sortedWorkspaces = workspaces.toSorted(compareByPinnedRecency)

      function findWorkspacePaths(workspaceID: string): string[] {
        return workspaceFolders
          .filter(function (folder) {
            return folder.workspaceID === workspaceID
          })
          .toSorted(function (a, b) {
            return a.sort - b.sort
          })
          .map(function (folder) {
            return folder.path
          })
      }

      // 一次归拢：原先每个工作区都过滤一遍全量会话，工作区 × 会话是平方级
      const sessionsByWorkspace = new Map<string, SidebarSession[]>()
      const ungrouped: SidebarSession[] = []
      for (const session of sessions) {
        // 自动化会话单独成组，不进工作区树
        if (isAutomationThread(session.id)) continue
        if (!session.workspaceID) {
          ungrouped.push(session)
          continue
        }
        const bucket = sessionsByWorkspace.get(session.workspaceID)
        if (bucket) bucket.push(session)
        else sessionsByWorkspace.set(session.workspaceID, [session])
      }

      const result: WorkspaceBranch[] = sortedWorkspaces.map(function (workspace) {
        return {
          id: workspace.id,
          title: workspace.title,
          icon: workspace.icon,
          color: workspace.color,
          pinned: workspace.pinned,
          paths: findWorkspacePaths(workspace.id),
          sessions: orderSessions(sessionsByWorkspace.get(workspace.id) ?? [])
        }
      })

      if (ungrouped.length > 0) {
        result.push({
          id: UNGROUPED_WORKSPACE,
          title: '未分组',
          icon: 'folder',
          color: '',
          pinned: false,
          paths: [],
          sessions: orderSessions(ungrouped)
        })
      }

      return result
    },
    [workspaces, sessions, workspaceFolders]
  )

  /** 仅 id 列表；流式更新 title/updatedAt 不会触发自动展开 effect */
  const branchIdsKey = useMemo(
    function () {
      return branches
        .map(function (branch) {
          return branch.id
        })
        .join('\0')
    },
    [branches]
  )

  const seededIdsRef = useRef<Set<string>>(new Set())

  useEffect(
    function () {
      if (!branchIdsKey) return
      const ids = branchIdsKey.split('\0').filter(Boolean)
      const missing = ids.filter(function (id) {
        return !seededIdsRef.current.has(id)
      })
      if (missing.length === 0) return

      for (const id of missing) seededIdsRef.current.add(id)

      updateExpandedKeys(function (prev) {
        const next = new Set(prev)
        let changed = false
        for (const id of missing) {
          if (!next.has(id)) {
            next.add(id)
            changed = true
          }
        }
        return changed ? Array.from(next) : prev
      })
    },
    [branchIdsKey]
  )

  return {
    branches,
    automationSessions,
    expandedKeys,
    expandedKeySet,
    updateExpandedKeys
  }
}

export { useSidebarBranches }
export type { SidebarSession }
