import Konva from 'konva'
import type { Filter } from 'konva/lib/Node'
import { useEffect, useRef } from 'react'
import {
  Arrow,
  Circle,
  Ellipse,
  Group,
  Shape,
  Line,
  Rect,
  Image as ReImage,
  Text
} from 'react-konva'

import {
  findKonvaByID,
  transformPoints,
  type Bounds
} from './geometry'
import type {
  GraphicsEnum,
  GraphicsProps,
  Point
} from './types'

export type { GraphicsEnum, GraphicsProps, Point }

/** 形状渲染所需的交互回调（由父级 Annotation 注入） */
export interface InteractiveProps {
  /** 可点击/可拖拽 */
  interactive?: boolean
  /** 是否当前选中 */
  isSelected?: boolean
  /** 多选/群组时隐藏单节点虚线框（由 Transformer 显示选中） */
  hideSelectFrame?: boolean
  /** 同批拖拽的其它选中 id（不含自身）；拖动时同步位移 */
  dragPeerIDs?: string[]
  /** 当前是否处于编辑态（由 Annotation 层控制） */
  isEditing?: boolean
  /** 点击形状时回调；additive 为 Ctrl/Meta 多选 */
  onSelect?: (id: string, options?: { additive?: boolean }) => void
  /** 请求进入编辑态（双击文字标注时触发） */
  onEditStart?: (id: string, text: string) => void
  /** 拖拽结束后回写新的几何信息（单选） */
  onChange?: (next: GraphicsProps, options?: { history?: boolean }) => void
  /** 多选同步拖拽结束：批量回写 */
  onBatchChange?: (nexts: GraphicsProps[]) => void
  /** 用于批量拖拽结束时查找同伴 props */
  findGraphics?: (id: string) => GraphicsProps | undefined
  /** 橡皮筋起点非空时表示框选中：拖拽开始时 stopDrag */
  marqueeStartRef?: { current: { x: number; y: number } | null }
}

/** 马赛克像素块尺寸（px） */
const MOSAIC_PIXEL = 10
/** 序号圆圈半径 */
const INDEX_RADIUS = 14
/** 箭头箭尾基础长度 */
const ARROW_HEAD_LEN = 10
/** 箭头箭尾基础宽度 */
const ARROW_HEAD_WIDTH = 8
/** 高斯模糊半径（Konva.Filters.Blur） */
const BLUR_RADIUS = 12
/** 滤镜数组保持稳定引用，避免 FilteredImage 的 cache effect 每帧重跑 */
const BLUR_FILTERS: Filter[] = [Konva.Filters.Blur]
const PIXELATE_FILTERS: Filter[] = [Konva.Filters.Pixelate]
/** 聚光灯遮罩颜色（半透明黑色） */
const DIM_FILL = 'rgba(0, 0, 0, 0.55)'
/** 最小命中检测宽度（px），让细线条更容易被点击/拖拽 */
const MIN_HIT_WIDTH = 15
/** 荧光笔默认颜色（仅在调色板未给出时回退） */
const HIGHLIGHT_COLOR = '#FFE600'
/** 荧光笔默认描边宽度（px） */
const HIGHLIGHT_WIDTH = 16
/** 荧光笔默认透明度（0~1） */
const HIGHLIGHT_OPACITY = 0.4

/** 归一化包围盒（左上 + 宽高） */
function findBounding(a: Point, b: Point) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y)
  }
}

/** 扁平化为 Konva 需要的 [x1,y1,x2,y2,...] 序列 */
function flatten(points: Point[]): number[] {
  const result: number[] = []
  for (const p of points) result.push(p.x, p.y)
  return result
}

/**
 * 局部区域滤镜（模糊 / 马赛克）。
 *
 * 对齐官方写法：Image + filters + cache()；用 crop 只取选区对应底图像素。
 * Stage 逻辑尺寸 = natural / dpr（见 annotation.tsx），故 crop 缩放比为 dpr，
 * 不能再用 window.innerWidth（与 stage 可能差亚像素，导致抠错区域）。
 */
