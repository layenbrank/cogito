import { useEffect, useState } from 'react'

import { WorkspaceGit, type StatusEntry } from '@/lib/workspace-git'

function useAsideReviewStatus(rootPath: string | null, refreshKey: number, revision = 0) {
  const [entriesState, updateEntries] = useState<StatusEntry[]>([])
  const [isPending, updatePending] = useState(false)
  const [error, updateError] = useState<string | null>(null)
  const [isRepoState, updateIsRepo] = useState(true)

  useEffect(
    function () {
      if (!rootPath) return

      let cancelled = false
      const root = rootPath

      updatePending(true)
      updateError(null)

      WorkspaceGit.probe(root)
        .then(function (probe) {
          if (cancelled) return null
          updateIsRepo(probe.isRepo)
          if (!probe.isRepo) {
            updateEntries([])
            return null
          }
          return WorkspaceGit.status(root)
        })
        .then(function (status) {
          if (cancelled || !status) return
          updateEntries(status.entries)
        })
        .catch(function (cause) {
          console.warn('[agent/aside-review] 读取变更失败:', cause)
          if (!cancelled) {
            updateError(cause instanceof Error ? cause.message : '读取变更失败')
            updateEntries([])
          }
        })
        .finally(function () {
          if (!cancelled) updatePending(false)
        })

      return function () {
        cancelled = true
      }
    },
    [rootPath, refreshKey, revision]
  )

  return {
    entries: rootPath ? entriesState : [],
    isPending,
    error,
    isRepo: rootPath ? isRepoState : false
  }
}

export { useAsideReviewStatus }
