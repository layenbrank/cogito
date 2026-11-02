/**
 * 分支切换下拉（纯展示）：数据与动作都由调用方传入。
 *
 * 代码窗的 SCM 用 store 数据、右栏审阅用 agent 共享快照，两处共用这套 UI。
 */
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'

import { BranchSwitcherMenu } from '@/views/code/workspace/scm/branch-switcher-menu.tsx'
import { branchSwitcherButtonClass } from '@/views/code/workspace/scm/branch-switcher-styles.ts'
import { BranchSwitcherTrigger } from '@/views/code/workspace/scm/branch-switcher-trigger.tsx'

type BranchSwitcherSize = 'sm' | 'md'

interface BranchSwitcherViewProps {
  branch: string
  locals: string[]
  remotes?: string[]
  ahead: number
  behind: number
  isBusy?: boolean
  isCheckoutBusy?: boolean
  size?: BranchSwitcherSize
  /** toolbar：轮廓按钮；header：扁平贴合顶栏 */
  tone?: 'toolbar' | 'header'
  className?: string
  /** 展开时通知调用方补数据（store 版会重新拉分支） */
  onOpen?: () => void
  /** `fromRemote` 非空表示「从远端分支切」 */
  onCheckout: (name: string, fromRemote?: string | null) => void
}

function BranchSwitcherView(props: BranchSwitcherViewProps) {
  const size = props.size ?? 'md'
  const tone = props.tone ?? 'toolbar'
  const locals = props.locals
  const remotes = props.remotes ?? []
  const hasAny = locals.length > 0 || remotes.length > 0

  return (
    <DropdownMenu
      onOpenChange={function (open) {
        if (open) props.onOpen?.()
      }}>
      <DropdownMenuTrigger
        disabled={props.isBusy || props.isCheckoutBusy || !hasAny}
        render={
          <Button
            type="button"
            variant={tone === 'header' ? 'ghost' : 'outline'}
            size="sm"
            title="切换分支"
            aria-label={`当前分支 ${props.branch || '未知'}，点击切换`}
            className={branchSwitcherButtonClass(size, tone, props.className)}
          />
        }>
        <BranchSwitcherTrigger
          size={size}
          tone={tone}
          branch={props.branch}
          isBusy={Boolean(props.isBusy)}
          showRemoteDelta
          ahead={props.ahead}
          behind={props.behind}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        className="max-h-72 w-auto min-w-52 max-w-72 overflow-y-auto p-1">
        <BranchSwitcherMenu
          branch={props.branch}
          locals={locals}
          remotes={remotes}
          isCheckoutBusy={Boolean(props.isCheckoutBusy)}
          onCheckout={props.onCheckout}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { BranchSwitcherView }
export type { BranchSwitcherViewProps }
