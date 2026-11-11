/**
 * Settings panel（对齐 assistant-ui `elements/settings-panel`）
 *
 * 一张卡装四个「用户自己能拧的旋钮」：模型、系统提示词、温度、能力开关。
 * 纯受控 —— 值全是 prop，变化只走回调；**不给回调时按契约降级**：模型行换成标签、
 * 开关换成指示灯、输入框只读、滑杆禁用，而不是把整段藏起来（元素页明确说
 * textarea 与滑杆永远在）。空 `models` / 空 `toggles` 就渲染一个空段，不留占位文案。
 *
 * 两个口径（照元素页）：
 * - `temperature` 先钳进 `0…2` 再显示、再传给滑杆，`NaN` 当 `0`：坏值不许进 DOM；
 *   回调收到的是滑杆的原始值，钳制是展示层的事。
 * - 模型按钮用 `aria-pressed`（不是 radio 语义）；开关行只有给了 `onToggle` 才是真
 *   `role="switch"` + `aria-checked` 的按钮。
 */
import { cn } from 'cn'
import type { ComponentProps } from 'react'

import { field, mono, paper } from './elements/surfaces'
import { useAssistantLabels } from './labels'

/** 温度的可调范围与步长（元素页的 `min=0 max=2 step=0.1`） */
const TEMPERATURE_MIN = 0
const TEMPERATURE_MAX = 2
const TEMPERATURE_STEP = 0.1

interface SettingToggle {
  /** 回传给 `onToggle` 的标识 */
  key: string
  /** 行标题 */
  label: string
  /** 标题下面那行说明 */
  detail: string
  /** 开关位置 */
  on: boolean
}

// `onToggle` 是 React 19 的 HTML 事件属性（ToggleEvent），这里要的是 `onToggle(key)`，
// 两个签名不兼容，从继承里摘掉
interface SettingsPanelProps extends Omit<ComponentProps<'div'>, 'children' | 'onToggle'> {
  /** `models` 里的当前值 */
  model: string
  /** 分段控件里的选项 */
  models: readonly string[]
  /** 系统提示词（多行文本） */
  systemPrompt: string
  /** 温度；显示前钳进 `0…2` */
  temperature: number
  /** 滑杆下面的开关行 */
  toggles: readonly SettingToggle[]
  /** 不给就渲染成不可交互的标签 */
  onModelChange?: (model: string) => void
  /** 不给就渲染成只读文本域 */
  onSystemPromptChange?: (prompt: string) => void
  /** 不给就禁用滑杆 */
  onTemperatureChange?: (temperature: number) => void
  /** 不给就渲染成指示灯 */
  onToggle?: (key: string) => void
  className?: string
}

function clampTemperature(value: number): number {
  if (!Number.isFinite(value)) return TEMPERATURE_MIN
  return Math.min(TEMPERATURE_MAX, Math.max(TEMPERATURE_MIN, value))
}

const SECTION_CLASS = 'flex flex-col gap-1.5'
const TRACK_CLASS = cn(field, 'flex gap-0.5 rounded-full p-0.5')
const SEGMENT_CLASS =
  'flex-1 rounded-full py-1 text-xs font-medium transition-[background-color,color,scale] duration-150 motion-reduce:transition-none'
const SEGMENT_ON = 'bg-background text-foreground/90'
const SEGMENT_OFF = 'text-muted-foreground hover:text-foreground/70'
const SWITCH_CLASS =
  'flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 outline-hidden transition-colors duration-200 motion-reduce:transition-none focus-visible:ring-foreground/20 focus-visible:ring-1'
const KNOB_CLASS =
  'bg-background size-4 rounded-full transition-transform duration-200 motion-reduce:transition-none'

