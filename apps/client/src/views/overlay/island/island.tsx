/**
 * 浮层搜索灵动岛（iOS 灵动岛式）。
 *
 * 三态：
 * - 自由态：正圆，随便放；
 * - 贴边态：吸附在屏幕边上，只露出一小截（半圆）；
 * - 展开态：横向搜索条 + 结果面板（复用 `useCommandSearch`，与 Overview 操作栏同一套）。
 *
 * 拖拽期间必须铺一层全屏 `data-region="false"` 遮罩：`through` 的 worker 每 50ms
 * 按上报矩形设置 `ignore_cursor_events`，指针一离开岛就被判成「穿透」，拖动会当场中断。
 */
import { Icon } from '@iconify/react/offline'
import { Input } from '@cogito/design/components/input'
import { useClickOutside } from '@reactuses/core'
import { listen } from '@tauri-apps/api/event'
import { cn } from 'cn'
import { useEffect, useRef, useState } from 'react'

import { ResultsSurface } from '@/features/command-bar/results'
import { useCommandSearch } from '@/features/command-bar/use-command-search.ts'
import { canUseTauriIpc } from '@/features/window/shell-mode'
import {
  ensurePersist,
  findPref,
  patchPref,
  PREF_CHANGED,
  reloadPref
} from '@/features/persist'
import type { SearchIslandEdge, SearchIslandPref } from '@/features/persist/types'
import { useIsomorphicLayoutEffect } from '@/hooks/use-isomorphic-layout-effect'
import {
  clampIslandPoint,
  findIslandOrientation,
  findNearestEdge,
  fromRatio,
  resolveDockPoint,
  toRatio,
  type IslandPoint
} from '@/views/overlay/island/island-geometry.ts'
import { IslandMark } from '@/views/overlay/island/island-mark.tsx'

/**
 * 收起时是正圆。展开后的搜索条与它对齐（同一高度），
 * 结果从这条下面长出来，而不是再套一个更高的表单输入框。
 */
const BUBBLE = 40
/**
 * 收起态的底色：深色金属径向渐变，纯 CSS。
 *
 * 参数照 `public/cogito-brand.svg` 的底板（radialGradient `pg`：cx 48% / cy 36% / r 72%）。
 * 之前这层画在 SVG 里当底板，现在把「底色」交回 CSS，SVG 只负责被描写出来的字形。
 */
const BUBBLE_SKIN =
  'bg-[radial-gradient(72%_72%_at_48%_36%,#3E4653_0%,#353C47_35%,#2A3039_70%,#1C2129_100%)] text-white/90 ring-1 ring-white/10'

/** 展开宽度上限：要装得下「文件名 + 所在目录」，340 太窄会大量截断 */
const SURFACE_MAX_WIDTH = 460
/** 结果区的至高（与 `results.tsx` 的 max-h 对齐，用于展开时夹在屏内） */
const RESULTS_MAX_HEIGHT = 420
/** 移动超过这个距离才算拖拽，否则按点击处理 */
const DRAG_THRESHOLD = 4
/** 收起动画时长（与容器 transition 一致）：动画没跑完就卸内容，高度会瞬间塌成一条横条 */
const COLLAPSE_MS = 200

const BUBBLE_SIZE = { width: BUBBLE, height: BUBBLE }

/** 展开后整列尺寸：窄屏时按屏宽收窄，但不少于 260。高度 = 搜索条（与收起圆同高）+ 结果区 */
function findSurfaceSize(viewport: { width: number }): { width: number; height: number } {
  return {
    width: Math.min(SURFACE_MAX_WIDTH, Math.max(260, viewport.width - 24)),
    height: BUBBLE + RESULTS_MAX_HEIGHT
  }
}
interface DragSession {
  pointerId: number
  offsetX: number
  offsetY: number
  hasMoved: boolean
}

