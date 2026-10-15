import { Component, type ErrorInfo, type ReactNode } from 'react'

interface OverlayBoundaryProps {
  children: ReactNode
  /** 外部状态指纹（模式 / 贴图数量…）：变化后允许重试渲染 */
  resetKey: string
  /** 出错后的恢复动作（退出截屏态 + 关掉浮层），由宿主注入 */
  onRecover: () => void
}

interface OverlayBoundaryState {
  error: Error | null
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
  override state: OverlayBoundaryState = { error: null }

  private lastResetAt = 0
  private resetTimes: number[] = []

  static getDerivedStateFromError(error: Error): OverlayBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[OverlayBoundary]', error, info.componentStack)
    this.props.onRecover()
  }

  override componentDidUpdate(previous: OverlayBoundaryProps) {
    if (!this.state.error) return
    if (previous.resetKey === this.props.resetKey) return

    const now = Date.now()
    if (now - this.lastResetAt < RESET_COOLDOWN_MS) return
    this.resetTimes = this.resetTimes.filter(function (at) {
      return now - at < 60_000
    })
    if (this.resetTimes.length >= MAX_RESETS_PER_MINUTE) return

    this.lastResetAt = now
    this.resetTimes.push(now)
    this.setState({ error: null })
  }

  override render() {
    if (this.state.error) return null
    return this.props.children
  }
}

export type { OverlayBoundaryProps }
export { OverlayBoundary }