function SettingsPanel({
  model,
  models,
  systemPrompt,
  temperature,
  toggles,
  onModelChange,
  onSystemPromptChange,
  onTemperatureChange,
  onToggle,
  className,
  ...props
}: SettingsPanelProps) {
  const labels = useAssistantLabels()
  const clamped = clampTemperature(temperature)

  return (
    <div
      data-slot="settings-panel"
      className={cn(paper, 'flex w-full max-w-sm flex-col gap-4 rounded-[20px] p-4', className)}
      {...props}>
      <div
        data-slot="settings-panel-models"
        className={SECTION_CLASS}>
        <span className={mono}>{labels.settingsModel}</span>
        <div className={TRACK_CLASS}>
          {models.map(function (item) {
            const active = item === model
            const tone = cn(SEGMENT_CLASS, active ? SEGMENT_ON : SEGMENT_OFF)
            if (!onModelChange) {
              return (
                <span
                  key={item}
                  data-slot="settings-panel-model"
                  data-active={active ? '' : undefined}
                  className={cn(tone, 'text-center')}>
                  {item}
                </span>
              )
            }
            return (
              <button
                key={item}
                type="button"
                aria-pressed={active}
                data-slot="settings-panel-model"
                data-active={active ? '' : undefined}
                className={cn(
                  tone,
                  'active:scale-[0.97] outline-hidden focus-visible:ring-foreground/20 focus-visible:ring-1'
                )}
                onClick={function () {
                  onModelChange(item)
                }}>
                {item}
              </button>
            )
          })}
        </div>
      </div>

      <div
        data-slot="settings-panel-prompt"
        className={SECTION_CLASS}>
        <span className={mono}>{labels.settingsSystemPrompt}</span>
        <textarea
          rows={3}
          aria-label={labels.settingsSystemPrompt}
          data-slot="settings-panel-prompt-input"
          value={systemPrompt}
          readOnly={!onSystemPromptChange}
          onChange={function (event) {
            onSystemPromptChange?.(event.target.value)
          }}
          className={cn(
            field,
            'text-foreground/80 focus-visible:ring-foreground/20 resize-none rounded-xl px-3 py-2 text-xs leading-relaxed outline-none focus-visible:ring-1'
          )}
        />
      </div>

      <div
        data-slot="settings-panel-temperature"
        className={SECTION_CLASS}>
        <span className="flex items-baseline justify-between gap-2">
          <span className={mono}>{labels.settingsTemperature}</span>
          <span
            data-slot="settings-panel-temperature-value"
            className={cn(mono, 'tabular-nums')}>
            {clamped.toFixed(1)}
          </span>
        </span>
        <input
          type="range"
          min={TEMPERATURE_MIN}
          max={TEMPERATURE_MAX}
          step={TEMPERATURE_STEP}
          value={clamped}
          disabled={!onTemperatureChange}
          aria-label={labels.settingsTemperature}
          data-slot="settings-panel-temperature-input"
          onChange={function (event) {
            // 回调拿原始值：钳制只发生在展示层
            onTemperatureChange?.(Number(event.target.value))
          }}
          className="accent-foreground/80 h-1 w-full disabled:opacity-50"
        />
      </div>

      <div
        data-slot="settings-panel-toggles"
        className="flex flex-col gap-2.5">
        {toggles.map(function (item) {
          return (
            <div
              key={item.key}
              data-slot="settings-panel-toggle"
              data-state={item.on ? 'on' : 'off'}
              className="flex items-center gap-3">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{item.label}</span>
                <span className="text-muted-foreground truncate text-xs">{item.detail}</span>
              </span>
              {onToggle ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={item.on}
                  aria-label={item.label}
                  data-slot="settings-panel-switch"
                  className={cn(SWITCH_CLASS, item.on ? 'bg-foreground/80' : 'bg-foreground/15')}
                  onClick={function () {
                    onToggle(item.key)
                  }}>
                  <span
                    aria-hidden
                    className={cn(KNOB_CLASS, item.on ? 'translate-x-4' : 'translate-x-0')}
                  />
                </button>
              ) : (
                <span
                  aria-hidden
                  data-slot="settings-panel-indicator"
                  className={cn(
                    'size-2 shrink-0 rounded-full forced-color-adjust-none',
                    item.on ? 'bg-foreground/80' : 'bg-foreground/15'
                  )}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { clampTemperature, SettingsPanel, TEMPERATURE_MAX, TEMPERATURE_MIN, TEMPERATURE_STEP }
export type { SettingToggle, SettingsPanelProps }
