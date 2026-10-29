import type { CaptureRegion } from '@/features/capture/region'

/**
 * 元素级悬停探测的调度器。
 *
 * 为什么要调度：一次探测要「让浮层临时穿透 → 跨进程问 UIA → 复原」，
 * 跟着 mousemove（60~144Hz）跑会把鼠标事件吃掉，肉眼就是卡顿。
 * 策略是**停住才查**：
 * - 移动过程中完全不打扰，窗口级候选由本地几何直接给出（实时跟手）
 * - 停住 `settleMs` 后补一次元素级，细化到控件
 * - 两次探测至少隔 `intervalMs`，避免走走停停时疯狂穿透
 * - 查询期间又有新点会再补一次（收敛），不会停在旧坐标
 */
interface ProbePoint {
  x: number
  y: number
}

interface HoverProbeInput {
  probe: (x: number, y: number) => Promise<CaptureRegion[]>
  onResult: (chain: CaptureRegion[]) => void
  /** 光标停住多久才探测 */
  settleMs?: number
  /** 两次探测的最小间隔 */
  intervalMs?: number
  /** 时钟（单测注入） */
  now?: () => number
}

interface HoverProbe {
  request(point: ProbePoint): void
  cancel(): void
  dispose(): void
}

const SETTLE_MS = 80
const INTERVAL_MS = 180

/** 结果签名：只有「最细元素」变了才回调，避免同样的链反复触发重渲染 */
function signatureOf(chain: CaptureRegion[]): string {
  const head = chain[0]
  if (!head) return ''
  return `${chain.length}:${head.x},${head.y},${head.w},${head.h}`
}

function makeHoverProbe(input: HoverProbeInput): HoverProbe {
  const settleMs = input.settleMs ?? SETTLE_MS
  const intervalMs = input.intervalMs ?? INTERVAL_MS
  const now = input.now ?? (() => performance.now())

  let pending: ProbePoint | null = null
  let timer: number | undefined
  let lastAt = Number.NEGATIVE_INFINITY
  let isRunning = false
  let signature = ''
  let isDisposed = false

  function clearTimer() {
    if (timer === undefined) return
    window.clearTimeout(timer)
    timer = undefined
  }

  function arm(delay: number) {
    clearTimer()
    timer = window.setTimeout(function () {
      timer = undefined
      void run()
    }, Math.max(0, delay))
  }

  async function run() {
    if (isDisposed || isRunning) return
    const point = pending
    if (!point) return
    pending = null
    isRunning = true
    lastAt = now()
    try {
      const chain = await input.probe(point.x, point.y)
      if (isDisposed) return
      const next = signatureOf(chain)
      if (next !== signature) {
        signature = next
        input.onResult(chain)
      }
    } catch (error) {
      // 探测失败由上层降级为窗口级候选；这里只留痕，不打断调度
      console.debug('[capture] 元素探测失败', error)
    } finally {
      isRunning = false
      if (pending && !isDisposed) {
        arm(intervalMs - (now() - lastAt))
      }
    }
  }

  function request(point: ProbePoint) {
    if (isDisposed) return
    pending = { x: point.x, y: point.y }
    if (isRunning) return
    // 停住 settleMs，且距上次探测不超过 intervalMs 的节奏
    const sinceLast = now() - lastAt
    arm(Math.max(settleMs, intervalMs - sinceLast))
  }

  function cancel() {
    pending = null
    clearTimer()
  }

  return {
    request,
    cancel,
    dispose() {
      isDisposed = true
      pending = null
      clearTimer()
    }
  }
}

export { makeHoverProbe }
export type { HoverProbe, HoverProbeInput, ProbePoint }
