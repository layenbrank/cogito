import { useEffect, useMemo, useRef, useState } from 'react'
import { Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'

import {
  isGradeNeutral,
  toCanvasFilter,
  toKonvaGrade,
  type Grade
} from '@/lib/canvas/grade'
import { findDevicePixelRatio } from '@/lib/canvas/metrics'

interface MediaNodeProps {
  /** 隐藏的 HTMLVideoElement 或已加载的 HTMLImageElement */
  source: CanvasImageSource | null
  x?: number
  y?: number
  width?: number
  height?: number
  offsetX?: number
  offsetY?: number
  scaleX?: number
  scaleY?: number
  rotation?: number
  opacity?: number
  listening?: boolean
  name?: string
  id?: string
  draggable?: boolean
  onClick?(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void
  onTap?(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void
  onDragEnd?(event: Konva.KonvaEventObject<DragEvent>): void
  onTransformEnd?(event: Konva.KonvaEventObject<Event>): void
  /** 挂到节点 ref，供 Transformer 附着 */
  nodeRef?(node: Konva.Image | null): void
  /** 非中性时静图走 Konva 滤镜，视频走离屏 canvas */
  grade?: Grade
}

const VIDEO_FILTER_MAX_EDGE = 1280

function paintVideoGrade(
  video: HTMLVideoElement,
  grade: Grade,
  canvas: HTMLCanvasElement,
  draw: CanvasRenderingContext2D
) {
  if (video.videoWidth <= 0) return
  const pixel = grade.pixelSize ?? 0
  let dw = video.videoWidth
  let dh = video.videoHeight
  const edge = Math.max(dw, dh)
  if (edge > VIDEO_FILTER_MAX_EDGE) {
    const shrink = VIDEO_FILTER_MAX_EDGE / edge
    dw = Math.round(dw * shrink)
    dh = Math.round(dh * shrink)
  }
  if (pixel > 1) {
    dw = Math.max(1, Math.round(dw / pixel))
    dh = Math.max(1, Math.round(dh / pixel))
  }
  if (canvas.width !== dw) canvas.width = dw
  if (canvas.height !== dh) canvas.height = dh
  draw.filter = toCanvasFilter(grade)
  draw.drawImage(video, 0, 0, dw, dh)
  draw.filter = 'none'
}

function findSourceSize(source: CanvasImageSource) {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight }
  }
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight }
  }
  const sized = source as { width?: number; height?: number }
  return { width: sized.width ?? 0, height: sized.height ?? 0 }
}

function useSourceReady(source: CanvasImageSource | null) {
  const [ready, setReady] = useState(false)

  useEffect(
    function () {
      if (!source) {
        setReady(function (prev) {
          return prev ? false : prev
        })
        return
      }

      if (source instanceof HTMLVideoElement) {
        const video = source
        function markReady() {
          if (video.videoWidth > 0) {
            setReady(function (prev) {
              return prev ? prev : true
            })
          }
        }
        markReady()
        video.addEventListener('loadeddata', markReady)
        video.addEventListener('loadedmetadata', markReady)
        return function () {
          video.removeEventListener('loadeddata', markReady)
          video.removeEventListener('loadedmetadata', markReady)
        }
      }

      if (source instanceof HTMLImageElement) {
        if (source.complete && source.naturalWidth > 0) {
          setReady(function (prev) {
            return prev ? prev : true
          })
          return
        }
        function onLoad() {
          setReady(function (prev) {
            return prev ? prev : true
          })
        }
        source.addEventListener('load', onLoad)
        return function () {
          source.removeEventListener('load', onLoad)
        }
      }

      setReady(function (prev) {
        return prev ? prev : true
      })
      return
    },
    [source]
  )

  return ready
}

function useVideoGradeCanvas(
  source: CanvasImageSource | null,
  videoGrade: Grade | null,
  imageRef: { current: Konva.Image | null }
) {
  const filterCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [filterCanvas, setFilterCanvas] = useState<HTMLCanvasElement | null>(null)

  useEffect(
    function () {
      if (!videoGrade || !(source instanceof HTMLVideoElement)) return
      const video = source
      const grade = videoGrade
      const canvas = filterCanvasRef.current ?? document.createElement('canvas')
      filterCanvasRef.current = canvas
      const context = canvas.getContext('2d')
      if (!context) return
      const draw = context
      let frameHandle = 0
      let stopped = false

      function paint() {
        paintVideoGrade(video, grade, canvas, draw)
        imageRef.current?.getLayer()?.batchDraw()
      }

      function onFrame() {
        if (stopped) return
        paint()
        frameHandle = video.requestVideoFrameCallback(onFrame)
      }

      paint()
      setFilterCanvas(canvas)
      video.addEventListener('seeked', paint)
      if (typeof video.requestVideoFrameCallback === 'function') {
        frameHandle = video.requestVideoFrameCallback(onFrame)
      }
      return function () {
        stopped = true
        video.removeEventListener('seeked', paint)
        if (frameHandle) video.cancelVideoFrameCallback(frameHandle)
      }
    },
    [videoGrade, source, imageRef]
  )

  return videoGrade ? filterCanvas : null
}

