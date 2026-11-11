/**
 * 输入区「思考强度」：与模型分开、常驻 composer。
 *
 * 这里只盯**出现条件**——不支持思考的模型整块不出现（不是禁用），
 * 支持时按钮上直接写着当前档位，省得点开菜单才知道。
 */
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ModelPrefs from '@/features/agent/model/model-prefs'

import { ComposerThinking } from './composer-thinking'

const store = vi.hoisted(function () {
  return {
    state: {
      providers: [] as Array<{ id: string; enabled: boolean; model: string }>,
      activeProviderID: 'p1'
    }
  }
})

vi.mock('@/stores/provider', function () {
  const useProviderStore = function (
    selector: (state: typeof store.state) => unknown
  ) {
    return selector(store.state)
  }
  useProviderStore.getState = function () {
    return store.state
  }
  return { useProviderStore }
})

/** 偏好读盘不走 tauri：这里统一按默认值（medium）算，只看入口出不出来 */
vi.mock('@/features/agent/model/model-prefs', async function (importOriginal) {
  const actual = await importOriginal<typeof ModelPrefs>()
  return {
    ...actual,
    readModelPrefs: function () {
      return {}
    },
    writeModelThinking: vi.fn()
  }
})

function renderWith(model: string) {
  store.state.providers = [{ id: 'p1', enabled: true, model }]
  return render(<ComposerThinking />)
}

describe('ComposerThinking', function () {
  beforeEach(function () {
    store.state.providers = []
    store.state.activeProviderID = 'p1'
  })

  it('模型不支持思考时整块不渲染', function () {
    renderWith('gpt-4o-mini')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('模型没有选定时不渲染', function () {
    renderWith('')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('支持思考时按钮直接写出当前档位', function () {
    renderWith('claude-sonnet-4-5')
    expect(screen.getByRole('button', { name: '思考强度：标准' })).toBeInTheDocument()
    expect(screen.getByText('标准')).toBeInTheDocument()
  })
})
