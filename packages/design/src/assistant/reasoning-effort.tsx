/**
 * 思考强度选择器（对齐 assistant-ui `reasoning-effort` 的 anatomy，用本仓库 token 重写）。
 *
 * 结构：
 * ```
 * <div data-slot="reasoning-effort">
 *   <div>「思考强度」+ 已用 / 预算</div>
 *   <div data-slot="reasoning-effort-track">{每档一个按钮，aria-pressed}</div>
 *   <span role="progressbar">{已用 / 预算 百分比}</span>
 * </div>
 * ```
 *
 * 与官方实现的差异：
 * - token 换成本仓库的字号与表面 token（仓库禁止任意 px 字号）；
 * - 文案中文化，并允许 `label` 覆盖；
 * - 轨道不再用 `FIELD_SHELL`：那片壳的底色就是 `bg-background`，和选中胶囊撞色，
 *   选中项在浅色主题里等于没选中。这里只用「浅一档的底」（不描边：描边会把整块读成一个输入框），
 *   选中胶囊才是轨道上唯一亮起来的那一格（见 `TRACK_CLASS` / `PILL_ON`）。
 */
import { cn } from 'cn'

/** 轨道：只靠「比卡片浅一档的底」给选中胶囊留对比，不描边 —— 一描边整块就像个输入框 */
const TRACK_CLASS = 'bg-foreground/[0.04] dark:bg-foreground/[0.06] flex gap-0.5 rounded-full p-0.5'
/** 选中胶囊：卡片同色（浅色下是白）抬起一格 + 轻阴影；深色下再亮半档 */
const PILL_ON = 'bg-background text-foreground shadow-xs dark:bg-foreground/15'
/** 未选中：只有文字色，悬停才靠近前景色 */
const PILL_OFF = 'text-muted-foreground hover:text-foreground/70'

interface EffortLevel {
  key: string
  label: string
  /** 一句话说清这一档的取舍，给标题下方那行小字（可选） */
  hint?: string
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
  /**
   * 一行补充说明（可选）：例如「本模型实际下发 high」。
   * 放在胶囊下面，因为它解释的是「你选的这一档到模型那儿变成了什么」。
   */
  note?: string
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
  const {
    levels,
    selectedKey,
    spent,
    onSelect,
    label = '思考强度',
    note,
    className,
    ...rest
  } = props
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
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">{label}</span>
          {selected?.hint ? (
            <span className="text-muted-foreground text-xs leading-snug">{selected.hint}</span>
          ) : null}
        </span>
        <span
          className="text-muted-foreground font-mono text-xs tabular-nums"
          title="本轮思考已用 / 该档单轮参考预算">
          {formatCount(spent)} / {formatCount(budget)}
        </span>
      </div>

      <div
        data-slot="reasoning-effort-track"
        className={TRACK_CLASS}>
        {levels.map(function (level) {
          const active = level.key === selectedKey
          const pill = cn(
            'flex-1 rounded-full px-2 py-1 text-xs font-medium transition-[background-color,color,box-shadow] duration-150 motion-reduce:transition-none',
            active ? PILL_ON : PILL_OFF,
            onSelect && !active && 'hover:text-foreground',
            !onSelect && 'cursor-default'
          )
          if (!onSelect) {
            return (
              <span
                key={level.key}
                data-slot="reasoning-effort-level"
                data-active={active ? 'true' : 'false'}
                aria-current={active ? 'true' : undefined}
                title={level.hint}
                className={pill}>
                {level.label}
              </span>
            )
          }
          return (
            <button
              key={level.key}
              type="button"
              data-slot="reasoning-effort-level"
              data-active={active ? 'true' : 'false'}
              aria-pressed={active}
              title={level.hint}
              onClick={function () {
                onSelect(level.key)
              }}
              className={cn(
                pill,
                'outline-hidden focus-visible:ring-foreground/20 focus-visible:ring-1 active:scale-[0.98]'
              )}>
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
        className="bg-foreground/[0.06] h-[3px] w-full overflow-hidden rounded-full">
        <span
          className="bg-primary motion-reduce:transition-none block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${used}%` }}
        />
      </span>

      {note ? (
        <p
          data-slot="reasoning-effort-note"
          className="text-muted-foreground/80 text-xs leading-snug">
          {note}
        </p>
      ) : null}
    </div>
  )
}

export { ReasoningEffort, PILL_OFF, PILL_ON, TRACK_CLASS }
export type { EffortLevel, ReasoningEffortProps }
