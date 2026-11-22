import clsx from 'clsx'
import type dayjs from 'dayjs'
import { useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { useState } from 'react'

import { HAND } from '@/features/magnetic-tiles/clock/clock-motion.ts'
import styles from './analog.module.scss'

interface AnalogClockProps {
  now: dayjs.Dayjs
  className?: string
}

type TickGeom = {
  x1: number
  y1: number
  x2: number
  y2: number
  kind: 'min' | 'hour' | 'cardinal'
}

function findTickGeom(index: number): TickGeom {
  const rad = (index * 6 - 90) * (Math.PI / 180)
  const isHour = index % 5 === 0
  const isCardinal = index % 15 === 0
  const kind = isCardinal ? 'cardinal' : isHour ? 'hour' : 'min'
  const inner = isCardinal ? 39.2 : isHour ? 41 : 43.2
  const outer = 47.2
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    x1: 50 + inner * cos,
    y1: 50 + inner * sin,
    x2: 50 + outer * cos,
    y2: 50 + outer * sin,
    kind
  }
}

const ANALOG_TICK_GEOMS = Array.from({ length: 60 }, function (_, i) {
  return findTickGeom(i)
})

const HAND_ORIGIN = {
  transformOrigin: '50px 50px',
  transformBox: 'view-box' as const
}

export function AnalogClock(props: AnalogClockProps) {
  const isReduced = !!useReducedMotion()
  const h = props.now.hour() % 12
  const minute = props.now.minute()
  const s = props.now.second()

  /**
   * 角度 = 挂载基准角 + 真实流逝时间换算，天然单调递增（指针只顺时针走）。
   * 等价于原来的「上一帧角度存 ref 再补足 360」，但渲染期不读 ref。
   */
  const [base] = useState(function () {
    return {
      ms: props.now.valueOf(),
      hour: h * 30 + minute * 0.5,
      minute: minute * 6,
      second: s * 6
    }
  })
  const elapsedMs = Math.max(0, props.now.valueOf() - base.ms)
  const hourRotation = base.hour + (elapsedMs / 3_600_000) * 30
  const minuteRotation = base.minute + (elapsedMs / 60_000) * 6
  const secondRotation = base.second + (elapsedMs / 1_000) * 6

  return (
    <div
      className={clsx(styles.analogFace, props.className)}
      role="img"
      aria-label={props.now.format('HH:mm:ss')}>
      <svg
        className={styles.analogDial}
        viewBox="0 0 100 100"
        aria-hidden>
        <circle
          className={styles.dialPlate}
          cx="50"
          cy="50"
          r="49.2"
        />
        <circle
          className={styles.dialRim}
          cx="50"
          cy="50"
          r="48.55"
          fill="none"
        />

        {ANALOG_TICK_GEOMS.map(function (tick, i) {
          return (
            <line
              key={i}
              className={clsx(
                styles.tickLine,
                tick.kind === 'hour' && styles.tickHourLine,
                tick.kind === 'cardinal' && styles.tickCardinalLine
              )}
              x1={tick.x1}
              y1={tick.y1}
              x2={tick.x2}
              y2={tick.y2}
            />
          )
        })}

        <m.g
          animate={{ rotate: hourRotation }}
          transition={HAND.hour(isReduced)}
          style={HAND_ORIGIN}>
          <line
            className={styles.handHourLine}
            x1="50"
            y1="54"
            x2="50"
            y2="24"
          />
        </m.g>

        <m.g
          animate={{ rotate: minuteRotation }}
          transition={HAND.minute(isReduced)}
          style={HAND_ORIGIN}>
          <line
            className={styles.handMinuteLine}
            x1="50"
            y1="56"
            x2="50"
            y2="15"
          />
        </m.g>

        <m.g
          animate={{ rotate: secondRotation }}
          transition={HAND.second(isReduced)}
          style={HAND_ORIGIN}>
          <line
            className={styles.handSecondLine}
            x1="50"
            y1="62"
            x2="50"
            y2="12"
          />
        </m.g>

        <circle
          className={styles.hubOuter}
          cx="50"
          cy="50"
          r="2.8"
        />
        <circle
          className={styles.hubInner}
          cx="50"
          cy="50"
          r="1.3"
        />
      </svg>
    </div>
  )
}

