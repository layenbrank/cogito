// @vitest-environment jsdom
/**
 * Tab 补全的接线：`onComplete` 存在时走它（面板不关），没有时退回 `onSelect`。
 *
 * 只测 provider 状态机，不碰 contentEditable —— 真正的文本替换由 `apply` 编辑请求表达，
 * 断言落在「发出去的 edit」上即可。
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { ComposerTriggerProvider, useComposerTrigger } from './composer-trigger'
import type {
  ComposerEditRequest,
  ComposerTrigger,
  ComposerTriggerApi,
  ComposerTriggerHandle,
  ComposerTriggerItem
} from './composer-trigger'

let handle: ComposerTriggerHandle | null = null
let root: Root | null = null
let container: HTMLDivElement | null = null

function Probe() {
  handle = useComposerTrigger()
  return createElement('div')
}

/** provider 里的 resolve 走 setTimeout（空 query 也是 0ms）+ promise，等两拍 */
async function settle() {
  await act(async function () {
    await new Promise(function (resolve) {
      setTimeout(resolve, 30)
    })
  })
  await act(async function () {
    await new Promise(function (resolve) {
      setTimeout(resolve, 0)
    })
  })
}

async function mount(trigger: ComposerTrigger) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const element = createElement(ComposerTriggerProvider, {
    triggers: [trigger],
    children: createElement(Probe)
  })
  await act(async function () {
    root?.render(element as ReactElement)
  })
}

/** 输入 `@` 并把候选项加载出来（等价于用户敲下 @ 的那一刻） */
async function openPicker() {
  await act(async function () {
    handle?.sync('@', 1)
  })
  await settle()
}

function buildTrigger(input: {
  onSelect: (item: ComposerTriggerItem, api: ComposerTriggerApi) => void
  onComplete?: (item: ComposerTriggerItem, api: ComposerTriggerApi) => void
}): ComposerTrigger {
  return {
    id: 'mention',
    token: '@',
    resolve: async function () {
      return [{ id: 'file:apps/client', label: 'client' }]
    },
    onSelect: input.onSelect,
    onComplete: input.onComplete
  }
}

beforeAll(function () {
  // React 19 要求显式声明测试环境支持 act（否则每次 setState 都刷一条 warning）
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(function () {
  act(function () {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  handle = null
})

describe('ComposerTriggerHandle.complete', function () {
  it('有 onComplete 时走补全，并把 complete 编辑交给输入区，面板不关', async function () {
    const onSelect = vi.fn()
    const onComplete = vi.fn(function (_item: ComposerTriggerItem, api: ComposerTriggerApi) {
      api.complete('@apps/client/')
    })
    const edits: ComposerEditRequest[] = []

    await mount(buildTrigger({ onSelect, onComplete }))
    handle?.attachApply(function (edit) {
      edits.push(edit)
    })
    await openPicker()
    expect(handle?.items).toHaveLength(1)

    await act(async function () {
      handle?.complete()
    })
    await settle()

    expect(onSelect).not.toHaveBeenCalled()
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(edits[0]).toMatchObject({
      kind: 'text',
      start: 0,
      end: 1,
      text: '@apps/client/',
      complete: true
    })
    expect(handle?.match).not.toBeNull()
  })

  it('没有 onComplete 时 Tab 退回确认语义：onSelect + 关面板', async function () {
    const onSelect = vi.fn(function (_item: ComposerTriggerItem, api: ComposerTriggerApi) {
      api.insertChip({ type: 'file', label: 'apps/client', id: 'apps/client' })
    })

    await mount(buildTrigger({ onSelect }))
    handle?.attachApply(vi.fn())
    await openPicker()

    await act(async function () {
      handle?.complete()
    })
    await settle()

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(handle?.match).toBeNull()
  })

  it('普通确认（pick）仍然是一次性落 chip 并关面板', async function () {
    const onSelect = vi.fn()
    const edits: ComposerEditRequest[] = []

    await mount(buildTrigger({ onSelect }))
    handle?.attachApply(function (edit) {
      edits.push(edit)
    })
    await openPicker()

    await act(async function () {
      handle?.pick()
    })
    await settle()

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(handle?.match).toBeNull()
    expect(edits).toHaveLength(0)
  })
})
