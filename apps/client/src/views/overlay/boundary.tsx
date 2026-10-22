import { Component, type ErrorInfo, type ReactNode } from 'react'

import { reportUnknown } from '@/utils/exception-report.ts'

interface OverlayBoundaryProps {
  children: ReactNode
  /** 外部状态指纹（模式 / 贴图数量…）：变化后允许重试渲染 */
  resetKey: string
  /** 出错后的恢复动作（退出截屏态 + 关掉浮层），由宿主注入 */
  onRecover: () => void
}

interface OverlayBoundaryState {
  error: Error | null
  /** 最近一次「允许重试」所用的外部指纹 */
  resetKey: string
  /** 最近一分钟内的复位时刻（频率上限用） */
  resetTimes: number[]
  /** 上次复位的时刻（冷却用） */
  lastResetAt: number
}

/** 复位冷却：避免「坏数据 → 渲染出错 → 复位 → 再出错」把窗口打满 */
const RESET_COOLDOWN_MS = 2000
/** 每分钟最多复位次数，超过就停在空态（浮层已隐藏，不会挡屏） */
const MAX_RESETS_PER_MINUTE = 5

/**
 * overlay 子树的最后一道兜底。
 *
 * 与 `Fallback.ErrorBoundary` 的区别：**不渲染任何可见内容** —— 浮层是透明置顶层，
 * 一张错误卡片会挡满整个屏幕且继续吃点击。这里只记录日志、让宿主恢复，然后渲染 null。
 */
class OverlayBoundary extends Component<OverlayBoundaryProps, OverlayBoundaryState> {
  override state: OverlayBoundaryState = {
    error: null,
    resetKey: this.props.resetKey,
    resetTimes: [],
    lastResetAt: 0
  }

  static getDerivedStateFromError(error: Error): Partial<OverlayBoundaryState> {
    return { error }
  }

  /**
   * 复位在**派生阶段**完成，不在 `componentDidUpdate` 里 setState：
   * 后者会额外渲染一次、且容易自成败环（React 明确不推荐）。冷却与频率上限一并搬进来，
   * 这样整个复位决策是纯函数（只读 props 与 state）。
   */
  static getDerivedStateFromProps(
    props: OverlayBoundaryProps,
    state: OverlayBoundaryState
  ): Partial<OverlayBoundaryState> | null {
    if (props.resetKey === state.resetKey) return null
    if (!state.error) return { resetKey: props.resetKey }

    const now = Date.now()
    const recent = state.resetTimes.filter(function (at) {
      return now - at < 60_000
    })
    const isCoolingDown = now - state.lastResetAt < RESET_COOLDOWN_MS
    if (isCoolingDown || recent.length >= MAX_RESETS_PER_MINUTE) {
      // 仍记下新指纹，避免下一帧又走一遍节流判断
      return { resetKey: props.resetKey, resetTimes: recent }
    }

    return {
      error: null,
      resetKey: props.resetKey,
      resetTimes: [...recent, now],
      lastResetAt: now
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[OverlayBoundary]', error, info.componentStack)
    reportUnknown(
      error,
      { kind: 'overlay.boundary', componentStack: info.componentStack ?? undefined },
      'fatal'
    )
    this.props.onRecover()
  }

  override render() {
    if (this.state.error) return null
    return this.props.children
  }
}

export type { OverlayBoundaryProps }
export { OverlayBoundary }
