import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef, type RefObject } from 'react'
import { CHANNELS } from '@/shared/ipc/channels'

const HIT_SELECTOR = "[data-region='false']"

type ThroughRect = { x: number; y: number; w: number; h: number }

interface ThroughOptions {
  rootRef: RefObject<HTMLElement | null>
  enabled?: boolean
}

/**
 * 合并窗口（ms，对齐 VS Code 的 `IOverlayUpdater` throttle）。
 *
 * 为什么不再「每帧每磁贴一次 IPC」：MutationObserver + ResizeObserver 在 hover
 * 磁贴上能连续触发几十次，一次 invoke 就是一次跨进程序列化；主线程被占住时
 * 上报还会断档，宿主保留旧穿透区 → skipbar 露出实心条、透明窗丢 DWM 阴影。
 */
const FLUSH_DELAY_MS = 200

/** 所有登记中的来源：`null` 表示「已停用，待清空一次」 */
const sources = new Map<string, HTMLElement | null>()
/** 上次成功上报的指纹，用于深比较去重 */
const published = new Map<string, string>()

let flushTimer = 0

function parseRect(el: Element): ThroughRect | null {
  const box = el.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return null
  return {
    x: Math.round(box.left),
    y: Math.round(box.top),
    w: Math.round(box.width),
    h: Math.round(box.height)
  }
}

function findHitRects(root: HTMLElement): ThroughRect[] {
  const rects: ThroughRect[] = []
  const seen = new Set<Element>()

  function push(el: Element) {
    if (seen.has(el)) return
    seen.add(el)
    const rect = parseRect(el)
    if (rect) rects.push(rect)
  }

  if (root.matches(HIT_SELECTOR)) push(root)
  const nodes = root.querySelectorAll(HIT_SELECTOR)
  for (const node of nodes) push(node)

  return rects
}

/** 指纹：rects 深比较的唯一依据（字段顺序固定，只由 parseRect 生成） */
function rectsKey(rects: readonly ThroughRect[]): string {
  return JSON.stringify(rects)
}

/**
 * 挑出「和上次上报不一样」的来源。纯函数，便于单测。
 */
function diffThroughPayload(
  previous: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, readonly ThroughRect[]>
): { source: string; rects: readonly ThroughRect[] }[] {
  const changed: { source: string; rects: readonly ThroughRect[] }[] = []
  for (const [source, rects] of next) {
    if (previous.get(source) === rectsKey(rects)) continue
    changed.push({ source, rects })
  }
  return changed
}

function report(source: string, rects: readonly ThroughRect[]): void {
  void invoke(CHANNELS.THROUGH.UPDATE_RECTS, { source, rects }).catch(function (error: unknown) {
    console.debug('[through] 更新穿透区失败:', error)
    // 失败不写指纹：下一次 flush 会重试
    published.delete(source)
  })
}

function flush(): void {
  flushTimer = 0
  if (sources.size === 0) return

  const payload = new Map<string, ThroughRect[]>()
  const detached: string[] = []
  for (const [source, root] of sources) {
    if (root && root.isConnected) {
      payload.set(source, findHitRects(root))
      continue
    }
    // 已卸载/未连接：上报一次空数组让宿主收回穿透区，然后彻底忘掉这个来源
    payload.set(source, [])
    detached.push(source)
  }

  const changed = diffThroughPayload(published, payload)
  for (const item of changed) {
    published.set(item.source, rectsKey(item.rects))
    report(item.source, item.rects)
  }
  for (const source of detached) {
    sources.delete(source)
    if (payload.get(source)?.length === 0) published.delete(source)
  }
}

/** 200ms 内的多次触发合并成一次 flush（也合并多个来源） */
function scheduleFlush(): void {
  if (flushTimer !== 0) return
  flushTimer = window.setTimeout(flush, FLUSH_DELAY_MS)
}

/**
 * 登记一个穿透来源。返回注销函数（注销后会上报一次空数组）。
 */
function attachThroughSource(source: string, root: HTMLElement): () => void {
  sources.set(source, root)
  scheduleFlush()
  return function detach() {
    if (sources.get(source) !== root) return
    sources.set(source, null)
    scheduleFlush()
  }
}

/** 停用一个来源（`enabled=false` 时用），下一次 flush 上报空数组 */
function detachThroughSource(source: string): void {
  if (!sources.has(source)) return
  sources.set(source, null)
  scheduleFlush()
}

/** 测试/热重载用：清空收集器与指纹（不动 DOM、不发 IPC） */
function resetThroughCollector(): void {
  if (flushTimer !== 0) {
    window.clearTimeout(flushTimer)
    flushTimer = 0
  }
  sources.clear()
  published.clear()
}

/**
 * Report hit-rects of `[data-region='false']` under root to the overlay through worker.
 * `enabled=false` clears the source (e.g. pin click-through).
 */
function useThrough(source: string, options: ThroughOptions) {
  const { rootRef, enabled = true } = options
  const sourceRef = useRef(source)

  useEffect(
    function () {
      sourceRef.current = source
    },
    [source]
  )

  useEffect(
    function () {
      if (!enabled) {
        detachThroughSource(source)
        return
      }

      const root = rootRef.current
      if (!root) return

      const detach = attachThroughSource(source, root)

      const ro = new ResizeObserver(scheduleFlush)
      ro.observe(root)

      const mo = new MutationObserver(scheduleFlush)
      mo.observe(root, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ['style', 'class', 'data-region']
      })

      return function () {
        ro.disconnect()
        mo.disconnect()
        detach()
      }
    },
    [enabled, rootRef, source]
  )
}

export type { ThroughOptions, ThroughRect }
export {
  FLUSH_DELAY_MS,
  HIT_SELECTOR,
  attachThroughSource,
  detachThroughSource,
  diffThroughPayload,
  findHitRects,
  flush,
  rectsKey,
  resetThroughCollector,
  scheduleFlush,
  useThrough
}
