// @ts-nocheck
import type { RefObject } from 'react'

interface ImageResizeHandlesProps {
  leftRef: RefObject<HTMLButtonElement | null>
  rightRef: RefObject<HTMLButtonElement | null>
  onStartResize: (handle: 'left' | 'right', clientX: number) => void
}

function ImageResizeHandles(props: ImageResizeHandlesProps) {
  return (
    <>
      <button
        type="button"
        ref={props.leftRef}
        aria-label="Resize image from left"
        className="tiptap-image-handle tiptap-image-handle-left"
        onMouseDown={function (event) {
          event.preventDefault()
          event.stopPropagation()
          props.onStartResize('left', event.clientX)
        }}
        onTouchStart={function (event) {
          event.preventDefault()
          const touch = event.touches[0]
          if (touch) props.onStartResize('left', touch.clientX)
        }}
      />
      <button
        type="button"
        ref={props.rightRef}
        aria-label="Resize image from right"
        className="tiptap-image-handle tiptap-image-handle-right"
        onMouseDown={function (event) {
          event.preventDefault()
          event.stopPropagation()
          props.onStartResize('right', event.clientX)
        }}
        onTouchStart={function (event) {
          event.preventDefault()
          const touch = event.touches[0]
          if (touch) props.onStartResize('right', touch.clientX)
        }}
      />
    </>
  )
}

export { ImageResizeHandles }
