import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject
} from 'react'
import { Group, Layer, Stage } from 'react-konva'
import type Konva from 'konva'

import {
  LAYER_BACKGROUND,
  LAYER_CONTENT,
  LAYER_INTERACTION,
  LAYER_MEDIA
} from './layers'
import {
  findDevicePixelRatio,
  findStageMetrics,
  type Size,
  type StageMetrics
} from './metrics'
import type { Viewport } from './viewport'

interface CanvasStageProps {
  /** 内容逻辑尺寸（项目分辨率） */
  contentSize: Size
  /**
   * 固定视口 CSS 尺寸。传入时跳过 ResizeObserver，用于 Capture 等
   * 「Stage 逻辑像素 = natural/dpr」场景。
   */
  viewSize?: Size
  className?: string
  style?: CSSProperties
  background?: ReactNode
  media?: ReactNode
  content?: ReactNode
  interaction?: ReactNode
  /** 同步底层 Konva.Stage 引用（Capture 等需要直接操作 Stage） */
  konvaStageRef?: RefObject<Konva.Stage | null>
  /** 媒体层是否接收事件，默认 false（由交互层处理） */
  mediaListening?: boolean
  /** 内容层是否接收事件 */
  contentListening?: boolean
  /** 是否对内容做 letterbox 适配；false 时内容以 1:1 铺满视口（需 view≈content） */
  fitContent?: boolean
  /** 受控视口。传入后内容组用这份 x/y/scale，不再套 letterbox */
  viewport?: Viewport
  onStageClick?(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void
  onStageMouseDown?(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void
  onStageMouseMove?(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void
  onStageMouseUp?(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void
  onStageWheel?(event: Konva.KonvaEventObject<WheelEvent>): void
  onStageDblClick?(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void
  onStageContextMenu?(event: Konva.KonvaEventObject<PointerEvent>): void
}

interface CanvasStageHandle {
  stage: Konva.Stage | null
  metrics: StageMetrics
  findLayer(name: string): Konva.Layer | null
  batchDraw(): void
}

const CanvasStage = memo(
  forwardRef<CanvasStageHandle, CanvasStageProps>(function CanvasStage(props, ref) {
    const {
      contentSize,
      viewSize,
      className,
      style,
      background,
      media,
      content,
      interaction,
      konvaStageRef,
      mediaListening = false,
      contentListening = true,
      fitContent = true,
      viewport,
      onStageClick,
      onStageMouseDown,
      onStageMouseMove,
      onStageMouseUp,
      onStageWheel,
      onStageDblClick,
      onStageContextMenu
    } = props

    const hostRef = useRef<HTMLDivElement>(null)
    const stageRef = useRef<Konva.Stage>(null)
    const [measured, setMeasured] = useState<Size>({ width: 1, height: 1 })
    const [dpr, setDpr] = useState(() => findDevicePixelRatio())

    useEffect(function () {
      if (viewSize) return
      const host = hostRef.current
      if (!host) return

      function measure() {
        const el = hostRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const width = Math.max(1, Math.floor(rect.width))
        const height = Math.max(1, Math.floor(rect.height))
        setMeasured(function (prev) {
          if (prev.width === width && prev.height === height) return prev
          return { width, height }
        })
      }

      measure()
      const observer = new ResizeObserver(measure)
      observer.observe(host)
      return function () {
        observer.disconnect()
      }
    }, [viewSize])

    useEffect(() => {
      function onChange() {
        setDpr(findDevicePixelRatio())
      }
      window.addEventListener('resize', onChange)
      return () => window.removeEventListener('resize', onChange)
    }, [])

    const view = viewSize ?? measured

    const metrics = useMemo(
      function () {
        const nextView = { width: view.width, height: view.height }
        const nextContent = { width: contentSize.width, height: contentSize.height }
        if (!fitContent) {
          return {
            view: nextView,
            content: nextContent,
            dpr,
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            pixelRatio: dpr
          } satisfies StageMetrics
        }
        return findStageMetrics(nextView, nextContent, dpr)
      },
      [view.width, view.height, contentSize.width, contentSize.height, dpr, fitContent]
    )

    useImperativeHandle(
      ref,
      () => ({
        get stage() {
          return stageRef.current
        },
        metrics,
        findLayer(name: string) {
          return stageRef.current?.findOne(`Layer[name="${name}"]`) ?? null
        },
        batchDraw() {
          stageRef.current?.batchDraw()
        }
      }),
      [metrics]
    )

    const frame = useMemo(
      function () {
        if (viewport) {
          return {
            x: viewport.x,
            y: viewport.y,
            scaleX: viewport.scale,
            scaleY: viewport.scale
          }
        }
        return {
          x: metrics.offsetX,
          y: metrics.offsetY,
          scaleX: metrics.scale,
          scaleY: metrics.scale
        }
      },
      [viewport, metrics.offsetX, metrics.offsetY, metrics.scale]
    )

    const bindStage = useCallback(
      function (node: Konva.Stage | null) {
        stageRef.current = node
        if (konvaStageRef) konvaStageRef.current = node
      },
      [konvaStageRef]
    )

    return (
      <div
        ref={hostRef}
        className={className}
        style={{
          position: 'relative',
          width: viewSize ? viewSize.width : '100%',
          height: viewSize ? viewSize.height : '100%',
          overflow: 'hidden',
          ...style
        }}
      >
        <Stage
          ref={bindStage}
          width={view.width}
          height={view.height}
          pixelRatio={metrics.pixelRatio}
          onClick={onStageClick}
          onTap={onStageClick}
          onMouseDown={onStageMouseDown}
          onTouchStart={onStageMouseDown}
          onMouseMove={onStageMouseMove}
          onTouchMove={onStageMouseMove}
          onMouseUp={onStageMouseUp}
          onTouchEnd={onStageMouseUp}
          onWheel={onStageWheel}
          onDblClick={onStageDblClick}
          onDblTap={onStageDblClick}
          onContextMenu={onStageContextMenu}
        >
          <Layer name={LAYER_BACKGROUND} listening={false}>
            <Group {...frame}>{background}</Group>
          </Layer>
          <Layer name={LAYER_MEDIA} listening={mediaListening}>
            <Group {...frame}>{media}</Group>
          </Layer>
          <Layer name={LAYER_CONTENT} listening={contentListening}>
            <Group {...frame}>{content}</Group>
          </Layer>
          <Layer name={LAYER_INTERACTION} listening>
            <Group {...frame}>{interaction}</Group>
          </Layer>
        </Stage>
      </div>
    )
  })
)

export type { CanvasStageProps, CanvasStageHandle }
export { CanvasStage }