function FilteredImage(props: {
  image: HTMLImageElement
  box: { x: number; y: number; width: number; height: number }
  filters: Filter[]
  pixelSize?: number
  blurRadius?: number
}) {
  const { image, box, filters, pixelSize, blurRadius } = props
  const imageRef = useRef<Konva.Image>(null)
  const rafIdRef = useRef<number | null>(null)

  const dpr = Math.max(1, window.devicePixelRatio || 1)
  const cropRect = {
    x: box.x * dpr,
    y: box.y * dpr,
    width: Math.max(1, box.width * dpr),
    height: Math.max(1, box.height * dpr)
  }

  useEffect(
    function () {
      const node = imageRef.current
      if (!node || box.width <= 0 || box.height <= 0) return

      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
      }
      // 合并同帧多次更新；官方要求属性/图像变化后重新 cache 才应用滤镜
      rafIdRef.current = requestAnimationFrame(function () {
        rafIdRef.current = null
        node.clearCache()
        node.cache({ pixelRatio: dpr })
        node.getLayer()?.batchDraw()
      })

      return function () {
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current)
          rafIdRef.current = null
        }
      }
    },
    [image, box.x, box.y, box.width, box.height, pixelSize, blurRadius, filters, dpr]
  )

  if (box.width <= 0 || box.height <= 0) return null

  return (
    <ReImage
      ref={imageRef}
      image={image}
      x={box.x}
      y={box.y}
      width={box.width}
      height={box.height}
      crop={cropRect}
      filters={filters}
      pixelSize={pixelSize}
      blurRadius={blurRadius}
      listening={false}
      perfectDrawEnabled={false}
    />
  )
}

