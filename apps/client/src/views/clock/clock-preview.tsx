import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'
import type { Dayjs } from 'dayjs'

import type { NextFire } from '@/features/magnetic-tiles/clock/alarm-time'
import { AnalogClock } from '@/features/magnetic-tiles/clock/faces/analog/analog-clock.tsx'
import { DigitalClock } from '@/features/magnetic-tiles/clock/faces/digital/digital-clock.tsx'
import { MinimalClock } from '@/features/magnetic-tiles/clock/faces/minimal/minimal-clock.tsx'
import { FlipClock } from '@/features/magnetic-tiles/clock/flip-digit.tsx'
import type { ClockStyle } from '@/stores/clock'
import styles from '@/views/clock/clock.module.scss'

interface ClockPreviewProps {
  now: Dayjs
  clockStyle: ClockStyle
  styleLabel: string
  heroTime: string
  nextFire: NextFire | null
  clockRemindersCount: number
  enabledTotal: number
}

function StageAnalog(props: { now: Dayjs }) {
  return (
    <div
      className={styles.stageFaceWrap}
      aria-hidden>
      <AnalogClock
        now={props.now}
        className={styles.stageFace}
      />
    </div>
  )
}

function StageDigits(props: { now: Dayjs; clockStyle: ClockStyle }) {
  const showSeconds = props.clockStyle !== 'minimal'
  const h = props.now.format('HH')
  const m = props.now.format('mm')
  const s = props.now.format('ss')
  const tick = props.now.second()

  if (props.clockStyle === 'flip') {
    return (
      <FlipClock
        hours={h}
        minutes={m}
        seconds={s}
        showSeconds={showSeconds}
        useDots
        className={styles.stageFlip}
      />
    )
  }

  if (props.clockStyle === 'minimal') {
    return (
      <div className={styles.stageDigits}>
        <MinimalClock
          h={h}
          m={m}
          s={s}
          showSeconds={showSeconds}
          isNeon={false}
        />
      </div>
    )
  }

  return (
    <div className={styles.stageDigits}>
      <DigitalClock
        h={h}
        m={m}
        s={s}
        showSeconds={showSeconds}
        tick={tick}
        isNeon={props.clockStyle === 'neon'}
      />
    </div>
  )
}

function ClockPreview(props: ClockPreviewProps) {
  return (
    <div className={clsx(styles.preview, styles[props.clockStyle])}>
      <div className={styles.previewHero}>
        <div className={styles.previewMetric}>
          <span className={styles.previewLabel}>现在</span>
          <span className={styles.previewTime}>{props.heroTime}</span>
        </div>
        <div className={styles.previewMetric}>
          <span className={styles.previewLabel}>日期</span>
          <span className={styles.previewDate}>{props.now.format('M月D日 dddd')}</span>
        </div>
      </div>

      <div
        className={clsx(styles.previewStage, styles[props.clockStyle])}
        aria-live="polite"
        aria-label={`预览 ${props.styleLabel}`}>
        {props.clockStyle === 'analog' ? (
          <StageAnalog now={props.now} />
        ) : (
          <StageDigits
            now={props.now}
            clockStyle={props.clockStyle}
          />
        )}
      </div>

      <div className={styles.previewFacts}>
        <div className={styles.fact}>
          <span className={styles.factLabel}>下一条</span>
          <span className={styles.factValue}>
            {props.nextFire
              ? `${props.nextFire.reminder.fireTime} ${props.nextFire.reminder.title || '闹钟'}`
              : props.clockRemindersCount === 0
                ? '添加闹钟'
                : '暂无'}
          </span>
        </div>
        <div className={styles.fact}>
          <span className={styles.factLabel}>已开启</span>
          <span className={styles.factValue}>
            {props.enabledTotal} / {props.clockRemindersCount}
          </span>
        </div>
      </div>

      <div className={styles.previewBottom}>
        <span className={styles.previewStatus}>
          <Icon
            icon="mdi:alarm"
            width={14}
            height={14}
          />
          {props.styleLabel}
        </span>
        <span className={styles.previewRange}>{props.now.format('M月D日 ddd')}</span>
      </div>
    </div>
  )
}

export { ClockPreview }
export type { ClockPreviewProps }
