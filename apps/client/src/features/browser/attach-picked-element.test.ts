import { describe, expect, it } from 'vitest'

import { buildPickedBlock } from '@/features/browser/attach-picked-element'
import type { PickedBrowserElement } from '@/features/browser/api'

describe('buildPickedBlock', function () {
  it('embeds browser chip and selector for app_browser_act', function () {
    const picked: PickedBrowserElement = {
      label: 'browser-2',
      url: 'https://example.com/x',
      tag: 'button',
      selector: 'main > button:nth-child(1)',
      text: '提交',
      outerHtml: '<button type="submit">提交</button>',
      rect: { x: 0, y: 0, width: 80, height: 32 }
    }
    const block = buildPickedBlock(picked)
    expect(block).toContain(':browser[')
    expect(block).toContain('browser-2')
    expect(block).toContain('selector: main > button:nth-child(1)')
    expect(block).toContain('<button')
    expect(block).toContain('提交')
  })
})
