/**
 * 灵动岛圆内的品牌字形（收起态）。
 *
 * 职责分工：
 * - **底色**：CSS（`island.tsx` 的 `BUBBLE_SKIN`），SVG 里没有底板；
 * - **字形**：按 `public/cogito-brand.svg`（1024 坐标系）实测的尺寸重画成**可描边的骨架**，
 *   再用 `stroke-dashoffset` 一笔一笔描写出来。
 *
 * 为什么不内联原图：原图是位图描摹（上万字符的贝塞尔轮廓 + 4 层阴影/水印副本），
 * 40px 下细节糊、也没法逐笔绘制。这里保持**构成与比例**不变，只留能被描出来的部分：
 *
 *   外环 = 四段粗弧（缺口 11° / 30° 交错，指针正好从两个 30° 大缺口穿出）
 *   中心 = 一个细环
 *   指针 = 一片**渐细的刃**（尾尖 → 头上的圆点），用遮罩「刷」出来
 *
 * 尺寸来源（1024 系实测 → ÷16 落到 64 视图，并整体上移到正中）：
 *   外环带 r 192..259 → 心线 14.13 / 线宽 4.13
 *   中心环 r 64..104  → 心线 5.22  / 线宽 2.56
 *   指针   尾尖 (219,756) → 头点圆心 (786,210) r53，刃口宽 50
 *
 * 两个坑：
 * 1. **不要用 `pathLength` 归一化**。Chrome 不会把 `stroke-dasharray` 按 `pathLength` 缩放，
 *    写 `pathLength={1}` + `dasharray=1` 时虚实只剩 1 个用户单位，圆环/指针只会露出一小截。
 *    这里每条线的虚线长度都用几何解析算好（`data-len`），dasharray 与初始 dashoffset 都取该长度。
 * 2. 刃是渐细的，等宽 `stroke` 出不来。用「填充刃形 + 遮罩里一条会描边的粗线」实现：
 *    遮罩线沿轴线推进，就把刃从尾尖到刃口刷出来了。
 */
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { useReducedMotion } from 'motion/react'
import { useId, useRef } from 'react'

gsap.registerPlugin(useGSAP)

/** 一轮：描写 → 停顿 → 淡出重画；空白期压短，圆不会长时间空着 */
const DRAW = 0.42
const STAGGER = 0.1
const HOLD = 1.35
const FADE = 0.3
const GAP = 0.5

/** 64 格坐标系 */
const VIEW = 64
const C = VIEW / 2

/** 外环：四段弧的角度（度，y 轴向下）；330→392 即跨 0° 的那一段 */
const RING_R = 14.13
const RING_W = 4.13
const RING_SPANS = [
  [44, 119],
  [150, 212],
  [224, 299],
  [330, 392]
] as const

/** 中心环 */
const CORE_R = 5.22
const CORE_W = 2.56

/** 指针：尾尖 → 刃口中心（也是头部圆点的圆心） */
const NEEDLE_TAIL = { x: 13.72, y: 48.59 }
const NEEDLE_DOT = { x: 49.19, y: 14.47 }
/** 刃口半宽（原图 50/1024 → 3.1/64） */
const BLADE_HALF = 1.55
const NEEDLE_DOT_R = 3.31
/** 遮罩「刷子」比刃口再宽一点，保证刃口两角也能刷到 */
const BRUSH_W = 3.6

function polar(deg: number, r: number) {
  const t = (deg * Math.PI) / 180
  return {
    x: Number((C + r * Math.cos(t)).toFixed(2)),
    y: Number((C + r * Math.sin(t)).toFixed(2))
  }
}

/** 弧：半径固定，终点角度直接换算成坐标 */
function arcSegment(from: number, to: number, r: number) {
  const a = polar(from, r)
  const b = polar(to, r)
  return {
    d: `M${a.x} ${a.y}A${r} ${r} 0 ${Math.abs(to - from) > 180 ? 1 : 0} 1 ${b.x} ${b.y}`,
    len: Number(((r * Math.abs(to - from) * Math.PI) / 180).toFixed(2))
  }
}

const RING_ARC_SEGMENTS = RING_SPANS.map(function ([from, to]) {
  return arcSegment(from, to, RING_R)
})
const CORE_LEN = Number((2 * Math.PI * CORE_R).toFixed(2))
const NEEDLE_DX = NEEDLE_DOT.x - NEEDLE_TAIL.x
const NEEDLE_DY = NEEDLE_DOT.y - NEEDLE_TAIL.y
const NEEDLE_LEN = Number(Math.hypot(NEEDLE_DX, NEEDLE_DY).toFixed(2))

/** 刃形三角：尾尖 + 刃口两端（沿轴线法向各让 BLADE_HALF） */
const BLADE = (function () {
  const n = Math.hypot(NEEDLE_DX, NEEDLE_DY)
  const px = (-NEEDLE_DY / n) * BLADE_HALF
  const py = (NEEDLE_DX / n) * BLADE_HALF
  const round = (v: number) => Number(v.toFixed(2))
  return [
    `M${NEEDLE_TAIL.x} ${NEEDLE_TAIL.y}`,
    `L${round(NEEDLE_DOT.x + px)} ${round(NEEDLE_DOT.y + py)}`,
    `L${round(NEEDLE_DOT.x - px)} ${round(NEEDLE_DOT.y - py)}`,
    'Z'
  ].join('')
})()

