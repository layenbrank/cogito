import { useResize } from '@cogito/hooks'
import { clsx, type ClassValue } from 'clsx'
import { useCallback, useMemo, useState } from 'react'

import styles from './glide.module.scss'

interface GlideProps {
  children: React.ReactNode
  className?: ClassValue
  classNames?: {
    root?: ClassValue
    wrapper?: ClassValue
    inner?: ClassValue
  }
  style?: React.CSSProperties
  styles?: {
    root?: React.CSSProperties
    wrapper?: React.CSSProperties
    inner?: React.CSSProperties
  }
  onScroll?: (event: React.UIEvent<HTMLDivElement, UIEvent>) => void
  wrapperRef?: React.Ref<HTMLDivElement>
}

const Glide = {
  /**
   * 横向滚动：把纵向滚轮旋成横向。尺寸跟父级走，父级被分栏拖动时会重测。
   * 结构: root → wrapper(-90°) → inner(+90°, flex)
   */
  X(props: GlideProps) {
    const [size, updateSize] = useState<DOMRectReadOnly>()

    const properties = useMemo<React.CSSProperties>(
      function () {
        return {
          '--glide-width': size ? `${size.width}px` : '0px',
          '--glide-height': size ? `${size.height}px` : '0px'
        }
      },
      [size]
    )

    const onResize = useCallback(function (rect: DOMRectReadOnly) {
      updateSize(function (prev) {
        if (prev && prev.width === rect.width && prev.height === rect.height) return prev
        return rect
      })
    }, [])

    const nodeRef = useResize<HTMLDivElement>(onResize)

    return (
      <div
        ref={nodeRef}
        style={{ ...properties, ...props.style, ...props.styles?.root }}
        className={clsx(props.className, props.classNames?.root, styles.glide)}>
        <div
          ref={props.wrapperRef}
          onScroll={props.onScroll}
          style={props.styles?.wrapper}
          className={clsx(props.classNames?.wrapper, styles.xWrapper)}>
          <div
            style={props.styles?.inner}
            className={clsx(props.classNames?.inner, styles.xInner)}>
            {props.children}
          </div>
        </div>
      </div>
    )
  },

  /**
   * 纵向滚动。根节点撑满父级，才能放进可拖拽分栏而不把栏撑高。
   * 结构: root → wrapper(overflow-y) → inner
   */
  Y(props: GlideProps) {
    return (
      <div
        style={{ ...props.style, ...props.styles?.root }}
        className={clsx(props.className, props.classNames?.root, styles.glide)}>
        <div
          ref={props.wrapperRef}
          onScroll={props.onScroll}
          style={props.styles?.wrapper}
          className={clsx(props.classNames?.wrapper, styles.yWrapper)}>
          <div
            style={props.styles?.inner}
            className={clsx(props.classNames?.inner, styles.yInner)}>
            {props.children}
          </div>
        </div>
      </div>
    )
  }
}

export { Glide }
