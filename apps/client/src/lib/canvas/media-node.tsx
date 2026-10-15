import { useEffect, useRef, useState } from 'react'
import { Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'

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
}

/**
 * 将 HTMLVideoElement / HTMLImageElement 绑到 Konva.Image。
 * 视频帧刷新由 useMediaClock / 外部 batchDraw 驱动。
 */
function MediaNode(props: MediaNodeProps) {
  const {
    source,
    x = 0,
    y = 0,
    width,
    height,
    offsetX = 0,
    offsetY = 0,
    scaleX = 1,
    scaleY = 1,
    rotation = 0,
    opacity = 1,
    listening = false,
    name,
    id,
    draggable = false,
    onClick,
    onTap,
    onDragEnd,
    onTransformEnd,
    nodeRef
  } = props

  const imageRef = useRef<Konva.Image>(null)
  const nodeRefFn = useRef(nodeRef)
  nodeRefFn.current = nodeRef
  const [ready, setReady] = useState(false)

  useEffect(function () {
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
  }, [source])

  useEffect(() => {
    nodeRefFn.current?.(imageRef.current)
    return () => nodeRefFn.current?.(null)
  }, [ready])

  if (!source || !ready) return null

  const intrinsicW =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source instanceof HTMLImageElement
        ? source.naturalWidth
        : (source as { width?: number }).width ?? 0
  const intrinsicH =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source instanceof HTMLImageElement
        ? source.naturalHeight
        : (source as { height?: number }).height ?? 0

  return (
    <KonvaImage
      ref={imageRef}
      id={id}
      name={name}
      image={source}
      x={x}
      y={y}
      width={width ?? intrinsicW}
      height={height ?? intrinsicH}
      offsetX={offsetX}
      offsetY={offsetY}
      scaleX={scaleX}
      scaleY={scaleY}
      rotation={rotation}
      opacity={opacity}
      listening={listening}
      draggable={draggable}
      onClick={onClick}
      onTap={onTap}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
    />
  )
}

export type { MediaNodeProps }
export { MediaNode }