/** 动画起点：读回元素上记的虚线长度 */
function fromFullLength(_index: number, target: Element) {
  return Number(target.getAttribute('data-len') ?? 0)
}

function IslandMark() {
  const rootRef = useRef<SVGSVGElement>(null)
  const isReducedMotion = useReducedMotion()
  // id 是文档级全局的，必须按实例区分，否则同时渲染多个标记会串色
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const metalId = `mark-metal-${uid}`
  const brushId = `mark-brush-${uid}`

  useGSAP(
    function () {
      // 降级：直接显示画好的字形（初始 dashoffset 是全长，这里一次归零）
      if (isReducedMotion) {
        gsap.set('[data-draw]', { strokeDashoffset: 0 })
        return
      }

      gsap
        .timeline({ repeat: -1, repeatDelay: GAP })
        // 外环四段依次划出
        .fromTo(
          '[data-draw="ring"]',
          { strokeDashoffset: fromFullLength },
          { strokeDashoffset: 0, duration: DRAW, ease: 'power2.inOut', stagger: STAGGER }
        )
        // 中心环
        .fromTo(
          '[data-draw="core"]',
          { strokeDashoffset: fromFullLength },
          { strokeDashoffset: 0, duration: DRAW, ease: 'power2.inOut' },
          '-=0.2'
        )
        // 指针：遮罩刷子从尾尖推到刃口
        .fromTo(
          '[data-draw="needle"]',
          { strokeDashoffset: fromFullLength },
          { strokeDashoffset: 0, duration: 0.34, ease: 'power2.inOut' },
          '-=0.12'
        )
        // 推到刃口，圆点跟着冒出来
        .fromTo(
          '[data-dot]',
          { attr: { r: 0 } },
          { attr: { r: NEEDLE_DOT_R }, duration: 0.26, ease: 'back.out(2.2)' },
          '-=0.04'
        )
        // 停一下 → 淡出 → 复位 → 下一轮
        .to('[data-glyph]', { opacity: 0, duration: FADE, ease: 'power1.in' }, `+=${HOLD}`)
        .set('[data-draw]', { strokeDashoffset: fromFullLength })
        .set('[data-dot]', { attr: { r: 0 } })
        .set('[data-glyph]', { opacity: 1 })
    },
    { scope: rootRef, dependencies: [isReducedMotion] }
  )

  return (
    <svg
      ref={rootRef}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      // 原图字形下面有一层 softBlur 暗影（让它「站」在底板上），这里用一层浅投影替代
      className="size-full filter-[drop-shadow(0_1px_1px_rgb(0_0_0/0.35))]"
      fill="none"
      stroke={`url(#${metalId})`}
      // 弧端是平口（原图就是平切）；圆头会吃掉 11° 那条细缝
      strokeLinecap="butt"
      aria-hidden>
      <defs>
        {/* 品牌金属渐变：沿用原图 userSpaceOnUse 的走向（左上亮 → 右下略暗） */}
        <linearGradient
          id={metalId}
          gradientUnits="userSpaceOnUse"
          x1={15.7}
          y1={10.1}
          x2={48.8}
          y2={45.1}>
          <stop
            offset="0%"
            stopColor="#F0F1F3"
          />
          <stop
            offset="22%"
            stopColor="#E2E4E9"
          />
          <stop
            offset="48%"
            stopColor="#CFD2D9"
          />
          <stop
            offset="72%"
            stopColor="#BCC0C8"
          />
          <stop
            offset="100%"
            stopColor="#A6ABB4"
          />
        </linearGradient>
        {/* 刃形的遮罩：这条白线就是「刷子」，虚线推进 = 从尾尖刷到刃口 */}
        <mask
          id={brushId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width={VIEW}
          height={VIEW}>
          <line
            data-draw="needle"
            data-len={NEEDLE_LEN}
            strokeDasharray={NEEDLE_LEN}
            strokeDashoffset={NEEDLE_LEN}
            x1={NEEDLE_TAIL.x}
            y1={NEEDLE_TAIL.y}
            x2={NEEDLE_DOT.x}
            y2={NEEDLE_DOT.y}
            stroke="#fff"
            strokeWidth={BRUSH_W}
          />
        </mask>
      </defs>
      <g data-glyph>
        <g strokeWidth={RING_W}>
          {RING_ARC_SEGMENTS.map(function (seg) {
            return (
              <path
                key={seg.d}
                data-draw="ring"
                data-len={seg.len}
                strokeDasharray={seg.len}
                strokeDashoffset={seg.len}
                d={seg.d}
              />
            )
          })}
        </g>
        <circle
          data-draw="core"
          data-len={CORE_LEN}
          strokeDasharray={CORE_LEN}
          strokeDashoffset={CORE_LEN}
          cx={C}
          cy={C}
          r={CORE_R}
          strokeWidth={CORE_W}
        />
        <path
          d={BLADE}
          fill={`url(#${metalId})`}
          mask={`url(#${brushId})`}
        />
        <circle
          data-dot
          cx={NEEDLE_DOT.x}
          cy={NEEDLE_DOT.y}
          r={NEEDLE_DOT_R}
          fill={`url(#${metalId})`}
          stroke="none"
        />
      </g>
    </svg>
  )
}

export { IslandMark }
