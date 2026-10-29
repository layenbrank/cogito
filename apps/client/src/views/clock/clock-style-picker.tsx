import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'

import type { ClockStyle } from '@/stores/clock'
import styles from '@/views/clock/clock.module.scss'

import { STYLES } from './clock-style-constants.ts'

interface ClockStylePickerProps {
  clockStyle: ClockStyle
  onChange: (style: ClockStyle) => void
}

function ClockStylePicker(props: ClockStylePickerProps) {
  return (
    <div className={styles.sectionAppearance}>
      <h3 className="mt-section-title">外观</h3>
      <div
        className={styles.styleList}
        role="radiogroup"
        aria-label="时钟样式">
        {STYLES.map(function (item) {
          const isActive = props.clockStyle === item.value
          return (
            <Button
              key={item.value}
              type="button"
              variant="ghost"
              role="radio"
              aria-checked={isActive}
              className={clsx(styles.styleRow, isActive && styles.styleRowActive)}
              onClick={function () {
                props.onChange(item.value)
              }}>
              <div className={styles.styleMeta}>
                <span className={styles.styleLabel}>{item.label}</span>
                <span className={styles.styleHint}>{item.hint}</span>
              </div>
              <span className={clsx(styles.mini, styles[item.value])}>
                {item.value === 'analog' ? (
                  <span className={styles.miniFace} />
                ) : (
                  <span className={styles.miniTime}>12:00</span>
                )}
              </span>
              <span className={clsx(styles.accent, isActive ? 'bg-primary' : 'bg-primary/35')} />
            </Button>
          )
        })}
      </div>
    </div>
  )
}

export { ClockStylePicker }
export type { ClockStylePickerProps }
