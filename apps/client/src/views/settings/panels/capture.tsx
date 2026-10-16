import { Switch } from '@i-thinking/design/components/switch'
import { useEffect, useMemo } from 'react'
import { toast } from 'sonner'

import { findCaptureUsage } from '@/features/capture/model/usage'
import { UsageMeter } from '@/features/capture/model/usage-meter'
import { DETECT_OFF, DETECT_WINDOW, useSettingsStore } from '@/stores/setting'
import { useGalleryStore } from '@/stores/gallery'
import { SettingsRow, SettingsSection } from '@/views/settings/panels/section.tsx'
import { findCaptureHistory } from '@/views/gallery/model/media'

const FIELD =
  'h-7 w-16 rounded-md border border-input bg-background px-2 text-center text-xs tabular-nums shadow-xs'

function parsePositiveInt(raw: string, fallback: number): number {
  const next = Number.parseInt(raw, 10)
  if (!Number.isFinite(next) || next < 0) return fallback
  return next
}

function CompactNumber(props: {
  value: number
  ariaLabel: string
  onCommit: (raw: string) => void
  suffix?: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        className={FIELD}
        type="text"
        inputMode="numeric"
        defaultValue={String(props.value)}
        key={`${props.ariaLabel}-${props.value}`}
        aria-label={props.ariaLabel}
        onBlur={function (event) {
          if (event.target.value === String(props.value)) return
          props.onCommit(event.target.value)
        }}
        onKeyDown={function (event) {
          if (event.key !== 'Enter') return
          ;(event.target as HTMLInputElement).blur()
        }}
      />
      {props.suffix ? (
        <span className="text-xs text-muted-foreground">{props.suffix}</span>
      ) : null}
    </div>
  )
}

function CapturePanel() {
  const capture = useSettingsStore(function (state) {
    return state.settings.capture
  })
  const toUpdate = useSettingsStore(function (state) {
    return state.toUpdate
  })
  const medias = useGalleryStore(function (state) {
    return state.medias
  })
  const toReadMedias = useGalleryStore(function (state) {
    return state.toReadMedias
  })

  useEffect(function () {
    void toReadMedias({ skipHydrate: true })
  }, [toReadMedias])

  const usage = useMemo(
    function () {
      return findCaptureUsage(findCaptureHistory(medias))
    },
    [medias]
  )

  async function onDetectChange(checked: boolean) {
    try {
      await toUpdate('capture', { detect: checked ? DETECT_WINDOW : DETECT_OFF })
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      toast.error(`窗口检测设置失败：${text}`)
    }
  }

  async function onRetentionEnabled(checked: boolean) {
    try {
      await toUpdate('capture', { isRetentionEnabled: checked })
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      toast.error(`自动清理设置失败：${text}`)
    }
  }

  async function onPolicyChange(
    kind: 'screenshot' | 'recording',
    field: 'days' | 'count' | 'maxBytes',
    raw: string,
    unit: 'raw' | 'mb' | 'gb' = 'raw'
  ) {
    const current = capture.retention[kind]
    let nextValue = current[field]
    if (field === 'maxBytes') {
      const amount = parsePositiveInt(
        raw,
        unit === 'gb'
          ? Math.round(current.maxBytes / (1024 * 1024 * 1024))
          : Math.round(current.maxBytes / (1024 * 1024))
      )
      nextValue =
        unit === 'gb' ? amount * 1024 * 1024 * 1024 : amount * 1024 * 1024
    } else {
      nextValue = parsePositiveInt(raw, current[field])
    }
    try {
      await toUpdate('capture', {
        retention: {
          ...capture.retention,
          [kind]: { ...current, [field]: nextValue }
        }
      })
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      toast.error(`保留策略保存失败：${text}`)
    }
  }

  const screenshot = capture.retention.screenshot
  const recording = capture.retention.recording
  const screenshotMb = Math.round(screenshot.maxBytes / (1024 * 1024))
  const recordingGb = Math.round(recording.maxBytes / (1024 * 1024 * 1024))

  return (
    <div className="flex max-w-full flex-col gap-3 text-sm">
      <SettingsSection title="截屏检测">
        <SettingsRow
          label="窗口检测"
          hint="截图时悬停高亮窗口，单击吸附为选区；关闭后仅自由框选">
          <Switch
            checked={capture.detect === DETECT_WINDOW}
            onCheckedChange={function (checked) {
              void onDetectChange(checked)
            }}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="自动清理">
        <SettingsRow
          label="启用清理"
          hint="按天数、数量与容量自动清理未标记保存的捕获">
          <Switch
            checked={capture.isRetentionEnabled}
            onCheckedChange={function (checked) {
              void onRetentionEnabled(checked)
            }}
          />
        </SettingsRow>
        <div className="grid gap-2 py-1 sm:grid-cols-2">
          <UsageMeter
            label="截屏占用"
            used={usage.screenshot.bytes}
            max={screenshot.maxBytes}
            count={usage.screenshot.count}
            maxCount={screenshot.count}
            unitLabel="张"
          />
          <UsageMeter
            label="录屏占用"
            used={usage.recording.bytes}
            max={recording.maxBytes}
            count={usage.recording.count}
            maxCount={recording.count}
            unitLabel="个"
          />
        </div>
      </SettingsSection>

      <SettingsSection title="截屏保留">
        <SettingsRow
          label="天数"
          hint={`保留最近 ${screenshot.days} 天`}>
          <CompactNumber
            value={screenshot.days}
            ariaLabel="截屏保留天数"
            onCommit={function (raw) {
              void onPolicyChange('screenshot', 'days', raw)
            }}
          />
        </SettingsRow>
        <SettingsRow
          label="数量"
          hint={`最多保留 ${screenshot.count} 张`}>
          <CompactNumber
            value={screenshot.count}
            ariaLabel="截屏保留数量"
            onCommit={function (raw) {
              void onPolicyChange('screenshot', 'count', raw)
            }}
          />
        </SettingsRow>
        <SettingsRow
          label="容量"
          hint={`最多占用 ${screenshotMb} MB`}>
          <CompactNumber
            value={screenshotMb}
            ariaLabel="截屏保留容量（MB）"
            suffix="MB"
            onCommit={function (raw) {
              void onPolicyChange('screenshot', 'maxBytes', raw, 'mb')
            }}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="录屏保留">
        <SettingsRow
          label="天数"
          hint={`保留最近 ${recording.days} 天`}>
          <CompactNumber
            value={recording.days}
            ariaLabel="录屏保留天数"
            onCommit={function (raw) {
              void onPolicyChange('recording', 'days', raw)
            }}
          />
        </SettingsRow>
        <SettingsRow
          label="数量"
          hint={`最多保留 ${recording.count} 个`}>
          <CompactNumber
            value={recording.count}
            ariaLabel="录屏保留数量"
            onCommit={function (raw) {
              void onPolicyChange('recording', 'count', raw)
            }}
          />
        </SettingsRow>
        <SettingsRow
          label="容量"
          hint={`最多占用 ${recordingGb} GB`}>
          <CompactNumber
            value={recordingGb}
            ariaLabel="录屏保留容量（GB）"
            suffix="GB"
            onCommit={function (raw) {
              void onPolicyChange('recording', 'maxBytes', raw, 'gb')
            }}
          />
        </SettingsRow>
      </SettingsSection>
    </div>
  )
}

export default CapturePanel
