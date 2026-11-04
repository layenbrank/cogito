import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_MAX_RETRIES, ErrorBoundary } from '@/components/fallback/ErrorBoundary'

/** 上报走网络，测试里全部拦下来（隔离边界本身的行为） */
const reportUnknown = vi.hoisted(() => vi.fn())
vi.mock('@/utils/exception-report.ts', function () {
  return { reportUnknown }
})

/** 可控的抛错组件：`shouldThrow` 切到 false 就能「恢复」 */
function makeBoom() {
  let shouldThrow = true
  function Boom(): null {
    if (shouldThrow) throw new Error('boom')
    return null
  }
  return {
    Boom,
    recover: () => {
      shouldThrow = false
    }
  }
}

beforeEach(function () {
  reportUnknown.mockClear()
  // React 会把被接住的错误再打一遍 console.error，静音以免刷屏
  vi.spyOn(console, 'error').mockImplementation(function () {
    /* 静音 */
  })
})

afterEach(function () {
  vi.restoreAllMocks()
})

describe('ErrorBoundary', function () {
  it('子树抛错时渲染兜底页并上报一次（带 boundaryId）', function () {
    const { Boom } = makeBoom()

    render(
      <ErrorBoundary
        boundaryId="tile:clock"
        title="这块内容加载失败">
        <Boom />
      </ErrorBoundary>
    )

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('这块内容加载失败')).toBeTruthy()
    expect(reportUnknown).toHaveBeenCalledTimes(1)
    const context = reportUnknown.mock.calls[0]?.[1] as { boundaryId?: string; kind?: string }
    expect(context.kind).toBe('ErrorBoundary')
    expect(context.boundaryId).toBe('tile:clock')
  })

  it('点「重试」后子树恢复则回到正常内容', function () {
    const { Boom, recover } = makeBoom()

    render(
      <ErrorBoundary boundaryId="tile:clock">
        <Boom />
      </ErrorBoundary>
    )
    expect(screen.getByRole('alert')).toBeTruthy()

    recover()
    fireEvent.click(screen.getByText('重试'))

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('重试到上限后退化为「刷新 / 回到首页」，不再提供重试', function () {
    const { Boom } = makeBoom()

    render(
      <ErrorBoundary boundaryId="root">
        <Boom />
      </ErrorBoundary>
    )

    for (let attempt = 0; attempt < DEFAULT_MAX_RETRIES; attempt += 1) {
      fireEvent.click(screen.getByText('重试'))
    }

    expect(screen.queryByText('重试')).toBeNull()
    expect(screen.getByText('刷新页面')).toBeTruthy()
    expect(screen.getByText('回到首页')).toBeTruthy()
    expect(screen.getByText('多次重试仍未恢复，请刷新页面或回到首页。')).toBeTruthy()
  })

  it('compact 只渲染一行提示 + 重试，不出现「回到首页」', function () {
    const { Boom } = makeBoom()

    render(
      <ErrorBoundary
        boundaryId="tile:knowledge"
        compact
        title="磁贴加载失败">
        <Boom />
      </ErrorBoundary>
    )

    expect(screen.getByText('磁贴加载失败')).toBeTruthy()
    expect(screen.getByText('重试')).toBeTruthy()
    expect(screen.queryByText('回到首页')).toBeNull()
  })

  it('resetKeys 变化时自动解除兜底态', function () {
    const { Boom, recover } = makeBoom()

    const { rerender } = render(
      <ErrorBoundary
        boundaryId="route:clock"
        resetKeys={['clock', 'a']}>
        <Boom />
      </ErrorBoundary>
    )
    expect(screen.getByRole('alert')).toBeTruthy()

    recover()
    rerender(
      <ErrorBoundary
        boundaryId="route:clock"
        resetKeys={['clock', 'b']}>
        <Boom />
      </ErrorBoundary>
    )

    expect(screen.queryByRole('alert')).toBeNull()
  })
})
