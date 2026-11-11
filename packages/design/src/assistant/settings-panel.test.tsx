import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AssistantLabelsProvider } from './labels'
import { clampTemperature, SettingsPanel, type SettingToggle } from './settings-panel'

const MODELS = ['Opus', 'Sonnet', 'Haiku'] as const

const TOGGLES: SettingToggle[] = [
  { key: 'tools', label: 'Tool use', detail: 'Let the model call your tools', on: true },
  { key: 'memory', label: 'Memory', detail: 'Remember facts between threads', on: false }
]

function findTextareaTag(html: string): string {
  const match = html.match(/<textarea[^>]*>/)
  return match ? match[0] : ''
}

function markup(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <SettingsPanel
      model="Sonnet"
      models={MODELS}
      systemPrompt="You are a careful engineering assistant."
      temperature={0.7}
      toggles={TOGGLES}
      {...props}
    />
  )
}

describe('SettingsPanel', function () {
  it('四段按 模型 / 提示词 / 温度 / 开关 排，根上有元素标记', function () {
    const html = markup({
      onModelChange: function () {},
      onSystemPromptChange: function () {},
      onTemperatureChange: function () {},
      onToggle: function () {}
    })
    expect(html).toContain('data-slot="settings-panel"')
    const order = [
      'data-slot="settings-panel-models"',
      'data-slot="settings-panel-prompt"',
      'data-slot="settings-panel-temperature"',
      'data-slot="settings-panel-toggles"'
    ]
    let last = -1
    for (const marker of order) {
      const at = html.indexOf(marker)
      expect(at).toBeGreaterThan(last)
      last = at
    }
  })

  it('模型行：给了回调就是 aria-pressed 按钮，当前那个是 true', function () {
    const html = markup({ onModelChange: function () {} })
    expect(html).toContain('aria-pressed="true"')
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2)
    expect(html).toContain('>Sonnet</button>')
  })

  it('模型行：没给回调就退成标签，一个按钮都没有', function () {
    const html = markup()
    expect(html).toContain('data-slot="settings-panel-model"')
    expect(html).not.toContain('aria-pressed')
    expect(html).not.toContain('<button')
  })

  it('提示词：值是传入的，没回调时只读（不是藏起来）', function () {
    const readonly = markup()
    expect(readonly).toContain('You are a careful engineering assistant.')
    // 小标题同时是文本域的无障碍名：同一句只维护一份
    expect(readonly).toContain('aria-label="system prompt"')
    // React 19 的 SSR 输出保留 readOnly 的驼峰写法
    expect(findTextareaTag(readonly)).toContain('readOnly')

    const editable = markup({ onSystemPromptChange: function () {} })
    expect(findTextareaTag(editable)).not.toContain('readOnly')
  })

  it('温度：钳进 0…2、印一位小数，滑杆口径与元素页一致', function () {
    expect(markup()).toContain('>0.7</span>')
    expect(markup({ temperature: Number.NaN })).toContain('>0.0</span>')
    expect(markup({ temperature: 3.4 })).toContain('>2.0</span>')
    expect(markup({ temperature: -1 })).toContain('>0.0</span>')
    expect(clampTemperature(-1)).toBe(0)
    expect(clampTemperature(Number.NaN)).toBe(0)

    const html = markup()
    expect(html).toContain('type="range"')
    expect(html).toContain('min="0"')
    expect(html).toContain('max="2"')
    expect(html).toContain('step="0.1"')
  })

  it('温度：没给回调时滑杆禁用', function () {
    expect(markup()).toContain('disabled=""')
    expect(markup({ onTemperatureChange: function () {} })).not.toContain('disabled=""')
  })

  it('开关行：给了回调是真 switch（aria-checked），没给就是指示灯', function () {
    const interactive = markup({ onToggle: function () {} })
    expect(interactive.match(/role="switch"/g)).toHaveLength(2)
    expect(interactive).toContain('aria-checked="true"')
    expect(interactive).toContain('aria-label="Tool use"')
    expect(interactive).toContain('translate-x-4')
    expect(interactive).not.toContain('data-slot="settings-panel-indicator"')

    const readonly = markup()
    expect(readonly).not.toContain('role="switch"')
    expect(readonly.match(/data-slot="settings-panel-indicator"/g)).toHaveLength(2)
  })

  it('空 models / 空 toggles：段还在，里面什么都没有（不留占位文案）', function () {
    const html = markup({ models: [], toggles: [], onModelChange: function () {} })
    expect(html).toContain('data-slot="settings-panel-models"')
    expect(html).toContain('data-slot="settings-panel-toggles"')
    expect(html).not.toContain('data-slot="settings-panel-model"')
    expect(html).not.toContain('data-slot="settings-panel-toggle"')
  })

  it('className 落在根上，其余 div 属性照传', function () {
    const html = markup({ className: 'max-w-xs', id: 'assistant-settings' })
    const start = html.indexOf('<div data-slot="settings-panel"')
    const rootTag = html.slice(start, html.indexOf('>', start))
    expect(rootTag).toContain('max-w-xs')
    expect(html).toContain('id="assistant-settings"')
  })

  it('文案走 labels：注入中文后英文小标题不再出现', function () {
    const html = renderToStaticMarkup(
      <AssistantLabelsProvider
        labels={{
          settingsModel: '模型',
          settingsSystemPrompt: '系统提示词',
          settingsTemperature: '温度'
        }}>
        <SettingsPanel
          model="Sonnet"
          models={MODELS}
          systemPrompt="提示"
          temperature={0.7}
          toggles={TOGGLES}
        />
      </AssistantLabelsProvider>
    )
    expect(html).toContain('>模型</span>')
    expect(html).toContain('>系统提示词</span>')
    expect(html).toContain('>温度</span>')
    expect(html).toContain('aria-label="温度"')
    expect(html).not.toContain('>temperature</span>')
  })
})