const shapes: Record<GraphicsEnum, React.FC<GraphicsProps>> = {
  arrow(props) {
    const { points, color, thickness } = props
    if (points.length < 2) return null
    const [from, to] = points
    return (
      <Arrow
        points={[from.x, from.y, to.x, to.y]}
        stroke={color}
        strokeWidth={thickness}
        fill={color}
        pointerLength={ARROW_HEAD_LEN + thickness * 2}
        pointerWidth={ARROW_HEAD_WIDTH + thickness * 1.5}
        lineCap="round"
        lineJoin="round"
        strokeScaleEnabled={false}
        hitStrokeWidth={Math.max(thickness, MIN_HIT_WIDTH)}
      />
    )
  },

  blur(props) {
    const { points, sourceImage, thickness } = props
    if (points.length < 2 || !sourceImage) return null
    const box = findBounding(points[0], points[1])
    // 粗细滑块映射模糊强度（约 6~28），默认贴近官方示例 blurRadius=10
    const radius = Math.max(6, Math.min(28, (thickness || 2) * 4 + BLUR_RADIUS - 8))
    return (
      <FilteredImage
        image={sourceImage}
        box={box}
        filters={BLUR_FILTERS}
        blurRadius={radius}
      />
    )
  },

  ellipse(props) {
    const { points, color, thickness, filled, opacity } = props
    if (points.length < 2) return null
    const [a, b] = points
    return (
      <Ellipse
        x={(a.x + b.x) / 2}
        y={(a.y + b.y) / 2}
        radiusX={Math.abs(b.x - a.x) / 2}
        radiusY={Math.abs(b.y - a.y) / 2}
        stroke={color}
        strokeWidth={thickness}
        fill={filled ? color : undefined}
        opacity={opacity}
        strokeScaleEnabled={false}
        hitStrokeWidth={Math.max(thickness, MIN_HIT_WIDTH)}
      />
    )
  },

  freehand(props) {
    const { points, color, thickness } = props
    if (points.length < 2) return null
    return (
      <Line
        points={flatten(points)}
        stroke={color}
        strokeWidth={thickness}
        tension={0}
        lineCap="round"
        lineJoin="round"
        strokeScaleEnabled={false}
        hitStrokeWidth={Math.max(thickness, MIN_HIT_WIDTH)}
      />
    )
  },

  /**
   * 荧光笔：多点折线 + `multiply` 混合模式。
   * - 用混合模式而非简单半透明，避免多笔交叠越来越浊（snipaste/pixpin 同款手感）。
   * - 颜色跟随工具栏调色板（`color`）；`thickness` / `opacity` 也走工具栏。
   */
  highlight(props) {
    const { points, color, thickness, opacity } = props
    if (points.length < 2) return null
    return (
      <Line
        points={flatten(points)}
        stroke={color || HIGHLIGHT_COLOR}
        strokeWidth={thickness || HIGHLIGHT_WIDTH}
        opacity={opacity ?? HIGHLIGHT_OPACITY}
        globalCompositeOperation="multiply"
        tension={0}
        lineCap="butt"
        lineJoin="round"
        strokeScaleEnabled={false}
        hitStrokeWidth={Math.max(thickness || HIGHLIGHT_WIDTH, MIN_HIT_WIDTH)}
      />
    )
  },

  spotlight(props) {
    const { points, color } = props
    if (points.length < 2) return null
    const box = findBounding(points[0], points[1])
    // 「聚光灯」的外层暗罩由 Annotation 层统一渲染（避免多个聚光灯叠加变得过暗），
    // 这里只负责高亮区域的命中检测 + 视觉描边。
    return (
      <>
        <Rect
          {...box}
          stroke={color || '#FFD24D'}
          strokeWidth={1}
          dash={[4, 4]}
          fill="rgba(0,0,0,0.001)"
          listening={true}
        />
      </>
    )
  },

  index(props) {
    const { index, points, color } = props
    if (points.length < 1) return null
    const [point] = points
    return (
      <Group
        x={point.x}
        y={point.y}>
        <Circle
          radius={INDEX_RADIUS}
          fill={color}
        />
        <Text
          text={String(index ?? 1)}
          fontSize={14}
          fontFamily="sans-serif"
          fontStyle="bold"
          fill="#FFFFFF"
          align="center"
          verticalAlign="middle"
          width={INDEX_RADIUS * 2}
          height={INDEX_RADIUS * 2}
          offsetX={INDEX_RADIUS}
          offsetY={INDEX_RADIUS}
        />
      </Group>
    )
  },

  line(props) {
    const { points, color, thickness } = props
    if (points.length < 2) return null
    const [a, b] = points
    return (
      <Line
        points={[a.x, a.y, b.x, b.y]}
        stroke={color}
        strokeWidth={thickness}
        lineCap="round"
        strokeScaleEnabled={false}
        hitStrokeWidth={Math.max(thickness, MIN_HIT_WIDTH)}
      />
    )
  },

  mosaic(props) {
    const { points, sourceImage } = props
    if (points.length < 2 || !sourceImage) return null
    const box = findBounding(points[0], points[1])
    return (
      <FilteredImage
        image={sourceImage}
        box={box}
        filters={PIXELATE_FILTERS}
        pixelSize={Math.max(2, MOSAIC_PIXEL)}
      />
    )
  },

  rect(props) {
    const { points, color, thickness, filled, opacity } = props
    if (points.length < 2) return null
    const box = findBounding(points[0], points[1])
    return (
      <Rect
        {...box}
        stroke={color}
        strokeWidth={thickness}
        fill={filled ? color : undefined}
        opacity={opacity}
        strokeScaleEnabled={false}
        hitStrokeWidth={Math.max(thickness, MIN_HIT_WIDTH)}
      />
    )
  },

  text(props) {
    const { points, color, fontSize, text, width, opacity } = props
    if (points.length < 1) return null
    const [point] = points
    return (
      <Text
        x={point.x}
        y={point.y}
        text={text || ' '}
        fontSize={fontSize ?? 16}
        fontFamily="sans-serif"
        fill={color}
        width={width}
        opacity={opacity}
      />
    )
  }
}

/**
 * 形状分发组件：根据 `type` 渲染对应 Konva 图元。
 * - 外层 `<Group>` 统一承担 `id` / 拖拽 / 点击选中 / Transform 回写，
 *   让所有形状受同一套交互/状态机控制。
 * - 内层渲染器只负责绘制，不再持有任何 `draggable` 状态。
 */
