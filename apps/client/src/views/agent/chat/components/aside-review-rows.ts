import type { ThreadMessage } from '@assistant-ui/react'
import { useMemo } from 'react'

import { collectToolPaths } from '@/features/agent/tool-paths.ts'
import type { StatusEntry } from '@/lib/workspace-git'
import { findStatusBadge, groupEntries } from '@/views/code/lib/git-status.ts'

interface ReviewRow {
  path: string
  badge: string | null
  source: 'git' | 'tool'
}

function useAsideReviewRows(
  rootPath: string | null,
  entries: StatusEntry[],
  messages: readonly ThreadMessage[]
) {
  return useMemo(
    function () {
      if (!rootPath) return [] as ReviewRow[]
      const groups = groupEntries(entries)
      const fromGit = new Map<string, ReviewRow>()
      for (const entry of [...groups.staged, ...groups.changed, ...groups.untracked]) {
        if (fromGit.has(entry.path)) continue
        fromGit.set(entry.path, {
          path: entry.path,
          badge: findStatusBadge(entry),
          source: 'git'
        })
      }

      const toolHits = collectToolPaths(messages, rootPath)
      const merged: ReviewRow[] = [...fromGit.values()]
      for (const hit of toolHits) {
        if (fromGit.has(hit.path)) continue
        merged.push({ path: hit.path, badge: null, source: 'tool' })
      }
      return merged
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

export { useAsideReviewRows, findReviewBaseName, findReviewParentLabel }
export type { ReviewRow }
