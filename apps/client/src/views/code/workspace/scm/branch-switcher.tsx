/**
 * Git 分支切换（代码窗 SCM 版）：数据来自 code-git store，动作走 store 的 checkout。
 */
import { toast } from 'sonner'

import { useCodeGitStore, type GitOutcome } from '@/stores/code-git'
import { BranchSwitcherView } from '@/views/code/workspace/scm/branch-switcher-view.tsx'
import { useBranchSwitcherData } from '@/views/code/workspace/scm/use-branch-switcher-data.ts'

interface BranchSwitcherProps {
  size?: 'sm' | 'md'
  className?: string
  /** 是否展示 ahead/behind */
  showRemoteDelta?: boolean
  /** toolbar：轮廓按钮；header：扁平贴合顶栏 */
  tone?: 'toolbar' | 'header'
}

function report(outcome: GitOutcome) {
  if (outcome.ok) toast.success(outcome.message)
  else toast.error(outcome.message)
}

function BranchSwitcher(props: BranchSwitcherProps) {
  const data = useBranchSwitcherData()

  if (!data.isRepo) return null

  return (
    <BranchSwitcherView
      branch={data.branch}
      locals={data.list}
      remotes={data.remotes}
      ahead={props.showRemoteDelta === false ? 0 : data.ahead}
      behind={props.showRemoteDelta === false ? 0 : data.behind}
      isBusy={data.isBusy}
      isCheckoutBusy={data.isCheckoutBusy}
      size={props.size}
      tone={props.tone}
      className={props.className}
      onOpen={function () {
        void useCodeGitStore.getState().toLoadBranches()
      }}
      onCheckout={function (name, fromRemote) {
        void useCodeGitStore
          .getState()
          .toCheckoutBranch(name, fromRemote)
          .then(report)
      }}
    />
  )
}

export { BranchSwitcher }
