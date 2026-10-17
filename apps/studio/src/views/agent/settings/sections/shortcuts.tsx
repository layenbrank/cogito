import { WINDOW_SHORTCUTS, formatShortcut } from '@/features/window/shortcuts.ts'
import { SettingsSection } from '@/views/agent/settings/components/section.tsx'

/**
 * 快捷键：**只列真的实现的**。
 *
 * 窗口那几条直接读 `features/window/shortcuts.ts` 的表 —— 同一份定义既驱动键盘监听、
 * 又渲染在这里，所以不可能出现「文档写 ⌘B、代码听 ⌘K」。
 *
 * 输入区那几条不是修饰键组合，走不了那张表，另外列。
 */
const COMPOSER_KEYS = [
  { keys: 'Enter', label: '发送消息' },
  { keys: 'Shift + Enter', label: '在输入框内换行' },
  { keys: 'Esc', label: '关闭弹出的选择器 / 菜单' }
]

function ShortcutRow(props: { label: string; keys: string }) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <span className="text-sm">{props.label}</span>
      <kbd className="bg-muted text-muted-foreground shrink-0 rounded border px-1.5 py-0.5 font-mono text-xs">
        {props.keys}
      </kbd>
    </div>
  )
}

export function ShortcutsSection() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="窗口"
        hint="与 Qoder 的默认按键一致；在对话窗口里生效。">
        {WINDOW_SHORTCUTS.map(function (item) {
          return (
            <ShortcutRow
              key={item.id}
              label={item.label}
              keys={formatShortcut(item)}
            />
          )
        })}
      </SettingsSection>

      <SettingsSection
        title="输入区"
        hint="由输入框自身处理，不参与自定义。">
        {COMPOSER_KEYS.map(function (item) {
          return (
            <ShortcutRow
              key={item.keys}
              label={item.label}
              keys={item.keys}
            />
          )
        })}
      </SettingsSection>
    </div>
  )
}
