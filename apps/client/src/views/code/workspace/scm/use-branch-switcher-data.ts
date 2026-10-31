import { useEffect } from 'react'

import { useCodeGitStore } from '@/stores/code-git'

function useBranchSwitcherData() {
  const branch = useCodeGitStore(function (state) {
    return state.branch
  })
  const branches = useCodeGitStore(function (state) {
    return state.branches
  })
  const ahead = useCodeGitStore(function (state) {
    return state.ahead
  })
  const behind = useCodeGitStore(function (state) {
    return state.behind
  })
  const isRepo = useCodeGitStore(function (state) {
    return state.isRepo
  })
  const isBranchesLoading = useCodeGitStore(function (state) {
    return state.isBranchesLoading
  })
  const isCheckoutBusy = useCodeGitStore(function (state) {
    return state.isCheckoutBusy
  })

  useEffect(
    function () {
      if (!isRepo) return
      if (useCodeGitStore.getState().branches.length > 0) return
      void useCodeGitStore.getState().toLoadBranches()
    },
    [isRepo]
  )

  const list = branches.length > 0 ? branches : branch ? [branch] : []
  const isBusy = isBranchesLoading || isCheckoutBusy

  return { branch, list, ahead, behind, isRepo, isCheckoutBusy, isBusy }
}

export { useBranchSwitcherData }
