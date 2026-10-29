import { Button } from '@cogito/design/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Switch } from '@cogito/design/components/switch'
import { useState } from 'react'
import { toast } from 'sonner'

import { ConfirmAction } from '@/views/settings/surfaces/confirm-action.tsx'
import {
  SURFACE_STACK,
  SettingsRow,
  SettingsSection
} from '@/views/settings/surfaces/section.tsx'
import { useSettingsStore } from '@/stores/setting'
import { exitApp } from '@/utils/process'
import { checkUpdate } from '@/utils/updater'

const LANGUAGE_OPTIONS = [{ label: '简体中文', value: 'zh-CN' }]

function GeneralSurface() {
  const general = useSettingsStore(function (state) {
    return state.settings.general
  })
  const toUpdate = useSettingsStore(function (state) {
    return state.toUpdate
  })
  const [checking, setChecking] = useState(false)
  const [exiting, setExiting] = useState(false)

  async function onAutostartChange(checked: boolean) {
    try {
      await toUpdate('general', { autostart: checked })
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      toast.error(`开机自启设置失败：${text}`)
    }
  }

  async function onCheckUpdate() {
    setChecking(true)
    try {
      await checkUpdate()
    } finally {
      setChecking(false)
    }
  }

  async function onExit() {
    setExiting(true)
    try {
      await exitApp(0)
    } catch (error) {
      setExiting(false)
      const text = error instanceof Error ? error.message : String(error)
      toast.error(`退出失败：${text}`)
    }
  }

  return (
    <div className={SURFACE_STACK}>
      <SettingsSection title="系统行为">
        <SettingsRow
          label="开机自启"
          hint="开启后登录系统将自动启动，并以托盘形式运行">
          <Switch
            checked={general.autostart}
            onCheckedChange={function (checked) {
              void onAutostartChange(checked)
            }}
          />
        </SettingsRow>

        <SettingsRow
          label="界面语言"
          hint="多语言即将支持">
          <Select
            items={LANGUAGE_OPTIONS}
            value={general.language}
            disabled>
            <SelectTrigger
              className="w-40"
              aria-label="界面语言">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGE_OPTIONS.map(function (option) {
                return (
                  <SelectItem
                    key={option.value}
                    value={option.value}>
                    {option.label}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="应用">
        <div className="flex flex-wrap items-center gap-2 py-1">
          <Button
            variant="outline"
            disabled={checking}
            onClick={function () {
              void onCheckUpdate()
            }}>
            检查更新
          </Button>
          <ConfirmAction
            label="退出应用"
            title="退出应用"
            description="确定要完全退出 cogito 吗？（不会保留在托盘）"
            confirmLabel="退出"
            isPending={exiting}
            onConfirm={onExit}
          />
        </div>
      </SettingsSection>
    </div>
  )
}

export default GeneralSurface
