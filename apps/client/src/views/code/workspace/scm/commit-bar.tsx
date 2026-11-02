/**
 * 提交按钮组：主按钮提交暂存内容，右侧下拉可「提交所有更改」。
 * SCM 面板与 Agent 审阅面板共用。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'

interface CommitBarProps {
  canCommitStaged: boolean
  canCommitAll: boolean
  onCommitStaged: () => void
  onCommitAll: () => void
}

function CommitBar(props: CommitBarProps) {
  const hasChoice = props.canCommitStaged || props.canCommitAll
  return (
    <div className="flex w-full">
      <Button
        type="button"
        className="h-9 min-w-0 flex-1 rounded-none rounded-l-md text-sm"
        disabled={!props.canCommitStaged}
        title={props.canCommitStaged ? '提交暂存的更改' : '请先暂存要提交的更改'}
        onClick={props.onCommitStaged}>
        <Icon
          icon="lucide:check"
          className="size-4"
        />
        提交
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="提交选项"
          disabled={!hasChoice}
          className="bg-primary text-primary-foreground hover:bg-primary-hover flex h-9 w-9 shrink-0 items-center justify-center rounded-r-md border-l border-primary-foreground/25 outline-none disabled:pointer-events-none disabled:opacity-50">
          <Icon
            icon="lucide:chevron-down"
            className="size-4"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-44">
          <DropdownMenuItem
            className="text-sm"
            disabled={!props.canCommitStaged}
            onClick={props.onCommitStaged}>
            提交暂存的更改
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-sm"
            disabled={!props.canCommitAll}
            onClick={props.onCommitAll}>
            提交所有更改
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export { CommitBar }
export type { CommitBarProps }
