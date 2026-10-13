import { useRef } from 'react'

import styles from './resize-handles.module.scss'

type Corner = 'tl' | 'tr' | 'bl' | 'br'

interface ResizeHandlesProps {
  onResizeStart: () => void
  onResize: (deltaW: number, deltaH: number) => void
  onResizeEnd: () => void
}

function ResizeHandles(props: ResizeHandlesProps) {
  const { onResizeStart, onResize, onResizeEnd } = props
  const dragRef = useRef<{
    corner: Corner
    originX: number
    originY: number
  } | null>(null)

  function handlePointerDown(corner: Corner, e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation()
    e.preventDefault()
    dragRef.current = {
      corner,
      originX: e.clientX,
      originY: e.clientY
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    onResizeStart()
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.originX
    const dy = e.clientY - dragRef.current.originY
    const corner = dragRef.current.corner

    let dw = 0
    let dh = 0

    // 右侧手柄：宽度随 dx 增/减
    if (corner === 'tr' || corner === 'br') {
      dw = dx
    }
    // 左侧手柄：宽度随 dx 反方向变化
    if (corner === 'tl' || corner === 'bl') {
      dw = -dx
    }
    // 底部手柄：高度随 dy 增/减
    if (corner === 'bl' || corner === 'br') {
      dh = dy
    }
    // 顶部手柄：高度随 dy 反方向变化
    if (corner === 'tl' || corner === 'tr') {
      dh = -dy
    }

    onResize(dw, dh)
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch (error) {
      console.debug('[overlay] pointer capture 已经释放过了:', error)
    }
    onResizeEnd()
  }

  const corners: { key: Corner; className: string }[] = [
    { key: 'tl', className: styles.tl },
    { key: 'tr', className: styles.tr },
    { key: 'bl', className: styles.bl },
    { key: 'br', className: styles.br }
  ]

  return (
    <>
      {corners.map(function ({ key, className }) {
        return (
          <div
            key={key}
            className={`${styles.handle} ${className}`}
            onPointerDown={function (e) {
              handlePointerDown(key, e)
            }}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        )
      })}
    </>
  )
}

export { ResizeHandles }
export type { ResizeHandlesProps }
