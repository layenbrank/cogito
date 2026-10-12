import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { WorkspaceGit } from '@/lib/workspace-git'

function useComposerGit(primaryPath: string | null) {
  const [branch, updateBranch] = useState<string | null>(null)
  const [isRepo, updateIsRepo] = useState(false)
  const [branches, updateBranches] = useState<string[]>([])
  const [branchLoading, updateBranchLoading] = useState(false)
  const [branchOpen, updateBranchOpen] = useState(false)

  useEffect(
    function () {
      if (!primaryPath) return
      let cancelled = false
      void WorkspaceGit.probe(primaryPath)
        .then(function (result) {
          if (cancelled) return
          updateIsRepo(result.isRepo)
          updateBranch(result.branch)
        })
        .catch(function (error: unknown) {
          // 探测失败（目录不存在 / 权限）按「非仓库」降级，但要留痕
          console.warn('[composer-git] probe 失败，按非仓库处理:', error)
          if (cancelled) return
          updateIsRepo(false)
          updateBranch(null)
        })
      return function () {
        cancelled = true
      }
    },
    [primaryPath]
  )

  useEffect(
    function () {
      if (!branchOpen || !primaryPath || !isRepo) return
      let cancelled = false
      void WorkspaceGit.fetchBranches(primaryPath)
        .then(function (result) {
          if (cancelled) return
          updateBranches(result.branches)
          updateBranch(result.current)
        })
        .catch(function (error) {
          if (cancelled) return
          toast.error(typeof error === 'string' ? error : '无法加载分支')
        })
      return function () {
        cancelled = true
      }
    },
    [branchOpen, primaryPath, isRepo]
  )

  async function checkout(nextBranch: string) {
    if (!primaryPath || nextBranch === branch) {
      updateBranchOpen(false)
      return
    }
    updateBranchLoading(true)
    try {
      const result = await WorkspaceGit.checkout(primaryPath, nextBranch)
      updateBranch(result.branch)
      updateBranchOpen(false)
      toast.success(`已切换到 ${result.branch}`)
    } catch (error) {
      toast.error(typeof error === 'string' ? error : '切换分支失败')
    } finally {
      updateBranchLoading(false)
    }
  }

  const showGit = Boolean(primaryPath && isRepo && branch)

  return {
    branch,
    branches,
    branchLoading,
    branchOpen,
    updateBranchOpen,
    showGit,
    checkout
  }
}

export { useComposerGit }
