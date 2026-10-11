import { Button } from '@i-thinking/design/components/button'
import { getCurrentWindow } from '@tauri-apps/api/window'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Decorations } from '@/components/decorations/index.ts'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import {
  computeCountdown,
  parseWorkDays,
  STATUS_LABELS
} from '@/features/magnetic-tiles/countdown/compute'
import { useClockStore } from '@/stores/clock'
import styles from '@/views/countdown/countdown.module.scss'
import { CountdownForm, type LocalConfig } from './countdown-form'
import { CountdownPreview } from './countdown-preview'

function closeWindow() {
  void getCurrentWindow().close()
}

function Countdown() {
  const { config, loaded, initialize, updateConfig } = useClockStore()
  const [now, onUpdateNow] = useState(function () {
    return dayjs()
  })
  const [saving, onUpdateSaving] = useState(false)

  const [localConfig, onUpdateLocal] = useState<LocalConfig>({
    workStart: config.workStart,
    workEnd: config.workEnd,
    workDays: config.workDays,
    monthlySalary: config.monthlySalary,
    payDay: config.payDay
  })

  useEffect(
    function () {
      void initialize()
    },
    [initialize]
  )

  useEffect(
    function () {
      if (!loaded) return
      onUpdateLocal({
        workStart: config.workStart,
        workEnd: config.workEnd,
        workDays: config.workDays,
        monthlySalary: config.monthlySalary,
        payDay: config.payDay
      })
    },
    [loaded, config]
  )

  useEffect(function () {
    const timer = setInterval(function () {
      onUpdateNow(dayjs())
    }, 1000)
    return function () {
      clearInterval(timer)
    }
  }, [])

  const localWorkDays = useMemo(
    function () {
      return parseWorkDays(localConfig.workDays)
    },
    [localConfig.workDays]
  )

  const localShift = useMemo(
    function () {
      return computeCountdown(
        now,
        localConfig.workStart,
        localConfig.workEnd,
        localWorkDays,
        localConfig.monthlySalary,
        localConfig.payDay
      )
    },
    [now, localConfig, localWorkDays]
  )

  async function handleSave() {
    if (!localShift.isValidShift) {
      toast.error('下班时间必须晚于上班时间')
      return
    }
    onUpdateSaving(true)
    try {
      await updateConfig(localConfig)
      toast.success('已保存')
      closeWindow()
    } catch {
      toast.error('保存失败')
    } finally {
      onUpdateSaving(false)
    }
  }

  const live = localShift
  const progressPct = Math.round(Math.max(live.progress, live.status === 'after' ? 100 : 0))
  const footerStatus =
    live.status === 'working'
      ? '工作中'
      : live.status === 'before'
        ? '未开始'
        : STATUS_LABELS[live.status]
  const workRange = `${localConfig.workStart} – ${localConfig.workEnd}`
  const paydayText = live.isPayday
    ? '今天发薪'
    : live.paydayDate
      ? `${live.daysUntilPayday} 天后`
      : '—'

  function toggleWorkDay(day: number) {
    const next = localWorkDays.includes(day)
      ? localWorkDays.filter(function (d) {
          return d !== day
        })
      : [...localWorkDays, day].sort(function (a, b) {
          return a - b
        })
    onUpdateLocal(function (config) {
      return { ...config, workDays: JSON.stringify(next) }
    })
  }

  return (
    <Decorations
      summary={findComponentLabel('countdown')}
      scrollable={false}
      section={
        <>
          <Button onClick={closeWindow}>取消</Button>
          <Button
            disabled={saving}
            onClick={function () {
              void handleSave()
            }}>
            保存
          </Button>
        </>
      }>
      <div className={styles.stage}>
        <CountdownPreview
          live={live}
          now={now}
          workRange={workRange}
          monthlySalary={localConfig.monthlySalary}
          paydayText={paydayText}
          footerStatus={footerStatus}
          progressPct={progressPct}
        />
        <CountdownForm
          localConfig={localConfig}
          localWorkDays={localWorkDays}
          localShift={localShift}
          live={live}
          paydayText={paydayText}
          onUpdateLocal={onUpdateLocal}
          onToggleWorkDay={toggleWorkDay}
        />
      </div>
    </Decorations>
  )
}

export default Countdown
