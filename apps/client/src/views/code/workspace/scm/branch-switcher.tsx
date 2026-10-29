/**
 * Git 分支切换：下拉列出本地分支，选中后 checkout 并刷新 SCM / 提交列表。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { cn } from 'cn'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { useCodeGitStore, type GitOutcome } from '@/stores/code-git'

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

  if (!isRepo) return null

  const list = branches.length > 0 ? branches : branch ? [branch] : []
  const isBusy = isBranchesLoading || isCheckoutBusy
  const isCompact = size === 'sm'
  const isHeader = tone === 'header'

  return (
    <DropdownMenu
      onOpenChange={function (open) {
        if (open) void useCodeGitStore.getState().toLoadBranches()
      }}>
      <DropdownMenuTrigger
        disabled={isBusy || list.length === 0}
        render={
          <Button
            type="button"
            variant={isHeader ? 'ghost' : 'outline'}
            size="sm"
            title="切换分支"
            aria-label={`当前分支 ${branch || '未知'}，点击切换`}
            className={cn(
              'min-w-0 justify-start gap-1.5 font-normal shadow-none',
              isCompact ? 'h-7 px-2 text-xs' : 'h-9 px-2.5 text-sm',
              isHeader
                ? 'text-foreground hover:bg-muted/70 max-w-full flex-1 rounded-sm border-0 bg-transparent'
                : 'border-border/50 bg-muted/30 text-foreground hover:bg-muted/60 max-w-56 rounded-md',
              props.className
            )}
          />
        }>
        <Icon
          icon={isBusy ? 'lucide:loader-circle' : 'lucide:git-branch'}
          className={cn(
            'text-muted-foreground shrink-0',
            isCompact ? 'size-3.5' : 'size-4',
            isBusy && 'animate-spin'
          )}
        />
        <span className="min-w-0 flex-1 truncate text-left font-medium">
          {branch || '未知分支'}
        </span>
        {showRemoteDelta && (ahead > 0 || behind > 0) ? (
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {ahead > 0 ? `↑${ahead}` : ''}
            {ahead > 0 && behind > 0 ? ' ' : ''}
            {behind > 0 ? `↓${behind}` : ''}
          </span>
        ) : null}
        <Icon
          icon="lucide:chevrons-up-down"
          className="text-muted-foreground size-3.5 shrink-0 opacity-55"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        // 默认 w-(--anchor-width) 会把长分支名截成短胶囊宽；改为随内容加宽
        className="max-h-72 w-auto min-w-52 max-w-72 overflow-y-auto p-1">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-muted-foreground px-2 py-1.5 text-xs font-semibold tracking-wide uppercase">
            本地分支
            {list.length > 0 ? (
              <span className="ml-1.5 font-normal tabular-nums normal-case tracking-normal">
                {list.length}
              </span>
            ) : null}
          </DropdownMenuLabel>
          {list.map(function (name) {
            const isActive = name === branch
            return (
              <DropdownMenuItem
                key={name}
                title={name}
                className={cn(
                  'gap-2 rounded-sm px-2 py-2 text-sm',
                  isActive && 'bg-accent text-accent-foreground'
                )}
                disabled={isCheckoutBusy}
                onClick={function () {
                  if (isActive) return
                  void useCodeGitStore
                    .getState()
                    .toCheckoutBranch(name)
                    .then(report)
                }}>
                <Icon
                  icon="lucide:check"
                  className={cn(
                    'size-4 shrink-0',
                    isActive ? 'text-primary opacity-100' : 'opacity-0'
                  )}
                />
                <Icon
                  icon="lucide:git-branch"
                  className="text-muted-foreground size-4 shrink-0 opacity-70"
                />
                <span className="min-w-0 flex-1 truncate font-mono text-sm leading-5">
                  {name}
                </span>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { BranchSwitcher }
