import { Icon } from '@iconify/react'

/**
 * 底部状态栏：一眼看到「库里有多少、当前筛出多少、选了几张」。
 *
 * 这三件事在旧实现里分散在工具条和选择条上，互相抢位置；
 * 状态栏把只读信息收拢，工具条只留操作。
 */
interface StatusBarProps {
  total: number
  visible: number
  selected: number
  unrated: number
  probed: number
  isImporting: boolean
  message: string | null
  /** 长任务进度：导入 / 去重等；null = 没有在跑 */
  progress?: { label: string; done: number; total: number } | null
}

function StatusBar(props: StatusBarProps) {
  const progress = props.progress ?? null
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0

  return (
    <div className="relative flex items-center gap-3 border-t border-border px-3 py-1 text-[11px] text-muted-foreground">
      {progress ? (
        <div
          className="absolute inset-x-0 top-0 h-0.5 bg-muted"
          role="progressbar"
          aria-label={progress.label}
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
        >
          <div
            className="h-full bg-primary transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}

      <span className="tabular-nums">{props.total.toLocaleString('zh-CN')} 项</span>
      {props.visible !== props.total ? (
        <span className="tabular-nums">筛后 {props.visible.toLocaleString('zh-CN')}</span>
      ) : null}
      {props.selected > 0 ? (
        <span className="tabular-nums text-foreground">已选 {props.selected}</span>
      ) : null}
      <span className="tabular-nums">待筛 {props.unrated}</span>
      {props.probed < props.total ? (
        <span className="inline-flex items-center gap-1 text-amber-600">
          <Icon icon="lucide:loader" className="size-3 animate-spin" />
          已探测 {props.probed}/{props.total}
        </span>
      ) : null}
      {progress ? (
        <span className="inline-flex items-center gap-1 tabular-nums text-primary">
          <Icon icon="lucide:loader" className="size-3 animate-spin" />
          {progress.label} {progress.done.toLocaleString('zh-CN')}/
          {progress.total.toLocaleString('zh-CN')}
        </span>
      ) : props.isImporting ? (
        <span className="inline-flex items-center gap-1 text-primary">
          <Icon icon="lucide:loader" className="size-3 animate-spin" />
          导入中…
        </span>
      ) : null}
      {props.message ? (
        <span
          className="ml-auto min-w-0 truncate text-amber-600"
          title={props.message}
        >
          {props.message}
        </span>
      ) : null}
    </div>
  )
}

export { StatusBar }
export type { StatusBarProps }
