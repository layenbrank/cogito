import styles from '@/components/glide/glide.module.scss'
import { useResize } from '@/hooks/useResize.ts'
import { clsx, type ClassValue } from 'clsx'

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
}

const Glide = {
  /**
   * 横向滚动容器 — CSS rotation trick 将垂直滚动转为水平滚动
   * 结构: root → wrapper(-90°) → inner(+90°, flex)
   */
  X(props: GlideProps) {
    const [size, updateSize] = useState<DOMRectReadOnly>()

    const properties = useMemo<React.CSSProperties>(
      function () {
        const width = size?.width ?? 0
        const height = size?.height ?? 0
        return {
          // 首帧未测到尺寸时先给占位，避免子项叠在 0×0 里
          '--glide-width': `${width > 0 ? width : 1}px`,
          '--glide-height': `${height > 0 ? height : 36}px`
        }
      },
      [size]
    )

    const nodeRef = useResize<HTMLDivElement>(
      useCallback(function (rect) {
        updateSize(rect)
      }, [])
    )

    return (
      <div
        ref={nodeRef}
        style={{ ...properties, ...props.style, ...props.styles?.root }}
        className={clsx([props.className, props.classNames?.root, styles.glide])}>
        <div
          onScroll={props.onScroll}
          style={props.styles?.wrapper}
          className={clsx([props.classNames?.wrapper, styles.xWrapper])}>
          <div
            style={props.styles?.inner}
            className={clsx([props.classNames?.inner, styles.xInner])}>
            {props.children}
          </div>
        </div>
      </div>
    )
  },

  /**
   * 纵向滚动容器 — 标准垂直滚动
   * 结构: root → wrapper(overflow-y) → inner
   */
  Y(props: GlideProps) {
    return (
      <div
        style={{ ...props.style, ...props.styles?.root }}
        className={clsx([props.className, props.classNames?.root, styles.glide])}>
        <div
          onScroll={props.onScroll}
          style={props.styles?.wrapper}
          className={clsx([props.classNames?.wrapper, styles.yWrapper])}>
          <div
            style={props.styles?.inner}
            className={clsx([props.classNames?.inner, styles.yInner])}>
            {props.children}
          </div>
        </div>
      </div>
    )
  }
}

export { Glide }
