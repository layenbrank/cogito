import { describe, expect, it } from 'vitest'

import { collectText } from './graph'

describe('collectText', function () {
  it('只拼 text 段的 text 字段', function () {
    expect(
      collectText([
        { type: 'text', text: '你好' },
        { type: 'image' },
        { type: 'text', text: '，世界' }
      ])
    ).toBe('你好，世界')
  })

  it('没有 text 段时返回空串（不抛）', function () {
    expect(collectText([])).toBe('')
    expect(collectText([{ type: 'text' }])).toBe('')
  })
})