export default function Graphics(props: GraphicsProps & InteractiveProps) {
  const {
    interactive,
    onSelect,
    onChange,
    onBatchChange,
    onEditStart,
    isSelected,
    isEditing,
    hideSelectFrame,
    dragPeerIDs,
    findGraphics,
    marqueeStartRef,
    ...graphicsProps
  } = props

  const Renderer = shapes[graphicsProps.type]
  if (!Renderer) return null
  const isText = graphicsProps.type === 'text'
  const isLocked = graphicsProps.locked === true
  const canInteract = interactive === true && !isLocked && !isEditing
  const localBounds = findLocalSelectFrame(graphicsProps)
  const peers = dragPeerIDs ?? []

  function handleSelect(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (isLocked) return
    const native = event.evt
    const additive =
      ('ctrlKey' in native && native.ctrlKey === true) ||
      ('metaKey' in native && native.metaKey === true)

    // Ctrl/Meta + 点击已选中层：穿透叠加下层，便于叠加后再多选群组
    if (additive && isSelected) {
      const stage = event.target.getStage()
      const pos = stage?.getPointerPosition()
      if (stage && pos) {
        const group = event.currentTarget
        const skip = new Set<string>([graphicsProps.id, ...peers])
        group.listening(false)
        const hits = stage.getAllIntersections(pos)
        group.listening(true)
        for (const shape of hits) {
          let node: Konva.Node | null = shape
          while (node) {
            if (
              node.name() === 'annotation' &&
              !skip.has(node.id()) &&
              node.getAttr('annotationLocked') !== true
            ) {
              onSelect?.(node.id(), { additive: true })
              event.cancelBubble = true
              return
            }
            node = node.getParent()
          }
        }
      }
    }

    onSelect?.(graphicsProps.id, { additive })
  }

  function handleDragStart(event: Konva.KonvaEventObject<DragEvent>) {
    if (marqueeStartRef?.current) {
      event.target.stopDrag()
    }
  }

  /** 锁定：左键穿透到下层未锁定标注；右键仍命中本节点以便菜单选中 / 取消群组 */
  function handleMouseDown(event: Konva.KonvaEventObject<MouseEvent>) {
    if (!isLocked) return
    if (event.evt.button !== 0) return
    const stage = event.target.getStage()
    if (!stage) return
    const pos = stage.getPointerPosition()
    if (!pos) return
    const group = event.currentTarget
    group.listening(false)
    const hits = stage.getAllIntersections(pos)
    group.listening(true)

    const additive = event.evt.ctrlKey === true || event.evt.metaKey === true
    for (const shape of hits) {
      let node: Konva.Node | null = shape
      while (node) {
        if (
          node.name() === 'annotation' &&
          node !== group &&
          node.getAttr('annotationLocked') !== true
        ) {
          onSelect?.(node.id(), { additive })
          event.cancelBubble = true
          return
        }
        node = node.getParent()
      }
    }
    // 下层无未锁定标注：阻止冒泡，避免 Stage 把锁定层当成可框选起点
    event.cancelBubble = true
  }

  function handleDblClick() {
    if (isLocked) return
    if (isText) {
      onEditStart?.(graphicsProps.id, graphicsProps.text ?? '')
    }
  }

  /** 多选时拖动主节点，同伴节点跟同一位移（过程中只改 Konva position） */
  function handleDragMove(event: Konva.KonvaEventObject<DragEvent>) {
    if (peers.length === 0) return
    const primary = event.target
    const dx = primary.x()
    const dy = primary.y()
    const stage = primary.getStage()
    if (!stage) return
    for (const peerID of peers) {
      const peer = findKonvaByID(stage, peerID)
      if (peer) peer.position({ x: dx, y: dy })
    }
    stage.findOne<Konva.Transformer>('Transformer')?.forceUpdate()
  }

  function handleDragEnd(event: Konva.KonvaEventObject<DragEvent>) {
    const node = event.target
    const dx = node.x()
    const dy = node.y()
    const stage = node.getStage()
    if (dx === 0 && dy === 0) {
      // 同伴可能被拖过，复位
      if (stage && peers.length > 0) {
        for (const peerID of peers) {
          findKonvaByID(stage, peerID)?.position({ x: 0, y: 0 })
        }
      }
      return
    }

    if (peers.length > 0 && onBatchChange && findGraphics) {
      const updates: GraphicsProps[] = []
      const allIDs = [graphicsProps.id, ...peers]
      for (const id of allIDs) {
        const propsForNode = id === graphicsProps.id ? graphicsProps : findGraphics(id)
        const konvaNode = stage ? findKonvaByID(stage, id) : null
        if (!propsForNode || !konvaNode) continue
        const rotation = konvaNode.rotation()
        konvaNode.position({ x: 0, y: 0 })
        updates.push({
          ...propsForNode,
          points: transformPoints(propsForNode.points, dx, dy, 1, 1, rotation)
        })
      }
      if (updates.length > 0) onBatchChange(updates)
      stage?.findOne<Konva.Transformer>('Transformer')?.forceUpdate()
      return
    }

    const rotation = node.rotation()
    node.position({ x: 0, y: 0 })
    // 有旋转时位移在父坐标，需 R⁻¹ 后再写入局部顶点
    onChange?.({
      ...graphicsProps,
      points: transformPoints(graphicsProps.points, dx, dy, 1, 1, rotation)
    })
  }

  return (
    <Group
      id={graphicsProps.id}
      name="annotation"
      rotation={graphicsProps.rotation ?? 0}
      draggable={canInteract && isSelected === true}
      annotationLocked={isLocked}
      // 锁定仍 listening：右键能选中（取消群组等）；左键在 onMouseDown 穿透
      listening={interactive === true}
      opacity={isLocked ? 0.85 : 1}
      onMouseDown={handleMouseDown}
      onClick={handleSelect}
      onTap={handleSelect}
      onDblClick={handleDblClick}
      onDblTap={handleDblClick}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}>
      <Renderer {...graphicsProps} />
      {isSelected && !isEditing && !hideSelectFrame && localBounds && (
        <Rect
          name="annotation-select-frame"
          x={localBounds.x}
          y={localBounds.y}
          width={localBounds.w}
          height={localBounds.h}
          stroke="#4080ff"
          strokeWidth={1}
          dash={[4, 3]}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  )
}

/** 选中框用局部坐标（Group 已承担 rotation） */
function findLocalSelectFrame(graphics: GraphicsProps): Bounds | null {
  const points = graphics.points
  if (!points.length) return null
  if (graphics.type === 'text' && points[0]) {
    return {
      x: points[0].x - 2,
      y: points[0].y - 2,
      w: Math.max(graphics.width ?? 80, 8) + 4,
      h: Math.max((graphics.fontSize ?? 16) * 1.4, 8) + 4
    }
  }
  if (graphics.type === 'index' && points[0]) {
    return {
      x: points[0].x - INDEX_RADIUS - 2,
      y: points[0].y - INDEX_RADIUS - 2,
      w: INDEX_RADIUS * 2 + 4,
      h: INDEX_RADIUS * 2 + 4
    }
  }
  const origin = points[0]
  if (!origin) return null
  let minX = origin.x
  let maxX = origin.x
  let minY = origin.y
  let maxY = origin.y
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i]
    if (!point) continue
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }
  const pad = Math.max(4, (graphics.thickness ?? 2) + 2)
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2
  }
}

