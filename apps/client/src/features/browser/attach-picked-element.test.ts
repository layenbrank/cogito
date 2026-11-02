import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', function () {
  return { invoke: vi.fn(async function () { return null }) }
})
vi.mock('@tauri-apps/api/event', function () {
  return { listen: vi.fn(async function () { return function () {} }) }
})

import { buildPickedBlock } from '@/features/browser/attach-picked-element'
import type { PickedBrowserElement } from '@/features/browser/api'
import { useBrowserStore } from '@/features/browser/store'

describe('buildPickedBlock', function () {
  beforeEach(function () {
    useBrowserStore.setState({
      tabs: [
        {
          label: 'browser-2',
          url: 'https://example.com/x',
          title: 'Example Domain',
          device: null
        }
      ],
      activeLabel: 'browser-2',
      deviceByLabel: { 'browser-2': null }
    })
  })

  it('embeds browser chip with page title and selector for app_browser_act', function () {
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
    expect(block).toContain(':browser[Example Domain]')
    expect(block).toContain('name=browser-2')
    expect(block).toContain('selector: main > button:nth-child(1)')
    expect(block).toContain('<button')
    expect(block).toContain('提交')
  })
})
