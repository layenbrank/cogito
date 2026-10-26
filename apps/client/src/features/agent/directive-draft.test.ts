import { describe, expect, it } from 'vitest'

import { extractCandidates, parseDirectiveDraft } from '@/features/agent/directive-draft'

const VALID = {
  name: '日报汇总',
  description: '汇总当天剪贴板',
  inputs: [{ name: 'date', description: '日期', required: false }],
  steps: [{ id: 'read-clipboard', action: 'clipboard.get', params: { format: 'text' } }]
}

describe('指令草稿解析', function () {
  it('从 ```json 围栏里解析', function () {
    const text = `已按你的要求编排：\n\n\`\`\`json\n${JSON.stringify(VALID, null, 2)}\n\`\`\`\n\n保存后可在指令库运行。`
    const parsed = parseDirectiveDraft(text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.definition.name).toBe('日报汇总')
  })

  it('允许外面再包一层 definition', function () {
    const text = `\`\`\`json\n${JSON.stringify({ definition: VALID })}\n\`\`\``
    const parsed = parseDirectiveDraft(text)
    expect(parsed.ok).toBe(true)
  })

  it('整段就是 JSON 也能解析', function () {
    expect(parseDirectiveDraft(JSON.stringify(VALID)).ok).toBe(true)
  })

  it('普通说明里的 JSON 不当草稿', function () {
    const parsed = parseDirectiveDraft('这里有个配置：{"limit": 3}')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.reason).toContain('name')
  })

  it('形状不对时报出具体字段', function () {
    const parsed = parseDirectiveDraft(
      `\`\`\`json\n${JSON.stringify({ name: 1, steps: 'x' })}\n\`\`\``
    )
    expect(parsed.ok).toBe(false)
  })

  it('多个围栏时取第一个合法草稿', function () {
    const text = [
      '```json',
      '{"note":"说明"}',
      '```',
      '```json',
      JSON.stringify(VALID),
      '```'
    ].join('\n')
    const parsed = parseDirectiveDraft(text)
    expect(parsed.ok).toBe(true)
  })

  it('extractCandidates 同时支持裸 JSON 与围栏', function () {
    expect(extractCandidates('```json\n{"a":1}\n```')).toHaveLength(1)
    expect(extractCandidates('{"a":1}')).toHaveLength(1)
    expect(extractCandidates('没有 JSON')).toHaveLength(0)
  })
})
