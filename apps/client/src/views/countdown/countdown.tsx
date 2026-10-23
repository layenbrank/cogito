import { Button } from '@cogito/design/components/button'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Decorations } from '@/components/decorations/index.ts'
import { leaveTileSession } from '@/features/magnetic-tile/session'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import {
  computeCountdown,
  parseWorkDays,
  STATUS_LABELS
} from '@/features/magnetic-tiles/countdown/compute'
import { useClockStore } from '@/stores/clock'
import { CountdownForm, type LocalConfig } from './countdown-form'
import { CountdownPreview } from './countdown-preview'

function closeWindow() {
  leaveTileSession()
}

function Countdown() {
  const { config, initialize, updateConfig } = useClockStore()
  const [now, onUpdateNow] = useState(function () {
    return dayjs()
  })
  const [saving, onUpdateSaving] = useState(false)

  /** 表单草稿：未编辑时为 null，直接跟随 store（避免在 effect 里同步 state） */
  const [draft, updateDraft] = useState<LocalConfig | null>(null)
  const localConfig: LocalConfig = draft ?? config

  function onUpdateLocal(updater: (value: LocalConfig) => LocalConfig) {
    updateDraft(function (current) {
      return updater(current ?? config)
    })
  }

  useEffect(
    function () {
      void initialize()
    },
    [initialize]
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
      <div className="mt-stage-split">
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
