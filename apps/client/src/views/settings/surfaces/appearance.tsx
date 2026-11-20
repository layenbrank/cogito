import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'
import { cn } from 'cn'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { ensurePersist, findPref, patchPref } from '@/features/persist'
import {
  SURFACE_STACK,
  SettingsRow,
  SettingsSection
} from '@/views/settings/surfaces/section.tsx'
import {
  APPEARANCE_MODES,
  MOTION_PRESETS,
  PRIMARY_PRESETS,
  RADIUS_PRESETS,
  readAppearance,
  resetAppearance,
  writeAppearance,
  type Appearance,
  type AppearanceMode,
  type MotionPreference
} from '@/features/window/appearance'

const MODE_ICONS: Record<AppearanceMode, string> = {
  light: 'lucide:sun',
  dark: 'lucide:moon',
  system: 'lucide:monitor'
}

const MOTION_ICONS: Record<MotionPreference, string> = {
  system: 'lucide:monitor',
  on: 'lucide:sparkles',
  off: 'lucide:circle-pause'
}

const TOGGLE_ITEM = 'cursor-pointer px-3 data-[pressed]:bg-primary/10 data-[pressed]:text-primary'

const ISLAND_TOGGLES = [
  { value: 'on', label: '开启' },
  { value: 'off', label: '关闭' }
] as const

type IslandToggle = (typeof ISLAND_TOGGLES)[number]['value']

function islandToggle(isEnabled: boolean): IslandToggle {
  return isEnabled ? 'on' : 'off'
}

function AppearanceSurface() {
  const [appearance, updateAppearance] = useState<Appearance>(readAppearance)
  /** 浮层搜索灵动岛：默认开，关掉就从屏上撤掉（位置偏好保留） */
  const [isIslandEnabled, setIsIslandEnabled] = useState(true)

  useEffect(function () {
    let cancelled = false
    void ensurePersist()
      .then(function () {
        if (cancelled) return
        setIsIslandEnabled(findPref('overlay').searchIsland.enabled)
      })
      .catch(function (error) {
        console.warn('[settings.appearance] 读取灵动岛开关失败', error)
      })
    return function () {
      cancelled = true
    }
  }, [])

  async function onToggleIsland(checked: boolean): Promise<void> {
    setIsIslandEnabled(checked)
    try {
      const current = findPref('overlay').searchIsland
      await patchPref('overlay', { searchIsland: { ...current, enabled: checked } })
    } catch (error) {
      setIsIslandEnabled(!checked)
      console.warn('[settings.appearance] 保存灵动岛开关失败', error)
      toast.error('保存失败')
    }
  }

  function apply(patch: Partial<Appearance>) {
    updateAppearance(writeAppearance(patch))
  }

  function onReset() {
    updateAppearance(resetAppearance())
    toast.success('已恢复默认外观')
  }

  return (
    <div className={SURFACE_STACK}>
      <SettingsSection title="基础外观">
        <SettingsRow label="外观模式">
          <ToggleGroup
            variant="outline"
            spacing={0}
            value={[appearance.mode]}
            onValueChange={function (value) {
              const next = value[0] as AppearanceMode | undefined
              if (next) apply({ mode: next })
            }}>
            {APPEARANCE_MODES.map(function (mode) {
              return (
                <ToggleGroupItem
                  key={mode.value}
                  value={mode.value}
                  className={TOGGLE_ITEM}>
                  <Icon
                    icon={MODE_ICONS[mode.value]}
                    aria-hidden
                  />
                  {mode.label}
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
        </SettingsRow>

        <SettingsRow label="品牌主色">
          {PRIMARY_PRESETS.map(function (preset) {
            const isActive = appearance.color === preset.value
            return (
              <Button
                key={preset.value}
                type="button"
                variant="ghost"
                size="icon-sm"
                title={preset.label}
                aria-label={preset.label}
                aria-pressed={isActive}
                className={cn(
                  'size-7 cursor-pointer rounded-full border border-border/60 transition-transform',
                  'hover:scale-110 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  isActive && 'ring-2 ring-ring ring-offset-2 ring-offset-card'
                )}
                style={{ backgroundColor: preset.value }}
                onClick={function () {
                  apply({ color: preset.value, foreground: preset.foreground })
                }}
              />
            )
          })}
        </SettingsRow>

        <SettingsRow label="圆角">
          <ToggleGroup
            variant="outline"
            spacing={0}
            value={[String(appearance.radius)]}
            onValueChange={function (value) {
              const next = value[0]
              if (next !== undefined) apply({ radius: Number(next) })
            }}>
            {RADIUS_PRESETS.map(function (preset) {
              return (
                <ToggleGroupItem
                  key={preset.value}
                  value={String(preset.value)}
                  className={TOGGLE_ITEM}>
                  {preset.label}
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
        </SettingsRow>

        <SettingsRow label="界面动效">
          <ToggleGroup
            variant="outline"
            spacing={0}
            value={[appearance.motion]}
            onValueChange={function (value) {
              const next = value[0] as MotionPreference | undefined
              if (next) apply({ motion: next })
            }}>
            {MOTION_PRESETS.map(function (preset) {
              return (
                <ToggleGroupItem
                  key={preset.value}
                  value={preset.value}
                  className={TOGGLE_ITEM}>
                  <Icon
                    icon={MOTION_ICONS[preset.value]}
                    aria-hidden
                  />
                  {preset.label}
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="浮层">
        <SettingsRow label="搜索灵动岛">
          <ToggleGroup
            variant="outline"
            spacing={0}
            value={[islandToggle(isIslandEnabled)]}
            onValueChange={function (value) {
              const next = value[0]
              if (next !== 'on' && next !== 'off') return
              void onToggleIsland(next === 'on')
            }}>
            {ISLAND_TOGGLES.map(function (option) {
              return (
                <ToggleGroupItem
                  key={option.value}
                  value={option.value}
                  className={TOGGLE_ITEM}>
                  {option.label}
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
        </SettingsRow>
      </SettingsSection>

      <div className="flex flex-wrap gap-2.5 pt-1">
        <Button
          variant="outline"
          onClick={onReset}>
          恢复默认
        </Button>
      </div>
    </div>
  )
}

export default AppearanceSurface
