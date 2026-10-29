import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'
import { cn } from 'cn'
import { useState } from 'react'
import { toast } from 'sonner'

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

function AppearanceSurface() {
  const [appearance, updateAppearance] = useState<Appearance>(readAppearance)

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

        <SettingsRow
          label="界面动效"
          hint="仅影响本应用；不改系统辅助功能。系统已减少动画时可选手动开启。">
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
