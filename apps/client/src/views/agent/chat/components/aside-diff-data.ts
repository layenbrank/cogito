import { useEffect, useState } from 'react'

import {
  WorkspaceGit,
  type DiffHunk,
  type DiffMeta,
  type DiffResult,
  type DiffRevs
} from '@/lib/workspace-git'

const HUNK_PAGE = 40

/**
 * 拉一个文件的差异：先取 meta（二进制 / 是否巨大 / 展示模式），
 * 小文件直接给两侧全文，大重写走 hunks 分页。
 *
 * `revs` 决定对比口径（HEAD↔工作区 / HEAD↔暂存区 / 暂存区↔工作区 / 两个提交）。
 */
function useAsideDiffData(rootPath: string, relative: string, revs?: DiffRevs) {
  const [meta, updateMeta] = useState<DiffMeta | null>(null)
  const [side, updateSide] = useState<DiffResult | null>(null)
  const [hunks, updateHunks] = useState<DiffHunk[]>([])
  const [hunkTotal, updateHunkTotal] = useState(0)
  const [isHunksLoading, updateHunksLoading] = useState(false)
  const [error, updateError] = useState<string | null>(null)
  const [isPending, updatePending] = useState(true)

  const oldOid = revs?.oldOid ?? null
  const newOid = revs?.newOid ?? null
  const side_ = revs?.side

  useEffect(
    function () {
      let cancelled = false
      const nextRevs: DiffRevs | undefined =
        oldOid === null && newOid === null && !side_
          ? undefined
          : { oldOid: oldOid ?? undefined, newOid: newOid ?? undefined, side: side_ }

      updatePending(true)
      updateError(null)
      updateMeta(null)
      updateSide(null)
      updateHunks([])
      updateHunkTotal(0)

      WorkspaceGit.diffMeta(rootPath, relative, nextRevs)
        .then(function (nextMeta) {
          if (cancelled) return
          updateMeta(nextMeta)
          if (nextMeta.isBinary || nextMeta.isIdentical) return
          if (nextMeta.mode === 'hunks') {
            updateHunksLoading(true)
            return WorkspaceGit.diffHunks(rootPath, relative, 0, HUNK_PAGE, nextRevs)
              .then(function (page) {
                if (cancelled) return
                updateHunks(page.hunks)
                updateHunkTotal(page.total)
              })
              .finally(function () {
                updateHunksLoading(false)
              })
          }
          return WorkspaceGit.diff(rootPath, relative, nextRevs).then(function (result) {
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
    [rootPath, relative, oldOid, newOid, side_]
  )

  async function onMoreHunks() {
    if (isHunksLoading || hunks.length >= hunkTotal) return
    const nextRevs: DiffRevs | undefined =
      oldOid === null && newOid === null && !side_
        ? undefined
        : { oldOid: oldOid ?? undefined, newOid: newOid ?? undefined, side: side_ }
    updateHunksLoading(true)
    try {
      const page = await WorkspaceGit.diffHunks(
        rootPath,
        relative,
        hunks.length,
        HUNK_PAGE,
        nextRevs
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
