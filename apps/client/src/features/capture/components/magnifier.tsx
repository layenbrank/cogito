import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useEffect, useRef, useState } from 'react'
import { copyText } from '@/features/capture/clipboard'
import styles from './magnifier.module.scss'

/** 放大镜显示尺寸（px） */
const SIZE = 172
/** 放大倍数 */
const ZOOM = 8
/** 采样源尺寸 = 显示尺寸 / 放大倍数 */
const SOURCE_SIZE = SIZE / ZOOM
/** 距离鼠标偏移 */
const OFFSET = 20

type ColorFormat = 'hex' | 'rgb'

interface MagnifierProps {
  /** 采样底图（一般是当前屏幕截图） */
  sourceImage: HTMLImageElement | null
  /** 是否可见 */
  visible: boolean
  /** 点击关闭回调 */
  onClose?: () => void
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  )
}

function computePos(px: number, py: number) {
  let left = px + OFFSET
  let top = py + OFFSET
  if (left + SIZE + 40 > window.innerWidth) left = px - SIZE - OFFSET
  if (top + SIZE + 104 > window.innerHeight) top = py - SIZE - OFFSET - 84
  return { left, top }
}

/**
 * 放大镜：跟随鼠标、显示像素级放大、十字准星、当前坐标与中心像素颜色。
 * - Shift 切换 HEX / RGB 格式
 * - C 复制当前颜色值
 */
export default function Magnifier({ sourceImage, visible }: MagnifierProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const posRef = useRef<{ x: number; y: number } | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [rgb, setRgb] = useState<[number, number, number] | null>(null)
  const [colorFormat, setColorFormat] = useState<ColorFormat>('hex')
  const [copied, setCopied] = useState(false)
  const rafRef = useRef(0)

  if (!visible && (pos !== null || rgb !== null)) {
    setPos(null)
    setRgb(null)
  }

  function paint(samplePos: { x: number; y: number }) {
    const canvas = canvasRef.current
    if (!canvas || !sourceImage) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, SIZE, SIZE)
    const scaleX = sourceImage.naturalWidth / window.innerWidth
    const scaleY = sourceImage.naturalHeight / window.innerHeight
    const sx = samplePos.x * scaleX - SOURCE_SIZE / 2
    const sy = samplePos.y * scaleY - SOURCE_SIZE / 2
    ctx.drawImage(sourceImage, sx, sy, SOURCE_SIZE, SOURCE_SIZE, 0, 0, SIZE, SIZE)
    try {
      const data = ctx.getImageData(SIZE / 2, SIZE / 2, 1, 1).data
      const next: [number, number, number] = [data[0], data[1], data[2]]
      setRgb(function (prev) {
        if (prev && prev[0] === next[0] && prev[1] === next[1] && prev[2] === next[2]) {
          return prev
        }
        return next
      })
    } catch {
      setRgb(function (prev) {
        return prev === null ? prev : null
      })
    }
  }

  useEffect(
    function () {
      if (!visible) {
        posRef.current = null
        return
      }

      function onMove(e: MouseEvent) {
        const next = { x: e.clientX, y: e.clientY }
        const prev = posRef.current
        if (prev && prev.x === next.x && prev.y === next.y) return
        posRef.current = next
        cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(function () {
          const current = posRef.current
          if (!current) return
          setPos(function (p) {
            if (p && p.x === current.x && p.y === current.y) return p
            return current
          })
          paint(current)
        })
      }

      window.addEventListener('mousemove', onMove)
      return function () {
        window.removeEventListener('mousemove', onMove)
        cancelAnimationFrame(rafRef.current)
      }
    },
    // sourceImage 仅用于 paint 闭包；可见性变化时重绑即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, sourceImage]
  )

  useEffect(
    function () {
      if (!visible) return
      function onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Shift') {
          setColorFormat(function (f) {
            return f === 'hex' ? 'rgb' : 'hex'
          })
        }
        if (e.key === 'c' || e.key === 'C') {
          e.preventDefault()
          e.stopPropagation()
          const current = posRef.current
          if (!current || !rgb) return
          const text =
            colorFormat === 'hex'
              ? rgbToHex(rgb[0], rgb[1], rgb[2])
              : `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
          void copyText(text)
            .then(function () {
              setCopied(true)
            })
            .catch(function (err) {
              console.warn('[Magnifier] Clipboard write failed:', err)
            })
        }
      }
      window.addEventListener('keydown', onKeyDown)
      return function () {
        window.removeEventListener('keydown', onKeyDown)
      }
    },
    [visible, rgb, colorFormat]
  )

  useEffect(
    function () {
      if (!copied) return
      const timeoutId = setTimeout(function () {
        setCopied(false)
      }, 1500)
      return function () {
        clearTimeout(timeoutId)
      }
    },
    [copied]
  )

  const color = rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : 'transparent'
  const displayColor = rgb
    ? colorFormat === 'hex'
      ? rgbToHex(rgb[0], rgb[1], rgb[2])
      : `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
    : '—'
  const layout = pos ? computePos(pos.x, pos.y) : null

  return (
    <AnimatePresence>
      {visible && pos && layout && (
        <m.div
          className={styles.magnifier}
          style={{ left: layout.left, top: layout.top, width: SIZE, pointerEvents: 'none' }}
          initial={{ opacity: 0, scale: 0.82 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.82 }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}>
          <div className={styles.magnifierCanvasWrap}>
            <canvas
              ref={canvasRef}
              width={SIZE}
              height={SIZE}
              className={styles.magnifierCanvas}
            />
            <div className={styles.crosshairV} />
            <div className={styles.crosshairH} />
            <div className={styles.centerPixel} />
          </div>

          <div className={styles.magnifierPanel}>
            <div className={styles.magnifierColorRow}>
              <span
                className={styles.colorSwatch}
                style={{ backgroundColor: color }}
              />
              <div className={styles.colorTextWrap}>
                <span className={styles.colorText}>{displayColor}</span>
              </div>
            </div>

            <div className={styles.magnifierMeta}>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>POS</span>
                <span className={styles.metaValue}>
                  {Math.round(pos.x)}, {Math.round(pos.y)}
                </span>
              </div>
            </div>

            <div className={styles.magnifierHints}>
              {copied ? (
                <div className={styles.copiedBanner}>✓ 已复制</div>
              ) : (
                <div className={styles.hintsRow}>
                  <span className={styles.hintItem}>
                    <kbd className={styles.kbd}>Shift</kbd>
                    <span>{colorFormat === 'hex' ? 'RGB' : 'HEX'}</span>
                  </span>
                  <span className={styles.hintItem}>
                    <kbd className={styles.kbd}>C</kbd>
                    <span>复制</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  )
}
