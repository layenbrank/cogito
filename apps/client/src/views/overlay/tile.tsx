import { Icon } from '@iconify/react/offline'
import clsx from 'clsx'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { Suspense, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'

import { ContextMenu, type MenuItem } from '@/components/contextmenu'
import tileStyles from '@/features/magnetic-tile/magnetic-tile.module.scss'
import { findMarkerBox, findTrackPx, LAYOUT_FALLBACK, type MarkerLayout } from '@/features/magnetic-tile/size'
import { buildSurfaceStyle } from '@/features/magnetic-tile/surface-style'
import { useOverlayDrag } from '@/hooks/use-overlay-drag'
import { useThrough } from '@/hooks/use-through'
import { useOverlayStore, type OverlayTile } from '@/stores/overlay'
import { RenderMarker } from '@/views/overlay/markers'
import styles from '@/views/overlay/overlay.module.scss'
import { removeOverlayTile } from '@/features/capture/tauri'

interface TileProps {
  item: OverlayTile
  stageBounds: { width: number; height: number }
}

const DRAG_THRESHOLD = 6
const SIZES: MagneticTile.Size[] = [1, 2, 3, 4]

function SizePicker(props: {
  current: MagneticTile.Size
  layout: MarkerLayout
  onChange: (size: MagneticTile.Size) => void
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 4,
        padding: '6px 8px',
        minWidth: 160
      }}
      onPointerDown={function (e) {
        e.stopPropagation()
      }}>
      {SIZES.map(function (value) {
        const isSelected = value === props.current
        return (
          <button
            key={value}
            type="button"
            aria-label={`大小 ${value}`}
            aria-pressed={isSelected}
            style={{
              appearance: 'none',
              border: 'none',
              borderRadius: 6,
              padding: '6px 0',
              fontSize: 13,
              fontWeight: isSelected ? 600 : 400,
              cursor: 'pointer',
              background: isSelected ? 'rgba(22, 119, 255, 0.12)' : 'transparent',
              color: isSelected ? '#1677ff' : 'inherit',
              transition: 'background 0.15s ease, color 0.15s ease'
            }}
            onClick={function () {
              props.onChange(value)
            }}>
            {value}
          </button>
        )
      })}
    </div>
  )
}

function Tile(props: TileProps) {
  const { item, stageBounds } = props
  const rootRef = useRef<HTMLDivElement>(null)

  const toUpdate = useOverlayStore(function (s) {
    return s.toUpdate
  })
  const toFront = useOverlayStore(function (s) {
    return s.toFront
  })

  useThrough(item.id, { rootRef, enabled: true })

  const {
    handlePointerDown: dragDown,
    handlePointerMove: dragMove,
    handlePointerUp: dragUp,
    handlePointerCancel: dragCancel
  } =
    useOverlayDrag({
      rootRef,
      id: item.id,
      storeX: item.x,
      storeY: item.y,
      elWidth: item.w,
      elHeight: item.h,
      boundsWidth: stageBounds.width,
      boundsHeight: stageBounds.height,
      threshold: DRAG_THRESHOLD,
      onCommit: function (x, y) {
        toUpdate(item.id, { x, y })
      }
    })

  // 挂载时初始化 GSAP transform（仅一次，不干扰拖拽）
  useLayoutEffect(
    function () {
      const el = rootRef.current
      if (!el) return
      gsap.set(el, { x: item.x, y: item.y })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // store x/y 外部变化时同步 GSAP（如 toInitialize 边界修正）
  const prevStoreRef = useRef({ x: item.x, y: item.y })
  useGSAP(
    function () {
      const el = rootRef.current
      if (!el) return
      const prev = prevStoreRef.current
      if (item.x !== prev.x || item.y !== prev.y) {
        prevStoreRef.current = { x: item.x, y: item.y }
        gsap.set(el, { x: item.x, y: item.y })
      }
    },
    { scope: rootRef, dependencies: [item.x, item.y] }
  )

  const layout: MarkerLayout = {
    size: item.size ?? LAYOUT_FALLBACK.size,
    shape: item.shape ?? LAYOUT_FALLBACK.shape,
    direction: item.direction ?? LAYOUT_FALLBACK.direction
  }

  const surfaceStyle = useMemo(
    function () {
      return buildSurfaceStyle({
        round: item.round,
        background: item.background
      })
    },
    [item.round, item.background]
  )

  // 浮层用绝对定位，尺寸由 size/shape/direction 实时计算，不依赖存储的 w/h
  const box = findMarkerBox(layout)

  // GSAP 独占 transform 定位，React 不设置 transform
  const shellStyle = {
    position: 'absolute',
    width: box.w,
    height: box.h,
    zIndex: item.z,
    '--magnetic-tile-round': item.round ?? '12px',
    '--magnetic-tile-size': `${findTrackPx(layout.size)}px`
  } as CSSProperties

  const menuItems = useMemo<MenuItem[]>(
    function () {
      const markerLayout: MarkerLayout = {
        size: item.size ?? LAYOUT_FALLBACK.size,
        shape: item.shape ?? LAYOUT_FALLBACK.shape,
        direction: item.direction ?? LAYOUT_FALLBACK.direction
      }

      return [
        {
          key: 'size',
          label: '大小',
          icon: (
            <Icon
              icon="ant-design:appstore-outlined"
              width={14}
              height={14}
            />
          ),
          content: (
            <SizePicker
              current={markerLayout.size}
              layout={markerLayout}
              onChange={function (value) {
                const box = findMarkerBox({
                  size: value,
                  shape: markerLayout.shape,
                  direction: markerLayout.direction
                })
                toUpdate(item.id, { w: box.w, h: box.h, size: value })
              }}
            />
          )
        },
        {
          key: 'float-unmount',
          label: '移除',
          icon: (
            <Icon
              icon="ant-design:minus-outlined"
              width={14}
              height={14}
            />
          ),
          onSelect() {
            void removeOverlayTile(item.magneticTileID)
          }
        }
      ]
    },
    [
      item.id,
      item.magneticTileID,
      item.size,
      item.shape,
      item.direction,
      toUpdate
    ]
  )

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    toFront(item.id)
    dragDown(e)
  }

  return (
    <ContextMenu items={menuItems}>
      <div
        ref={rootRef}
        className={clsx(styles.tile, 'magnetic-tile', tileStyles.magneticTile)}
        data-region="false"
        style={shellStyle}
        onPointerDown={handlePointerDown}
        onPointerMove={dragMove}
        onPointerUp={dragUp}
        onPointerCancel={dragCancel}>
        <Suspense
          fallback={
            <div
              className={clsx('magnetic-tile-surface', tileStyles.surface)}
              style={{
                ...surfaceStyle,
                background: 'rgba(0, 0, 0, 0.04)'
              }}
            />
          }>
          <div
            className={clsx('magnetic-tile-surface', tileStyles.surface)}
            style={surfaceStyle}>
            {RenderMarker(item.kind, {
              size: layout.size,
              shape: layout.shape,
              direction: layout.direction,
              title: item.title,
              mark: item.mark
            })}
          </div>
        </Suspense>
      </div>
    </ContextMenu>
  )
}

export default Tile
export { Tile }
