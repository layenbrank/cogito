import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import type Konva from 'konva'
import { useEffect, useRef, useState } from 'react'
import { Ellipse, Group, Image as KonvaImage, Layer, Rect, Stage, Text } from 'react-konva'
import useImage from 'use-image'

import { useMorphStore } from '@/stores/morph.ts'
import styles from './canvas.module.scss'
import { TOOL_COLORS, SELECTION_STROKE } from './colors.ts'

const ZOOM_MIN = 0.25
const ZOOM_MAX = 5
const ZOOM_WHEEL_STEP = 0.1
/** 渲染倍率：高于 CSS 像素以保持清晰；舞台尺寸需除回该值 */
const RENDER_PIXEL_RATIO = 2
const PAGE_OBSERVER_ROOT_MARGIN = '200px 0px'

// ─── Layer 1: PDF Image ───────────────────────────────────────────────────────

function PdfLayer({
  render,
  width,
  height
}: {
  render: Morph.Render | undefined
  width: number
  height: number
}) {
  const src = render ? `data:image/png;base64,${render.base64}` : ''
  const [image] = useImage(src)
  return (
    <KonvaImage
      image={image}
      width={width}
      height={height}
    />
  )
}

// ─── Layer 2: Annotations ─────────────────────────────────────────────────────

