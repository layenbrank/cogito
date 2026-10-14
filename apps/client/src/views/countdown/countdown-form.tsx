import { Input } from '@i-thinking/design/components/input'
import { cn } from 'cn'

import type { CountdownSnapshot } from '@/features/magnetic-tiles/countdown/compute'
import styles from '@/views/countdown/countdown.module.scss'

const WEEKDAY_OPTIONS = [
  { label: '一', value: 1 },
  { label: '二', value: 2 },
  { label: '三', value: 3 },
  { label: '四', value: 4 },
  { label: '五', value: 5 },
  { label: '六', value: 6 },
  { label: '日', value: 7 }
]

interface LocalConfig {
  workStart: string
  workEnd: string
  workDays: string
  monthlySalary: number
  payDay: number
}

interface CountdownFormProps {
  localConfig: LocalConfig
  localWorkDays: number[]
  localShift: CountdownSnapshot
  live: CountdownSnapshot
  paydayText: string
  onUpdateLocal: (updater: (config: LocalConfig) => LocalConfig) => void
  onToggleWorkDay: (day: number) => void
}

function CountdownForm(props: CountdownFormProps) {
  const { localConfig, localWorkDays, localShift, live } = props

  return (
    <div className={cn('mt-pane-form', styles.formCard)}>
      <div className={styles.form}>
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>班次</h3>
          {!localShift.isValidShift ? (
            <p className={styles.warn}>下班时间须晚于上班时间</p>
          ) : null}
          <div className={styles.grid}>
            <label className={styles.field}>
              <span className="mt-field-label">上班</span>
              <Input
                type="time"
                value={localConfig.workStart}
                aria-invalid={!localShift.isValidShift || undefined}
                onChange={function (event) {
                  const value = event.target.value
                  if (!value) return
                  props.onUpdateLocal(function (config) {
                    return { ...config, workStart: value }
                  })
                }}
              />
            </label>
            <label className={styles.field}>
              <span className="mt-field-label">下班</span>
              <Input
                type="time"
                value={localConfig.workEnd}
                aria-invalid={!localShift.isValidShift || undefined}
                onChange={function (event) {
                  const value = event.target.value
                  if (!value) return
                  props.onUpdateLocal(function (config) {
                    return { ...config, workEnd: value }
                  })
                }}
              />
            </label>
          </div>
          <div className="mt-day-block mb-0.5">
            <span className="mt-day-label font-medium">工作日</span>
            <div
              className="mt-day-chips"
              role="group"
              aria-label="工作日">
              {WEEKDAY_OPTIONS.map(function (opt) {
                const isOn = localWorkDays.includes(opt.value)
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className="mt-day-chip"
                    aria-pressed={isOn}
                    onClick={function () {
                      props.onToggleWorkDay(opt.value)
                    }}>
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>薪酬</h3>
          <div className={styles.grid}>
            <label className={styles.field}>
              <span className="mt-field-label">月薪</span>
              <div className="flex items-center gap-1">
                <span className="shrink-0 text-xs text-muted-foreground">¥</span>
                <Input
                  type="number"
                  min={0}
                  step={100}
                  value={localConfig.monthlySalary || ''}
                  onChange={function (event) {
                    const value = Number(event.target.value)
                    props.onUpdateLocal(function (config) {
                      return { ...config, monthlySalary: Number.isFinite(value) ? value : 0 }
                    })
                  }}
                />
              </div>
            </label>
            <label className={styles.field}>
              <span className="mt-field-label">发薪日</span>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={1}
                  max={31}
                  step={1}
                  value={localConfig.payDay}
                  onChange={function (event) {
                    const value = Number(event.target.value)
                    props.onUpdateLocal(function (config) {
                      return {
                        ...config,
                        payDay: Number.isFinite(value) && value > 0 ? value : 1
                      }
                    })
                  }}
                />
                <span className="shrink-0 text-xs text-muted-foreground">日</span>
              </div>
            </label>
          </div>
          <p className={styles.hint}>
            {localConfig.monthlySalary > 0
              ? `按当前班次估算日薪约 ¥${live.dailySalary.toFixed(2)}，${props.paydayText}`
              : '填写月薪后，磁贴将显示今日已赚与发薪倒计时'}
          </p>
        </div>
      </div>
    </div>
  )
}

export { CountdownForm }
export type { CountdownFormProps, LocalConfig }
