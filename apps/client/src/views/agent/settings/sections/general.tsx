import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { Switch } from '@i-thinking/design/components/switch'

import { useSettingsStore } from '@/stores/setting'

/** Agent 设置 · 常规（本机偏好） */
function GeneralSection() {
  const general = useSettingsStore(function (state) {
    return state.settings.general
  })
  const update = useSettingsStore(function (state) {
    return state.toUpdate
  })

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">常规</h2>
        <p className="text-muted-foreground text-sm">语言与开机启动等本机偏好。</p>
      </header>

      <div className="border-border divide-border flex flex-col divide-y rounded-xl border">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">语言</p>
            <p className="text-muted-foreground text-xs">界面显示语言</p>
          </div>
          <Select
            value={general.language}
            onValueChange={function (value) {
              if (!value) return
              void update('general', { language: value })
            }}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh-CN">简体中文</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">开机自启</p>
            <p className="text-muted-foreground text-xs">登录系统后自动启动应用</p>
          </div>
          <Switch
            checked={general.autostart}
            onCheckedChange={function (checked) {
              void update('general', { autostart: checked })
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">外观</p>
            <p className="text-muted-foreground text-xs">主题与缩放暂跟随系统，后续开放</p>
          </div>
          <span className="text-muted-foreground text-xs">跟随系统</span>
        </div>
      </div>
    </div>
  )
}

export { GeneralSection }
