import { useEffect, useState } from 'react'

import {
  WorkspaceGit,
  type DiffHunk,
  type DiffMeta,
  type DiffResult,
  type DiffRevs
} from '@/lib/workspace-git'

const HUNK_PAGE = 40

function useAsideDiffData(rootPath: string, relative: string, revs?: DiffRevs | null) {
  const [meta, updateMeta] = useState<DiffMeta | null>(null)
  const [side, updateSide] = useState<DiffResult | null>(null)
  const [hunks, updateHunks] = useState<DiffHunk[]>([])
  const [hunkTotal, updateHunkTotal] = useState(0)
  const [isHunksLoading, updateHunksLoading] = useState(false)
  const [error, updateError] = useState<string | null>(null)
  const [isPending, updatePending] = useState(true)

  const oldOid = revs?.oldOid ?? null
  const newOid = revs?.newOid ?? null

  useEffect(
    function () {
      let cancelled = false
      const range: DiffRevs | undefined =
        oldOid !== null || newOid !== null
          ? { oldOid: oldOid ?? undefined, newOid: newOid ?? undefined }
          : undefined

      updatePending(true)
      updateError(null)
      updateMeta(null)
      updateSide(null)
      updateHunks([])
      updateHunkTotal(0)

      WorkspaceGit.diffMeta(rootPath, relative, range)
        .then(function (nextMeta) {
          if (cancelled) return
          updateMeta(nextMeta)
          if (nextMeta.isBinary || nextMeta.isIdentical) return
          if (nextMeta.mode === 'hunks') {
            updateHunksLoading(true)
            return WorkspaceGit.diffHunks(rootPath, relative, 0, HUNK_PAGE, range)
              .then(function (page) {
                if (cancelled) return
                updateHunks(page.hunks)
                updateHunkTotal(page.total)
              })
              .finally(function () {
                updateHunksLoading(false)
              })
          }
          return WorkspaceGit.diff(rootPath, relative, range).then(function (result) {
            if (!cancelled) updateSide(result)
          })
        })
        .catch(function (cause) {
          console.warn('[agent/aside-diff] 读取差异失败:', cause)
          if (!cancelled) {
            updateError(cause instanceof Error ? cause.message : '读取差异失败')
          }
        })
        .finally(function () {
          if (!cancelled) updatePending(false)
        })

      return function () {
        cancelled = true
      }
    },
    [rootPath, relative, oldOid, newOid]
  )

  async function onMoreHunks() {
    if (isHunksLoading || hunks.length >= hunkTotal) return
    const range: DiffRevs | undefined =
      oldOid !== null || newOid !== null
        ? { oldOid: oldOid ?? undefined, newOid: newOid ?? undefined }
        : undefined
    updateHunksLoading(true)
    try {
      const page = await WorkspaceGit.diffHunks(
        rootPath,
        relative,
        hunks.length,
        HUNK_PAGE,
        range
      )
      updateHunks(function (prev) {
        return prev.concat(page.hunks)
      })
      updateHunkTotal(page.total)
    } catch (cause) {
      console.warn('[agent/aside-diff] 分页失败:', cause)
    } finally {
      updateHunksLoading(false)
    }
  }

  return {
    meta,
    side,
    hunks,
    hunkTotal,
    isHunksLoading,
    error,
    isPending,
    onMoreHunks
  }
}

export { useAsideDiffData, HUNK_PAGE }
