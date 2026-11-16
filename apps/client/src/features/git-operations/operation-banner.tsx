/**
 * 多步操作进行中的提示条：冲突数 + 继续 / 中止。
 *
 * 只有 rebase 有对应的 IPC（`rebase --continue/--abort`）；merge / cherry-pick
 * 目前没有命令面，所以只提示「到终端完成」，不假造按钮。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'

const OPERATION_LABEL: Record<string, string> = {
  rebase: '变基',
  merge: '合并',
  'cherry-pick': '拣选提交',
  revert: '回退提交',
  am: '应用补丁'
}

function findOperationLabel(operation: string): string {
  return OPERATION_LABEL[operation] ?? operation
}

interface OperationBannerProps {
  operation: string
  conflicted: readonly string[]
  isBusy?: boolean
  onContinue: () => void
  onAbort: () => void
}

function OperationBanner(props: OperationBannerProps) {
  const label = findOperationLabel(props.operation)
  const isRebase = props.operation === 'rebase'

  return (
    <div className="border-amber-500/30 bg-amber-500/10 flex shrink-0 items-start gap-2 border-b px-2 py-1.5 text-xs">
      <Icon
        icon="lucide:triangle-alert"
        className="mt-0.5 size-3.5 shrink-0 text-amber-500"
      />
      <div className="min-w-0 flex-1">
        <p className="text-foreground/90 truncate font-medium">
          {label}进行中
          {props.conflicted.length > 0 ? ` · ${props.conflicted.length} 个冲突文件` : ''}
        </p>
        <p className="text-muted-foreground truncate">
          {props.conflicted.length > 0
            ? props.conflicted.slice(0, 3).join('、')
            : '解决冲突后继续，或中止回到起点'}
        </p>
      </div>
      {isRebase ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            disabled={props.isBusy}
            onClick={props.onContinue}>
            继续
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive h-6 px-2 text-[11px]"
            disabled={props.isBusy}
            onClick={props.onAbort}>
            中止
          </Button>
        </div>
      ) : (
        <span className="text-muted-foreground shrink-0 text-[11px]">到终端完成</span>
      )}
    </div>
  )
}

export { OperationBanner }
