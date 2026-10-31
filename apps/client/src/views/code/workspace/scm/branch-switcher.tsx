/**
 * Git 分支切换：下拉列出本地分支，选中后 checkout 并刷新 SCM / 提交列表。
 */
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { toast } from 'sonner'

import { useCodeGitStore, type GitOutcome } from '@/stores/code-git'
import { BranchSwitcherTrigger } from '@/views/code/workspace/scm/branch-switcher-trigger.tsx'
import { branchSwitcherButtonClass } from '@/views/code/workspace/scm/branch-switcher-styles.ts'
import { BranchSwitcherMenu } from '@/views/code/workspace/scm/branch-switcher-menu.tsx'
import { useBranchSwitcherData } from '@/views/code/workspace/scm/use-branch-switcher-data.ts'

type BranchSwitcherSize = 'sm' | 'md'

interface BranchSwitcherProps {
  size?: BranchSwitcherSize
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
  const size = props.size ?? 'md'
  const tone = props.tone ?? 'toolbar'
  const showRemoteDelta = props.showRemoteDelta ?? true
  const data = useBranchSwitcherData()

  if (!data.isRepo) return null

  return (
    <DropdownMenu
      onOpenChange={function (open) {
        if (open) void useCodeGitStore.getState().toLoadBranches()
      }}>
      <DropdownMenuTrigger
        disabled={data.isBusy || data.list.length === 0}
        render={
          <Button
            type="button"
            variant={tone === 'header' ? 'ghost' : 'outline'}
            size="sm"
            title="切换分支"
            aria-label={`当前分支 ${data.branch || '未知'}，点击切换`}
            className={branchSwitcherButtonClass(size, tone, props.className)}
          />
        }>
        <BranchSwitcherTrigger
          size={size}
          tone={tone}
          branch={data.branch}
          isBusy={data.isBusy}
          showRemoteDelta={showRemoteDelta}
          ahead={data.ahead}
          behind={data.behind}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        className="max-h-72 w-auto min-w-52 max-w-72 overflow-y-auto p-1">
        <BranchSwitcherMenu
          branch={data.branch}
          list={data.list}
          isCheckoutBusy={data.isCheckoutBusy}
          onCheckout={function (name) {
            void useCodeGitStore.getState().toCheckoutBranch(name).then(report)
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { BranchSwitcher }