interface MediaFrame {
  x: number
  y: number
  width?: number
  height?: number
  offsetX: number
  offsetY: number
  scaleX: number
  scaleY: number
  rotation: number
  opacity: number
  listening: boolean
  draggable: boolean
}

function findMediaFrame(props: MediaNodeProps): MediaFrame {
  return {
    x: props.x ?? 0,
    y: props.y ?? 0,
    width: props.width,
    height: props.height,
    offsetX: props.offsetX ?? 0,
    offsetY: props.offsetY ?? 0,
    scaleX: props.scaleX ?? 1,
    scaleY: props.scaleY ?? 1,
    rotation: props.rotation ?? 0,
    opacity: props.opacity ?? 1,
    listening: props.listening ?? false,
    draggable: props.draggable ?? false
  }
}

function useStillGradeCache(
  imageRef: { current: Konva.Image | null },
  stillGrade: ReturnType<typeof toKonvaGrade> | null,
  ready: boolean,
  width?: number,
  height?: number
) {
  useEffect(
    function () {
      const node = imageRef.current
      if (!node || !stillGrade) {
        node?.clearCache()
        return
      }
      const raf = requestAnimationFrame(function () {
        node.cache({ pixelRatio: Math.min(2, findDevicePixelRatio()) })
        node.getLayer()?.batchDraw()
      })
      return function () {
        cancelAnimationFrame(raf)
        node.clearCache()
      }
    },
    [stillGrade, ready, width, height, imageRef]
  )
}

interface MediaNodeViewProps {
  source: CanvasImageSource
  frame: MediaFrame
  size: { width: number; height: number }
  stillGrade: ReturnType<typeof toKonvaGrade> | null
  imageRef: { current: Konva.Image | null }
  id?: string
  name?: string
  onClick?: MediaNodeProps['onClick']
  onTap?: MediaNodeProps['onTap']
  onDragEnd?: MediaNodeProps['onDragEnd']
  onTransformEnd?: MediaNodeProps['onTransformEnd']
}

function MediaNodeView(props: MediaNodeViewProps) {
  const frame = props.frame
  return (
    <KonvaImage
      ref={props.imageRef}
      id={props.id}
      name={props.name}
      image={props.source}
      filters={props.stillGrade?.filters}
      brightness={props.stillGrade?.brightness}
      contrast={props.stillGrade?.contrast}
      saturation={props.stillGrade?.saturation}
      hue={props.stillGrade?.hue}
      blurRadius={props.stillGrade?.blurRadius}
      pixelSize={props.stillGrade?.pixelSize}
      x={frame.x}
      y={frame.y}
      width={frame.width ?? props.size.width}
      height={frame.height ?? props.size.height}
      offsetX={frame.offsetX}
      offsetY={frame.offsetY}
      scaleX={frame.scaleX}
      scaleY={frame.scaleY}
      rotation={frame.rotation}
      opacity={frame.opacity}
      listening={frame.listening}
      draggable={frame.draggable}
      onClick={props.onClick}
      onTap={props.onTap}
      onDragEnd={props.onDragEnd}
      onTransformEnd={props.onTransformEnd}
    />
  )
}

/**
 * 将 HTMLVideoElement / HTMLImageElement 绑到 Konva.Image。
 * 视频帧刷新由 useMediaClock / 外部 batchDraw 驱动。
 */
function MediaNode(props: MediaNodeProps) {
  const imageRef = useRef<Konva.Image>(null)
  const nodeRefFn = useRef(props.nodeRef)
  const ready = useSourceReady(props.source)
  const isVideo = props.source instanceof HTMLVideoElement
  const stillGrade = useMemo(
    function () {
      if (!props.grade || isVideo || isGradeNeutral(props.grade)) return null
      return toKonvaGrade(props.grade)
    },
    [props.grade, isVideo]
  )
  const videoGrade =
    props.grade && isVideo && !isGradeNeutral(props.grade) ? props.grade : null
  const shownCanvas = useVideoGradeCanvas(props.source, videoGrade, imageRef)

  useEffect(
    function () {
      nodeRefFn.current = props.nodeRef
    },
    [props.nodeRef]
  )

  useEffect(
    function () {
      nodeRefFn.current?.(imageRef.current)
      return function () {
        nodeRefFn.current?.(null)
      }
    },
    [ready]
  )

  useStillGradeCache(imageRef, stillGrade, ready, props.width, props.height)

  if (!props.source || !ready) return null
  if (videoGrade && !shownCanvas) return null

  return (
    <MediaNodeView
      imageRef={imageRef}
      source={shownCanvas ?? props.source}
      frame={findMediaFrame(props)}
      size={findSourceSize(props.source)}
      stillGrade={stillGrade}
      id={props.id}
      name={props.name}
      onClick={props.onClick}
      onTap={props.onTap}
      onDragEnd={props.onDragEnd}
      onTransformEnd={props.onTransformEnd}
    />
  )
}

export type { MediaNodeProps }
export { MediaNode }
