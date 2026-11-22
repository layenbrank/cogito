import clsx from 'clsx'
import { memo, useState } from 'react'

import styles from '@/features/magnetic-tiles/clock/flip-digit.module.scss'

interface FlipDigitProps {
  current: number
  /** 该位最大数字（时十位 2、分/秒十位 5），默认 9 */
  total?: number
  className?: string
}

type FlipState = {
  shown: number
  previous: number
  isFlipping: boolean
}

function DigitHalf(props: {
  digit: number
  half: 'top' | 'bottom'
}) {
  const halfClass = props.half === 'top' ? styles.top : styles.bottom

  return (
    <div className={halfClass}>
      <span
        className={styles.shade}
        aria-hidden
      />
      <span className={styles.text}>{props.digit}</span>
    </div>
  )
}

/**
 * 企业级翻页位：预渲染 0..total，渲染期同步 previous/shown，
 * 仅切换 class 触发 CSS 动画（不挂卸 DOM、不 remount 半页）。
 */
function FlipDigitBase(props: FlipDigitProps) {
  const total = props.total ?? 9
  const [state, onUpdateState] = useState<FlipState>(function () {
    return {
      shown: props.current,
      previous: -1,
      isFlipping: false
    }
  })

  if (props.current !== state.shown) {
    onUpdateState({
      shown: props.current,
      previous: state.shown,
      isFlipping: true
    })
  }

  const digits = []
  for (let digit = 0; digit <= total; digit += 1) {
    digits.push(
      <li
        key={digit}
        className={clsx(
          styles.item,
          state.shown === digit && styles.active,
          state.previous === digit && styles.previous
        )}>
        <DigitHalf
          digit={digit}
          half="top"
        />
        <DigitHalf
          digit={digit}
          half="bottom"
        />
      </li>
    )
  }

  return (
    <div
      className={clsx(
        styles.root,
        state.isFlipping && styles.isFlipping,
        props.className
      )}
      aria-label={String(state.shown)}>
      <ul className={styles.list}>{digits}</ul>
    </div>
  )
}

const FlipDigit = memo(FlipDigitBase)

interface FlipClockProps {
  hours: string
  minutes: string
  seconds?: string
  showSeconds?: boolean
  useDots?: boolean
  className?: string
}

function FlipSeparator(props: { useDots: boolean }) {
  if (props.useDots) return <span className={styles.separator} />
  return <span className={styles.colon}>:</span>
}

function FlipClockBase(props: FlipClockProps) {
  const showSeconds = props.showSeconds ?? Boolean(props.seconds)
  const useDots = props.useDots ?? true

  return (
    <div className={clsx(styles.row, props.className)}>
      <FlipDigit
        current={Number(props.hours[0])}
        total={2}
      />
      <FlipDigit current={Number(props.hours[1])} />
      <FlipSeparator useDots={useDots} />
      <FlipDigit
        current={Number(props.minutes[0])}
        total={5}
      />
      <FlipDigit current={Number(props.minutes[1])} />
      {showSeconds && props.seconds ? (
        <>
          <FlipSeparator useDots={useDots} />
          <FlipDigit
            current={Number(props.seconds[0])}
            total={5}
          />
          <FlipDigit current={Number(props.seconds[1])} />
        </>
      ) : null}
    </div>
  )
}

const FlipClock = memo(FlipClockBase)

export { FlipClock, FlipDigit }