function AnnotationLayer({
  annotations,
  stageW,
  stageH,
  selectedId,
  onSelect
}: {
  annotations: Morph.Annotation[]
  stageW: number
  stageH: number
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  return (
    <>
      {annotations.map((ann) => {
        const x = ann.rect.x * stageW
        const y = ann.rect.y * stageH
        const w = ann.rect.w * stageW
        const h = ann.rect.h * stageH
        const isSelected = ann.id === selectedId

        if (ann.type === 'highlight') {
          const d = ann.data as Morph.Highlight
          return (
            <Rect
              key={ann.id}
              x={x}
              y={y}
              width={w}
              height={h}
              fill={d.color}
              opacity={d.opacity}
              stroke={isSelected ? SELECTION_STROKE : undefined}
              strokeWidth={isSelected ? 1 : 0}
              onClick={(e) => {
                e.cancelBubble = true
                onSelect(ann.id)
              }}
            />
          )
        }

        if (ann.type === 'shape') {
          const d = ann.data as Morph.Shape
          const fill = d.fill === 'none' ? 'transparent' : d.fill
          const stroke = isSelected ? SELECTION_STROKE : d.stroke
          if (d.kind === 'ellipse') {
            return (
              <Ellipse
                key={ann.id}
                x={x + w / 2}
                y={y + h / 2}
                radiusX={w / 2}
                radiusY={h / 2}
                stroke={stroke}
                fill={fill}
                strokeWidth={d.strokeWidth}
                opacity={d.opacity}
                onClick={(e) => {
                  e.cancelBubble = true
                  onSelect(ann.id)
                }}
              />
            )
          }
          return (
            <Rect
              key={ann.id}
              x={x}
              y={y}
              width={w}
              height={h}
              stroke={stroke}
              fill={fill}
              strokeWidth={d.strokeWidth}
              opacity={d.opacity}
              onClick={(e) => {
                e.cancelBubble = true
                onSelect(ann.id)
              }}
            />
          )
        }

        if (ann.type === 'text-note') {
          const d = ann.data as Morph.TextNote
          return (
            <Group
              key={ann.id}
              onClick={(e) => {
                e.cancelBubble = true
                onSelect(ann.id)
              }}>
              <Rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill="rgba(255,255,200,0.85)"
                stroke={isSelected ? SELECTION_STROKE : '#ccc'}
                strokeWidth={1}
                cornerRadius={3}
              />
              <Text
                x={x + 4}
                y={y + 4}
                width={w - 8}
                height={h - 8}
                text={d.content}
                fontSize={d.fontSize}
                fill={d.color}
                fontFamily={d.fontFamily}
                wrap="word"
                ellipsis={true}
              />
            </Group>
          )
        }

        if (ann.type === 'stamp') {
          const d = ann.data as Morph.Stamp
          return (
            <Group
              key={ann.id}
              onClick={(e) => {
                e.cancelBubble = true
                onSelect(ann.id)
              }}>
              <Rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill="transparent"
                stroke={isSelected ? SELECTION_STROKE : d.color}
                strokeWidth={2}
                cornerRadius={4}
              />
              <Text
                x={x}
                y={y}
                width={w}
                height={h}
                text={d.label}
                fontSize={16}
                fill={d.color}
                align="center"
                verticalAlign="middle"
              />
            </Group>
          )
        }

        return null
      })}
    </>
  )
}

// ─── Draft shape while drawing ────────────────────────────────────────────────

interface DraftRect {
  x: number
  y: number
  width: number
  height: number
}

function DraftLayer({ draft, tool }: { draft: DraftRect | null; tool: Morph.Tool }) {
  if (!draft) return null
  const color = TOOL_COLORS[tool]

  if (tool === 'highlight') {
    return (
      <Rect
        {...draft}
        fill={color}
        opacity={0.35}
        listening={false}
      />
    )
  }

  if (tool === 'shape' || tool === 'text' || tool === 'stamp') {
    return (
      <Rect
        {...draft}
        fill="transparent"
        stroke={color}
        strokeWidth={1.5}
        dash={[4, 3]}
        listening={false}
      />
    )
  }

  return null
}

// ─── Per-page stage ───────────────────────────────────────────────────────────

type PageStageProps = {
  offset: number
  stageW: number
  stageH: number
  render: Morph.Render | undefined
  annotations: Morph.Annotation[]
  activeTool: Morph.Tool
  selectedId: string | null
  isCursorCrosshair: boolean
  onSelect: (id: string | null) => void
  onAddAnnotation: (
    partial: Omit<Morph.Annotation, 'id' | 'path' | 'createdAt' | 'updatedAt'>
  ) => Promise<void>
}

function PageStage({
  offset,
  stageW,
  stageH,
  render,
  annotations,
  activeTool,
  selectedId,
  isCursorCrosshair,
  onSelect,
  onAddAnnotation
}: PageStageProps) {
  const drawStart = useRef<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<DraftRect | null>(null)

  function handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (activeTool === 'select') {
      if (e.target === e.target.getStage()) onSelect(null)
      return
    }
    if (!['highlight', 'shape', 'text', 'stamp'].includes(activeTool)) return
    const pos = e.target.getStage()!.getPointerPosition()!
    drawStart.current = pos
    setDraft({ x: pos.x, y: pos.y, width: 0, height: 0 })
  }

  function handleMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!drawStart.current) return
    const pos = e.target.getStage()!.getPointerPosition()!
    const { x: sx, y: sy } = drawStart.current
    setDraft({
      x: Math.min(sx, pos.x),
      y: Math.min(sy, pos.y),
      width: Math.abs(pos.x - sx),
      height: Math.abs(pos.y - sy)
    })
  }

  function cancelDraw() {
    drawStart.current = null
    setDraft(null)
  }

  async function handleMouseUp() {
    if (!draft || !drawStart.current) return
    const { x, y, width, height } = draft
    drawStart.current = null
    setDraft(null)

    const nx = x / stageW
    const ny = y / stageH
    const nw = width / stageW
    const nh = height / stageH

    if (activeTool === 'stamp') {
      const stampW = Math.max(nw, 0.14)
      const stampH = Math.max(nh, 0.07)
      await onAddAnnotation({
        offset,
        type: 'stamp',
        rect: { x: nx, y: ny, w: stampW, h: stampH },
        data: { label: '已核验', color: TOOL_COLORS.stamp }
      })
      return
    }

    if (width < 4 || height < 4) return

    if (activeTool === 'highlight') {
      await onAddAnnotation({
        offset,
        type: 'highlight',
        rect: { x: nx, y: ny, w: nw, h: nh },
        data: { color: TOOL_COLORS.highlight, opacity: 0.4 }
      })
    } else if (activeTool === 'shape') {
      await onAddAnnotation({
        offset,
        type: 'shape',
        rect: { x: nx, y: ny, w: nw, h: nh },
        data: {
          kind: 'rect',
          stroke: TOOL_COLORS.shape,
          fill: 'none',
          strokeWidth: 2,
          opacity: 1
        }
      })
    } else if (activeTool === 'text') {
      await onAddAnnotation({
        offset,
        type: 'text-note',
        rect: { x: nx, y: ny, w: nw, h: nh },
        data: {
          content: '',
          fontSize: 14,
          color: '#000000',
          fontFamily: 'sans-serif'
        }
      })
    }
  }

  return (
    <div
      className={styles.pageWrapper}
      style={{
        width: stageW,
        height: stageH,
        cursor: isCursorCrosshair ? 'crosshair' : 'default'
      }}>
      {!render ? (
        <div className={styles.placeholder}>
          <span className={styles.loadingDot} />
        </div>
      ) : (
        <Stage
          width={stageW}
          height={stageH}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={cancelDraw}>
          <Layer>
            <PdfLayer
              render={render}
              width={stageW}
              height={stageH}
            />
          </Layer>
          <Layer>
            <AnnotationLayer
              annotations={annotations}
              stageW={stageW}
              stageH={stageH}
              selectedId={selectedId}
              onSelect={onSelect}
            />
            <DraftLayer
              draft={draft}
              tool={activeTool}
            />
          </Layer>
        </Stage>
      )}
    </div>
  )
}

