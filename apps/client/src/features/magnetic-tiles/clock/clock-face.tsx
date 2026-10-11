import type { Dayjs } from 'dayjs'

import { AnalogClock } from '@/features/magnetic-tiles/clock/faces/analog/analog-clock.tsx'
import { DigitalClock } from '@/features/magnetic-tiles/clock/faces/digital/digital-clock.tsx'
import { MinimalClock } from '@/features/magnetic-tiles/clock/faces/minimal/minimal-clock.tsx'
import { FlipClock } from '@/features/magnetic-tiles/clock/flip-digit.tsx'
import styles from '@/features/magnetic-tiles/clock/marker.module.scss'

interface ClockFaceProps {
  clockStyle: string
  now: Dayjs
  hours: string
  minutes: string
  seconds: string
  showSeconds: boolean
  useFlipDots: boolean
}

function ClockFace(props: ClockFaceProps) {
  const isFlip = props.clockStyle === 'flip'
  const isMinimal = props.clockStyle === 'minimal'
  const isNeon = props.clockStyle === 'neon'

  return (
    <div className={styles.stage}>
      {props.clockStyle === 'analog' ? <AnalogClock now={props.now} /> : null}
      {isFlip ? (
        <FlipClock
          hours={props.hours}
          minutes={props.minutes}
          seconds={props.seconds}
          showSeconds={props.showSeconds}
          useDots={props.useFlipDots}
          className={styles.flipStage}
        />
      ) : null}
      {isMinimal ? (
        <MinimalClock
          h={props.hours}
          m={props.minutes}
          s={props.seconds}
          showSeconds={props.showSeconds}
        />
      ) : null}
      {props.clockStyle === 'digital' || isNeon ? (
        <DigitalClock
          h={props.hours}
          m={props.minutes}
          s={props.seconds}
          showSeconds={props.showSeconds}
          tick={props.now.second()}
          isNeon={isNeon}
        />
      ) : null}
    </div>
  )
}

export { ClockFace }