/**
 * 聚光灯共享暗罩。
 *
 * 关键实现细节：
 * - 一条 `Konva.Shape` 用 `sceneFunc` 绘制；外层是覆盖整个 Stage 的大矩形，
 *   每个 spotlight 用 `ctx.rect()` 追加一个**独立子路径**。
 * - 配合 `fillRule="evenodd"`，相邻子路径的奇偶层级正好把高亮区域镂空，
 *   且**不会**像单条 `Line + closed` 那样把每个矩形末尾连接到下一个起点
 *   而产生三角形伪影。
 * - `listening={false}`，命中检测由各 spotlight 自身的命中 Rect 负责。
 */
export function SpotlightMask(props: {
  annotations: GraphicsProps[]
  width: number
  height: number
}) {
  const { annotations, width, height } = props
  const spotlights = annotations.filter(function (annotation) {
    return annotation.type === 'spotlight' && annotation.points.length >= 2
  })
  if (spotlights.length === 0) return null

  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      fill={DIM_FILL}
      fillRule="evenodd"
      sceneFunc={function (context, shape) {
        context.beginPath()
        // 外层矩形：覆盖整个 Stage
        context.rect(0, 0, width, height)
        // 每个 spotlight 添加一个独立子路径（rect 在 canvas 规范里是 closed sub-path）
        for (const annotation of spotlights) {
          const box = findBounding(annotation.points[0], annotation.points[1])
          if (box.width <= 0 || box.height <= 0) continue
          context.rect(box.x, box.y, box.width, box.height)
        }
        context.fillStrokeShape(shape)
      }}
    />
  )
}