// ─── Main Canvas ──────────────────────────────────────────────────────────────

export default function Canvas() {
  const file = useMorphStore(function (s) {
    return s.file
  })
  const offset = useMorphStore(function (s) {
    return s.offset
  })
  const seekSource = useMorphStore(function (s) {
    return s.seekSource
  })
  const zoom = useMorphStore(function (s) {
    return s.zoom
  })
  const activeTool = useMorphStore(function (s) {
    return s.activeTool
  })
  const renders = useMorphStore(function (s) {
    return s.renders
  })
  const annotations = useMorphStore(function (s) {
    return s.annotations
  })
  const selectedId = useMorphStore(function (s) {
    return s.selectedId
  })
  const toSelectAnnotation = useMorphStore(function (s) {
    return s.toSelectAnnotation
  })
  const toAddAnnotation = useMorphStore(function (s) {
    return s.toAddAnnotation
  })
  const toOpenFilePicker = useMorphStore(function (s) {
    return s.toOpenFilePicker
  })
  const toZoomTo = useMorphStore(function (s) {
    return s.toZoomTo
  })
  const toSeekOffset = useMorphStore(function (s) {
    return s.toSeekOffset
  })
  const toWarmOffsets = useMorphStore(function (s) {
    return s.toWarmOffsets
  })

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const slotRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const zoomRef = useRef(zoom)
  const offsetRef = useRef(offset)
  const ignoreScrollSync = useRef(false)

  useEffect(
    function () {
      zoomRef.current = zoom
      offsetRef.current = offset
    },
    [zoom, offset]
  )

  const pageWidth = file?.width ?? 595
  const pageHeight = file?.height ?? 842
  const count = file?.count ?? 0
  /* 只按路径变化重挂副作用：file 对象本身每次 store 更新都会换引用 */
  const filePath = file?.path ?? null
  const isCursorCrosshair = ['highlight', 'shape', 'text', 'stamp'].includes(activeTool)

  function slotSize(slot: number): { width: number; height: number } {
    const render = renders[slot]
    if (render) {
      return {
        width: Math.round(render.width / RENDER_PIXEL_RATIO),
        height: Math.round(render.height / RENDER_PIXEL_RATIO)
      }
    }
    return {
      width: Math.round(pageWidth * zoom),
      height: Math.round(pageHeight * zoom)
    }
  }

  // Ctrl/Meta + wheel zoom
  useEffect(
    function () {
      const root = scrollRef.current
      if (!root) return

      let raf = 0
      let pending: number | null = null

      function flushZoom() {
        raf = 0
        if (pending === null) return
        toZoomTo(pending)
        pending = null
      }

      function onWheel(event: WheelEvent) {
        if (!event.ctrlKey && !event.metaKey) return
        event.preventDefault()
        const direction = event.deltaY > 0 ? -1 : 1
        const next = Math.round((zoomRef.current + direction * ZOOM_WHEEL_STEP) * 100) / 100
        const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
        if (clamped === zoomRef.current && pending === null) return
        zoomRef.current = clamped
        pending = clamped
        if (!raf) raf = requestAnimationFrame(flushZoom)
      }

      root.addEventListener('wheel', onWheel, { passive: false })
      return function () {
        root.removeEventListener('wheel', onWheel)
        if (raf) cancelAnimationFrame(raf)
      }
    },
    [toZoomTo, file?.path]
  )

  // Lazy render pages entering viewport
  useEffect(
    function () {
      const root = scrollRef.current
      if (!root || !filePath) return

      const observer = new IntersectionObserver(
        function (entries) {
          const visible: number[] = []
          for (const entry of entries) {
            if (!entry.isIntersecting) continue
            const raw = (entry.target as HTMLElement).dataset.offset
            if (raw === undefined) continue
            const index = Number(raw)
            if (!Number.isFinite(index)) continue
            visible.push(index)
            if (index > 0) visible.push(index - 1)
            if (index < count - 1) visible.push(index + 1)
          }
          if (visible.length) void toWarmOffsets(visible)
        },
        {
          root,
          rootMargin: PAGE_OBSERVER_ROOT_MARGIN,
          threshold: 0.01
        }
      )

      const slots = root.querySelectorAll<HTMLElement>('[data-offset]')
      slots.forEach(function (el) {
        observer.observe(el)
      })

      return function () {
        observer.disconnect()
      }
    },
    [filePath, count, zoom, toWarmOffsets]
  )

  // Scroll → offset (viewport center)
  useEffect(
    function () {
      const root = scrollRef.current
      if (!root || !filePath) return

      let raf = 0

      function syncCurrentFromScroll() {
        raf = 0
        if (ignoreScrollSync.current) return
        const rootRect = root!.getBoundingClientRect()
        const midY = rootRect.top + rootRect.height / 2
        let bestIndex = offsetRef.current
        let bestDist = Infinity

        slotRefs.current.forEach(function (el, index) {
          const rect = el.getBoundingClientRect()
          const center = rect.top + rect.height / 2
          const dist = Math.abs(center - midY)
          if (dist < bestDist) {
            bestDist = dist
            bestIndex = index
          }
        })

        if (bestIndex !== offsetRef.current) {
          toSeekOffset(bestIndex, { source: 'scroll' })
        }
      }

      function onScroll() {
        if (raf) return
        raf = requestAnimationFrame(syncCurrentFromScroll)
      }

      root.addEventListener('scroll', onScroll, { passive: true })
      return function () {
        root.removeEventListener('scroll', onScroll)
        if (raf) cancelAnimationFrame(raf)
      }
    },
    [filePath, toSeekOffset]
  )

  // Toolbar / thumb → scrollIntoView
  useEffect(
    function () {
      if (!filePath) return
      if (seekSource === 'scroll' || seekSource === null) return
      const el = slotRefs.current.get(offset)
      if (!el) return

      ignoreScrollSync.current = true
      el.scrollIntoView({ block: 'start', behavior: 'smooth' })
      const timer = window.setTimeout(function () {
        ignoreScrollSync.current = false
      }, 400)
      return function () {
        window.clearTimeout(timer)
        ignoreScrollSync.current = false
      }
    },
    [offset, seekSource, filePath]
  )

  // Reset scroll when switching files
  useEffect(
    function () {
      const root = scrollRef.current
      if (!root) return
      root.scrollTop = 0
    },
    [file?.path]
  )

  if (!file) {
    return (
      <div className={clsx(styles.canvas)}>
        <div className={styles.empty}>
          <Button
            variant="ghost"
            type="button"
            className={styles.emptyCta}
            onClick={toOpenFilePicker}>
            <Icon
              icon="ant-design:folder-open-outlined"
              width={14}
              height={14}
            />
            打开 PDF
          </Button>
          <p className={styles.emptyHint}>选择本地 PDF 开始浏览或批注</p>
        </div>
      </div>
    )
  }

  return (
    <div className={clsx(styles.canvas)}>
      <div
        ref={scrollRef}
        className={styles.scroll}>
        <div className={styles.pagesStack}>
          {Array.from({ length: count }, function (_, slot) {
            const { width: stageW, height: stageH } = slotSize(slot)
            const render = renders[slot]
            const slotAnns = annotations.filter(function (a) {
              return a.offset === slot
            })
            return (
              <div
                key={slot}
                ref={function (node) {
                  if (node) slotRefs.current.set(slot, node)
                  else slotRefs.current.delete(slot)
                }}
                className={styles.pageSlot}
                data-offset={slot}>
                <PageStage
                  offset={slot}
                  stageW={stageW}
                  stageH={stageH}
                  render={render}
                  annotations={slotAnns}
                  activeTool={activeTool}
                  selectedId={selectedId}
                  isCursorCrosshair={isCursorCrosshair}
                  onSelect={toSelectAnnotation}
                  onAddAnnotation={toAddAnnotation}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
