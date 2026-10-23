import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'

import { AnimatedDigits } from '@cogito/design/components/animated-digits'
import { findDecadeStart } from './calendar-math'
import type { SurfaceMode } from './types'

interface NavButtonProps {
  label: string
  icon: string
  disabled?: boolean
  onClick: () => void
}

function NavButton(props: NavButtonProps) {
  return (
    <button
      type="button"
      aria-label={props.label}
      disabled={props.disabled}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground',
        'transition-[background-color,color,transform] duration-150',
        'hover:bg-muted hover:text-foreground active:scale-95',
        'disabled:pointer-events-none disabled:opacity-40',
        'motion-reduce:active:scale-100'
      )}
      onClick={props.onClick}>
      <Icon
        icon={props.icon}
        className="size-4"
      />
    </button>
  )
}

interface SurfaceHeaderProps {
  mode: SurfaceMode
  year: number
  month: number
  slideDir?: 1 | -1
  onPrev: () => void
  onNext: () => void
  onTitleClick: () => void
}

/** 标题按段渲染：只给变化的年/月挂动效，固定文案（年/月/–）不动 */
function SurfaceHeader(props: SurfaceHeaderProps) {
  const decadeStart = findDecadeStart(props.year)
  const decadeEnd = decadeStart + 9
  const dir = props.slideDir

  const prevLabel =
    props.mode === 'year' ? '上十年' : props.mode === 'month' ? '上一年' : '上个月'
  const nextLabel =
    props.mode === 'year' ? '下十年' : props.mode === 'month' ? '下一年' : '下个月'

  return (
    <div className="flex items-center justify-between gap-1 border-b border-border/70 px-2.5 py-2">
      <NavButton
        label={prevLabel}
        icon="lucide:chevron-left"
        onClick={props.onPrev}
      />
      <button
        type="button"
        className={cn(
          'inline-flex min-w-28 items-center justify-center gap-0 rounded-md px-2 py-1 text-sm font-medium text-foreground',
          'transition-[background-color] duration-150 hover:bg-muted',
          props.mode === 'year' && 'pointer-events-none'
        )}
        onClick={props.onTitleClick}>
        {props.mode === 'year' ? (
          <>
            <AnimatedDigits
              value={decadeStart}
              slideDir={dir}>
              {decadeStart}
            </AnimatedDigits>
            <span className="px-1 text-muted-foreground">–</span>
            <AnimatedDigits
              value={decadeEnd}
              slideDir={dir}>
              {decadeEnd}
            </AnimatedDigits>
          </>
        ) : null}
        {props.mode === 'month' ? (
          <>
            <AnimatedDigits
              value={props.year}
              slideDir={dir}>
              {props.year}
            </AnimatedDigits>
            <span>年</span>
          </>
        ) : null}
        {props.mode === 'date' ? (
          <>
            <AnimatedDigits
              value={props.year}
              slideDir={dir}>
              {props.year}
            </AnimatedDigits>
            <span>年</span>
            <AnimatedDigits
              value={props.month}
              slideDir={dir}>
              {props.month}
            </AnimatedDigits>
            <span>月</span>
          </>
        ) : null}
      </button>
      <NavButton
        label={nextLabel}
        icon="lucide:chevron-right"
        onClick={props.onNext}
      />
    </div>
  )
}

export { SurfaceHeader }