function SearchIsland() {
  const islandRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragSession | null>(null)
  /** 失焦收起要看「这次 blur 是不是点在岛内」——指针按下/抬起夹一下即可 */
  const isPointerInsideRef = useRef(false)
  const [pref, setPref] = useState<SearchIslandPref | null>(null)
  const [point, setPoint] = useState<IslandPoint>({ x: 0, y: 0 })
  const [edge, setEdge] = useState<SearchIslandEdge | null>(null)
  const [isExpanded, setExpanded] = useState(false)
  /** 收起动画进行中：布局仍按展开态排，只让外框缩回去（内容随外框被裁掉） */
  const [isClosing, setClosing] = useState(false)
  const [isDragging, setDragging] = useState(false)
  const [viewport, setViewport] = useState(function () {
    return { width: window.innerWidth, height: window.innerHeight }
  })

  const search = useCommandSearch({
    onEscape: function () {
      if (!isExpanded) return false
      collapse()
      return true
    }
  })
  const inputRef = search.inputRef
  /** 收合时同步关掉搜索面（`search` 每次渲染都是新对象，用 ref 避开依赖抖动） */
  const closeSearchRef = useRef(search.close)
  useIsomorphicLayoutEffect(function () {
    closeSearchRef.current = search.close
  })

  // 首次读偏好：位置存的是相对坐标，换分辨率也不会跑出屏幕
  useEffect(
    function () {
      let cancelled = false
      void ensurePersist()
        .then(function () {
          if (cancelled) return
          applyPref(findPref('overlay').searchIsland)
        })
        .catch(function (error) {
          console.warn('[island] 读取灵动岛偏好失败:', error)
        })
      return function () {
        cancelled = true
      }
    },
    []
  )

  // 设置窗里改开关 / 位置：本窗口的 persist cache 不会自己更新，靠广播 + 重读磁盘
  useEffect(
    function () {
      // 嵌套壳 / 无 IPC 环境没有命令通道，`listen` 会直接抛错，别让它带崩整个岛
      if (!canUseTauriIpc()) return
      let cancelled = false
      let unlisten: (() => void) | null = null
      try {
        void listen<{ namespace: string }>(PREF_CHANGED, function (event) {
          if (event.payload.namespace !== 'overlay') return
          void reloadPref('overlay')
            .then(function (next) {
              if (cancelled) return
              applyPref(next.searchIsland)
            })
            .catch(function (error: unknown) {
              console.warn('[island] 同步灵动岛偏好失败:', error)
            })
        }).then(function (stop) {
          if (cancelled) stop()
          else unlisten = stop
        })
      } catch (error) {
        console.warn('[island] 订阅偏好广播失败:', error)
      }
      return function () {
        cancelled = true
        unlisten?.()
      }
    },
    []
  )

  useEffect(function () {
    function onResize() {
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    }
    window.addEventListener('resize', onResize)
    return function () {
      window.removeEventListener('resize', onResize)
    }
  }, [])

  // 展开后聚焦输入（Input 只在展开态挂载，得等下一次提交）
  useEffect(
    function () {
      if (!isExpanded) return
      const frame = window.requestAnimationFrame(function () {
        inputRef.current?.focus()
      })
      return function () {
        window.cancelAnimationFrame(frame)
      }
    },
    [isExpanded, inputRef]
  )

  // 收起动画结束后再关搜索面 / 切成圆形：卸得太早会让高度瞬间塌到 40，
  // 外框就只剩一条扁横条横向收缩，看起来像内容被「从右往左」扫掉。
  useEffect(
    function () {
      if (isExpanded || !isClosing) return
      const timer = window.setTimeout(function () {
        setClosing(false)
        closeSearchRef.current()
      }, COLLAPSE_MS)
      return function () {
        window.clearTimeout(timer)
      }
    },
    [isExpanded, isClosing]
  )

  useClickOutside(islandRef, function () {
    if (dragRef.current) return
    collapse()
  })

  async function persist(patch: Partial<SearchIslandPref>) {
    const current = findPref('overlay').searchIsland
    const next = { ...current, ...patch }
    setPref(next)
    try {
      await patchPref('overlay', { searchIsland: next })
    } catch (error) {
      console.warn('[island] 保存灵动岛位置失败:', error)
    }
  }

  /** 套用一份偏好：位置按相对坐标重算，关掉时顺手收起（否则展开面板会留在屏上） */
  function applyPref(next: SearchIslandPref) {
    const size = { width: window.innerWidth, height: window.innerHeight }
    const saved = clampIslandPoint(fromRatio(next.ratioX, next.ratioY, size), BUBBLE_SIZE, size)
    setPref(next)
    setEdge(next.edge)
    setPoint(next.edge ? resolveDockPoint(next.edge, saved, BUBBLE_SIZE, size) : saved)
    if (!next.enabled) {
      setExpanded(false)
      setClosing(false)
    }
  }

  function expand() {
    // 展开变宽变高：先夹回屏内，避免贴边展开时被裁
    setClosing(false)
    setPoint(function (prev) {
      return clampIslandPoint(prev, findSurfaceSize(viewport), viewport)
    })
    setExpanded(true)
  }

  /** 收起：只改「目标尺寸」，布局延后到动画结束再换（见上面那个 effect） */
  function collapse() {
    if (!isExpanded) return
    setExpanded(false)
    setClosing(true)
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || isExpanded) return
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - point.x,
      offsetY: event.clientY - point.y,
      hasMoved: false
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const nextX = event.clientX - drag.offsetX
    const nextY = event.clientY - drag.offsetY
    if (!drag.hasMoved) {
      const isFarEnough =
        Math.abs(nextX - point.x) >= DRAG_THRESHOLD || Math.abs(nextY - point.y) >= DRAG_THRESHOLD
      if (!isFarEnough) return
      drag.hasMoved = true
    }
    // 拖动中允许跟着指针出屏一点，松手再夹 / 吸附
    setPoint({ x: nextX, y: nextY })
    if (edge) setEdge(null)
  }

  function onPointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return
    // 指针被系统夺走（滚轮接管 / 手势取消）时不能再按「松手等于点击」处理
    dragRef.current = null
    setDragging(false)
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)

    if (!drag.hasMoved) {
      expand()
      return
    }

    const snapped = findNearestEdge(point, BUBBLE_SIZE, viewport)
    const nextPoint = snapped
      ? resolveDockPoint(snapped, point, BUBBLE_SIZE, viewport)
      : clampIslandPoint(point, BUBBLE_SIZE, viewport)
    setEdge(snapped)
    setPoint(nextPoint)

    const ratio = toRatio(nextPoint, viewport)
    void persist({ edge: snapped, ratioX: ratio.ratioX, ratioY: ratio.ratioY })
  }

  if (!pref?.enabled) return null

  const orientation = findIslandOrientation(edge)
  const surfaceSize = findSurfaceSize(viewport)
  /** 收起动画期间仍按展开态排版：只有外框同时在收缩 */
  const keepsLayout = isExpanded || isClosing
  /** 搜索框里的小放大镜（展开态才用到；收起态圆内是品牌 logo） */
  const searchGlyph = (
    <Icon
      icon="lucide:search"
      className="text-muted-foreground size-3.5 shrink-0"
      aria-hidden
    />
  )

  return (
    <>
      <div
        ref={islandRef}
        data-region="false"
        data-orientation={orientation}
        className={cn(
          // iOS 观感：连续大圆角 + 分层投影；40×40 上 28px 会被夹成正圆
          'fixed z-40 flex',
          keepsLayout
            ? // 展开：搜索条 + 结果面板合成一列，不能再用绝对定位（会露缝、圆角打架）
              // 外层用 popover 实底 + 细描边：搜索框是**它里面的输入区**，不是一块浮在上面的灰条
              'bg-popover text-popover-foreground flex-col overflow-hidden rounded-[28px] shadow-[0_18px_48px_-20px_rgb(0_0_0/0.38),0_1px_3px_rgb(0_0_0/0.12)] ring-1 ring-border/60 focus-within:ring-2 focus-within:ring-primary/40'
            : // 收起：圆就是品牌底（底色在 CSS 里），SVG 只画字形
              cn(
                'cursor-grab items-center justify-center overflow-hidden rounded-[28px]',
                BUBBLE_SKIN,
                // 悬停/按下/键盘聚焦都要有反馈：以前只有 cursor 变化，看不出这东西能点
                !isDragging &&
                  'transition-[box-shadow,scale] duration-150 ease-out hover:scale-[1.04] hover:ring-white/25 hover:shadow-[0_16px_36px_-16px_rgb(0_0_0/0.5),0_2px_6px_rgb(0_0_0/0.18)] active:scale-95 focus-visible:scale-[1.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none'
              ),
          isDragging && 'cursor-grabbing shadow-[0_24px_60px_-18px_rgb(0_0_0/0.45)]',
          !isDragging &&
            'transition-[left,top,width,max-height] duration-200 ease-out motion-reduce:transition-none'
        )}
        title={isExpanded ? undefined : '搜索（拖动可停靠到屏幕边缘）'}
        style={
          isExpanded
            ? { left: point.x, top: point.y, width: surfaceSize.width, maxHeight: surfaceSize.height }
            : // 收起用 max-height（与展开态同一个属性）才能插值；直接给 height 会从 auto 硬切
              { left: point.x, top: point.y, width: BUBBLE, maxHeight: BUBBLE }
        }
        role={isExpanded ? undefined : 'button'}
        tabIndex={isExpanded ? undefined : 0}
        aria-label={isExpanded ? undefined : '打开搜索'}
        onPointerDownCapture={function () {
          isPointerInsideRef.current = true
        }}
        onPointerUpCapture={function () {
          // 让这次点击触发的 blur 先读到「指针在岛内」，再复位
          window.setTimeout(function () {
            isPointerInsideRef.current = false
          }, 0)
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onBlur={function (event) {
          if (!isExpanded) return
          const next = event.relatedTarget
          if (next instanceof Node && event.currentTarget.contains(next)) return
          // 点在岛内（点结果行 / 过滤器）引起的 blur 不算失焦
          if (isPointerInsideRef.current) return
          collapse()
        }}
        onKeyDown={
          isExpanded
            ? undefined
            : function (event) {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                expand()
              }
        }>
        <div
          className={cn(
            'flex shrink-0 items-center',
            // 收起态圆 40×40；展开态搜索条同高，文字直接落在岛上，不再内嵌一条更高的圆角输入框
            keepsLayout ? 'h-10 gap-2 px-3' : 'size-10 justify-center'
          )}>
          {keepsLayout ? (
            <>
              {searchGlyph}
              <Input
                ref={inputRef}
                value={search.keyword}
                onChange={function (event) {
                  search.changeKeyword(event.target.value)
                }}
                onKeyDown={search.onKeyDown}
                onFocus={function () {
                  search.openSurface()
                }}
                placeholder="搜索文件、磁贴或网址…"
                aria-label="灵动岛搜索"
                aria-autocomplete="list"
                aria-expanded={search.isOpen}
                className="h-10 min-w-0 flex-1 border-0 bg-transparent px-0 text-[13px] leading-none shadow-none focus-visible:border-transparent focus-visible:ring-0 md:text-[13px] dark:bg-transparent"
              />
            </>
          ) : (
            // 收起态的圆**就是** logo：铺满整个圆（底板自带圆形裁剪），不再套白边
            <span className="block size-full">
              <IslandMark />
            </span>
          )}
        </div>

        {keepsLayout ? (
          <ResultsSurface
            hits={search.hits}
            navigation={search.navigation}
            filter={search.filter}
            isOpen={search.isOpen}
            placement="inline"
            onFilter={search.changeFilter}
            onNavigate={search.setNavigation}
            onSelect={function (hit) {
              void search.activateHit(hit)
            }}
          />
        ) : null}
      </div>

      {/* 拖拽罩：拖出岛的范围仍要占住整个窗口，否则 through 会判穿透中断拖动 */}
      {isDragging ? (
        <div
          data-region="false"
          className="fixed inset-0 z-30"
          aria-hidden
        />
      ) : null}
    </>
  )
}

export { SearchIsland }
