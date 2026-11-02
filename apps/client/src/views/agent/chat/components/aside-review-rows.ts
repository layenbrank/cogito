/**
 * 审阅列表的行数据：按 git 的分组规则拆成暂存 / 未暂存 / 未跟踪三段，
 * 再单独收集「本会话写文件工具触及、但 git 还没感知」的路径。
 *
 * 行身份是 `(path, side)` 而不是 `path`：同一个文件若既有暂存改动、又有
 * 未暂存改动，会在两段里各出现一次（与 VS Code 的行为一致），不做跨侧去重。
 */
import type { ThreadMessage } from '@assistant-ui/react'
import { useMemo } from 'react'

import { collectToolPaths } from '@/features/agent/tool-paths.ts'
import type { StatusEntry } from '@/lib/workspace-git'
import { groupEntries } from '@/views/code/lib/git-status.ts'

interface SplitRows {
  /** 已暂存（HEAD ↔ 暂存区） */
  staged: StatusEntry[]
  /** 已修改未暂存（暂存区 ↔ 工作区） */
  changed: StatusEntry[]
  /** 未跟踪的新文件 */
  untracked: StatusEntry[]
}

interface ReviewRows extends SplitRows {
  /** 本会话工具写过、但不在 git status 里的路径（通常是忽略文件） */
  toolPaths: string[]
  /** 三段合计，用于「无改动」判定（同一文件两侧都有改动时计两次） */
  total: number
}

const EMPTY_ROWS: ReviewRows = {
  staged: [],
  changed: [],
  untracked: [],
  toolPaths: [],
  total: 0
}

/**
 * 只按 git 的 index / worktree 状态分段，不做跨侧去重。
 * 纯函数，便于单测 `(path, side)` 的行身份与分段顺序。
 */
function splitReviewRows(entries: readonly StatusEntry[]): SplitRows {
  const groups = groupEntries(entries as StatusEntry[])
  return {
    staged: groups.staged,
    changed: groups.changed,
    untracked: groups.untracked
  }
}

function useAsideReviewRows(
  rootPath: string | null,
  entries: StatusEntry[],
  messages: readonly ThreadMessage[]
): ReviewRows {
  return useMemo(
    function () {
      if (!rootPath) return EMPTY_ROWS
      const split = splitReviewRows(entries)
      const known = new Set<string>()
      for (const entry of entries) known.add(entry.path)

      const toolPaths = collectToolPaths(messages, rootPath).filter(function (hit) {
        return !known.has(hit.path)
      })

      return {
        staged: split.staged,
        changed: split.changed,
        untracked: split.untracked,
        toolPaths: toolPaths.map(function (hit) {
          return hit.path
        }),
        total: split.staged.length + split.changed.length + split.untracked.length
      }
    },
    [rootPath, entries, messages]
  )
}

function findReviewBaseName(relative: string) {
  const slash = relative.lastIndexOf('/')
  return slash < 0 ? relative : relative.slice(slash + 1)
}

function findReviewParentLabel(relative: string) {
  const slash = relative.lastIndexOf('/')
  return slash < 0 ? '' : relative.slice(0, slash)
}

export { useAsideReviewRows, splitReviewRows, findReviewBaseName, findReviewParentLabel, EMPTY_ROWS }
export type { ReviewRows, SplitRows }
