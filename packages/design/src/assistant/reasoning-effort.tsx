/**
 * 思考强度选择器（对齐 assistant-ui `reasoning-effort` 的 anatomy，用本仓库 token 重写）。
 *
 * 结构：
 * ```
 * <div data-slot="reasoning-effort">
 *   <div>「思考强度」+ 已用 / 预算</div>
 *   <div>{每档一个按钮，aria-pressed}</div>
 *   <span role="progressbar">{已用 / 预算 百分比}</span>
 * </div>
 * ```
 *
 * 与官方实现的差异：
 * - token 换成本仓库的 `FIELD_SHELL` / `text-sm` / `bg-primary`（仓库禁止任意 px 字号）；
 * - 文案中文化，并允许 `label` 覆盖。
 */
import { FIELD_SHELL } from '@cogito/design/lib/surface'
import { cn } from 'cn'

interface EffortLevel {
  key: string
  label: string
  /** 该档的 token 预算；没有精确预算时给个相对量级即可 */
  budget: number
}

interface ReasoningEffortProps extends Omit<React.ComponentProps<'div'>, 'onSelect'> {
  levels: readonly EffortLevel[]
  selectedKey: string
  /** 本次运行已消耗的推理 token */
  spent: number
  onSelect?: (key: string) => void
  label?: string
}

function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  return Math.round(value).toLocaleString('en-US')
}

/** spent 占该档预算的百分比，夹在 0…100；预算为 0 时收在 0 */
function usedPercent(spent: number, budget: number): number {
  if (budget <= 0) return 0
  const percent = (spent / budget) * 100
  if (!Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, percent))
}

function ReasoningEffort(props: ReasoningEffortProps) {
  const { levels, selectedKey, spent, onSelect, label = '思考强度', className, ...rest } = props
  const selected = levels.find(function (level) {
    return level.key === selectedKey
  })
  const budget = selected?.budget ?? 0
  const used = usedPercent(spent, budget)

  return (
    <div
      data-slot="reasoning-effort"
      className={cn('flex w-full flex-col gap-2', className)}
      {...rest}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {formatCount(spent)} / {formatCount(budget)}
        </span>
      </div>

      <div className={cn(FIELD_SHELL, 'flex gap-0.5 rounded-full p-0.5')}>
        {levels.map(function (level) {
          const active = level.key === selectedKey
          const pill = cn(
            'flex-1 rounded-full px-2 py-1 text-xs font-medium transition-colors',
            active ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground',
            onSelect && !active && 'hover:text-foreground',
            !onSelect && 'cursor-default'
          )
          if (!onSelect) {
            return (
              <span
                key={level.key}
                aria-current={active ? 'true' : undefined}
                className={pill}>
                {level.label}
              </span>
            )
          }
          return (
            <button
              key={level.key}
              type="button"
              aria-pressed={active}
              onClick={function () {
                onSelect(level.key)
              }}
              className={cn(pill, 'active:bg-accent-active')}>
              {level.label}
            </button>
          )
        })}
      </div>

      <span
        role="progressbar"
        aria-label="思考预算使用情况"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(used)}
        aria-valuetext={`${formatCount(spent)} / ${formatCount(budget)}`}
        className="bg-foreground/[0.06] inset-ring-border h-[3px] w-full overflow-hidden rounded-full">
        <span
          className="bg-primary motion-reduce:transition-none block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${used}%` }}
        />
      </span>
    </div>
  )
}

export { ReasoningEffort }
export type { EffortLevel, ReasoningEffortProps }
