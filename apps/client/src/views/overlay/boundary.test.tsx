import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { OverlayBoundary } from '@/views/overlay/boundary'

function Boom(): null {
  throw new Error('boom')
}

/** React 会把错误打到 console.error，这里静音以免刷屏 */
function muteConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(function () {
    /* 静音 */
  })
}

describe('OverlayBoundary', function () {
  it('子树出错时渲染空内容并触发恢复', function () {
    const onRecover = vi.fn()
    const spy = muteConsoleError()

    const { container } = render(
      <OverlayBoundary
        resetKey="a"
        onRecover={onRecover}>
        <Boom />
      </OverlayBoundary>
    )

    // 透明置顶层不能留下任何可见内容
    expect(container.innerHTML).toBe('')
    expect(onRecover).toHaveBeenCalledTimes(1)

    spy.mockRestore()
  })

  it('外部状态变化后复位并重试渲染', function () {
    const onRecover = vi.fn()
    const spy = muteConsoleError()

    const { container, rerender } = render(
      <OverlayBoundary
        resetKey="a"
        onRecover={onRecover}>
        <Boom />
      </OverlayBoundary>
    )
    expect(container.innerHTML).toBe('')

    rerender(
      <OverlayBoundary
        resetKey="b"
        onRecover={onRecover}>
        <span>ok</span>
      </OverlayBoundary>
    )

    expect(container.textContent).toBe('ok')
    spy.mockRestore()
  })
})
