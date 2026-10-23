import { Icon } from '@iconify/react/offline'
import { parseSliderValue, Slider } from '@cogito/design/components/slider'
import { clsx } from 'clsx'
import { AnimatePresence, motion } from 'motion/react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Glide } from '@/components/glide/glide'
import {
  generateDerivedShades,
  parsePresetHues
} from './colors'
import { type GraphicsEnum } from './graphics-geometry'

import styles from './utility.module.scss'

interface UtilityOption {
  type: GraphicsEnum
  label: string
  icon: string
}

interface UtilityProps {
  selection: { x: number; y: number; w: number; h: number } | null
  active: GraphicsEnum | null
  color: string
  thickness: number
  filled: boolean
  opacity: number
  fontSize: number
  canUndo: boolean
  canRedo: boolean
  onUpdateUtility: (shape: GraphicsEnum | null) => void
  onUpdateColor: (color: string) => void
  onUpdateThickness: (thickness: number) => void
  onUpdateFilled: (filled: boolean) => void
  onUpdateOpacity: (opacity: number) => void
  onUpdateFontSize: (fontSize: number) => void
  onUndo: () => void
  onRedo: () => void
  onCopy: () => void
  onPin: () => void
  onSave: () => void
  onClose: () => void
  onRefresh: () => void
}

const FILLABLE_GRAPHICS = new Set<GraphicsEnum>(['rect', 'ellipse'])
const FONTSIZE_GRAPHICS = new Set<GraphicsEnum>(['text', 'index'])
const NON_OPACITY_GRAPHICS = new Set<GraphicsEnum>(['mosaic', 'blur', 'spotlight'])
const THEME_PRIMARY = '#4080ff'

const UTILITIES: UtilityOption[] = [
  { type: 'rect', label: '矩形', icon: 'mdi:rectangle-outline' },
  { type: 'ellipse', label: '圆形', icon: 'mdi:circle-outline' },
  { type: 'arrow', label: '箭头', icon: 'mdi:arrow-top-right-thin' },
  { type: 'line', label: '线条', icon: 'mdi:minus' },
  { type: 'text', label: '文字', icon: 'mdi:format-text' },
  { type: 'freehand', label: '画笔', icon: 'mdi:draw' },
  { type: 'mosaic', label: '马赛克', icon: 'mdi:meteor' },
  { type: 'index', label: '序号', icon: 'mdi:numeric' },
  { type: 'highlight', label: '荧光笔', icon: 'mdi:marker' },
  { type: 'blur', label: '模糊', icon: 'mdi:blur' },
  { type: 'spotlight', label: '聚光灯', icon: 'mdi:spotlight' }
]

export default function Utility(props: UtilityProps) {
  const {
    active,
    canRedo,
    canUndo,
    color,
    filled,
    fontSize,
    opacity,
    selection,
    thickness,
    onUpdateColor,
    onUpdateFilled,
    onUpdateFontSize,
    onUpdateOpacity,
    onRedo,
    onRefresh,
    onCopy,
    onPin,
    onSave,
    onUpdateThickness,
    onUndo,
    onUpdateUtility
  } = props

  const [pinnedMainColor, setPinnedMainColor] = useState(color)
  const visible = active !== null
  const showFilled = active !== null && FILLABLE_GRAPHICS.has(active)
  const showFontSize = active !== null && FONTSIZE_GRAPHICS.has(active)
  const showOpacity = active !== null && !NON_OPACITY_GRAPHICS.has(active)

  const presetHues = useMemo(function () {
    return parsePresetHues(THEME_PRIMARY)
  }, [])

  const presetMatch = useMemo(
    function () {
      return (
        presetHues.find(function (c) {
          return c.toUpperCase() === color.toUpperCase()
        }) ?? null
      )
    },
    [color, presetHues]
  )
  const mainColor = presetMatch ?? pinnedMainColor

  const derivedShades = useMemo(
    function () {
      return generateDerivedShades(mainColor)
    },
    [mainColor]
  )

  const isCustomColor =
    !presetHues.some(function (c) {
      return c.toUpperCase() === color.toUpperCase()
    }) &&
    !derivedShades.some(function (c) {
      return c.toUpperCase() === color.toUpperCase()
    })

  const containerRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  useLayoutEffect(
    function () {
      if (!selection) return
      const node = containerRef.current
      if (!node) return
      const GAP = 8
      const rect = node.getBoundingClientRect()
      const W = window.innerWidth
      const H = window.innerHeight
      let top = selection.y + selection.h + GAP
      if (top + rect.height + GAP > H) {
        const above = selection.y - rect.height - GAP
        top = above >= GAP ? above : Math.max(GAP, H - rect.height - GAP)
      }
      let left = selection.x
      if (left + rect.width + GAP > W) left = W - rect.width - GAP
      if (left < GAP) left = GAP
      setPosition(function (prev) {
        if (prev.top === top && prev.left === left) return prev
        return { top, left }
      })
    },
    [selection, active]
  )

  return (
    <AnimatePresence>
      {selection ? (
        <motion.div
          ref={containerRef}
          className={styles.utility}
          data-region="false"
          style={{
            top: position.top,
            left: position.left,
            pointerEvents: 'all'
          }}
          initial={{ y: 6, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, scale: 1, opacity: 1 }}
          exit={{ y: 4, opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          onMouseDown={function (e) {
            e.stopPropagation()
          }}>
          <div className={styles.row}>
            <div className={styles.ensemble}>
              {UTILITIES.map(function (utility) {
                return (
                  <motion.button
                    key={utility.type}
                    type="button"
                    title={utility.label}
                    className={clsx(styles.button, {
                      [styles.active]: active === utility.type
                    })}
                    whileTap={{ scale: 0.9 }}
                    onClick={function () {
                      onUpdateUtility(active === utility.type ? null : utility.type)
                    }}>
                    <Icon
                      icon={utility.icon}
                      width={18}
                      height={18}
                    />
                  </motion.button>
                )
              })}
            </div>

            <div className={styles.separator} />

            <div className={styles.ensemble}>
              <motion.button
                type="button"
                className={styles.button}
                title="撤销 Ctrl+Z"
                disabled={!canUndo}
                whileTap={{ scale: 0.9 }}
                onClick={onUndo}>
                <Icon
                  icon="mdi:undo-variant"
                  width={18}
                  height={18}
                />
              </motion.button>
              <motion.button
                type="button"
                className={styles.button}
                title="重做 Ctrl+Y"
                disabled={!canRedo}
                whileTap={{ scale: 0.9 }}
                onClick={onRedo}>
                <Icon
                  icon="mdi:redo-variant"
                  width={18}
                  height={18}
                />
              </motion.button>
            </div>

            <div className={styles.separator} />

            <div className={styles.ensemble}>
              <motion.button
                type="button"
                className={styles.button}
                title="重选"
                whileTap={{ scale: 0.9 }}
                onClick={onRefresh}>
                <Icon
                  icon="mdi:refresh"
                  width={18}
                  height={18}
                />
              </motion.button>
              <motion.button
                type="button"
                className={styles.button}
                title="复制"
                whileTap={{ scale: 0.9 }}
                onClick={onCopy}>
                <Icon
                  icon="mdi:content-copy"
                  width={18}
                  height={18}
                />
              </motion.button>
              <motion.button
                type="button"
                className={styles.button}
                title="贴图"
                whileTap={{ scale: 0.9 }}
                onClick={onPin}>
                <Icon
                  icon="mdi:pin"
                  width={18}
                  height={18}
                />
              </motion.button>
              <motion.button
                type="button"
                className={styles.button}
                title="保存"
                whileTap={{ scale: 0.9 }}
                onClick={onSave}>
                <Icon
                  icon="mdi:content-save-outline"
                  width={18}
                  height={18}
                />
              </motion.button>
            </div>
          </div>

          <AnimatePresence>
            {visible ? (
              <motion.div
                className={styles.row}
                initial={{ height: 0, opacity: 0, overflow: 'hidden' }}
                animate={{ opacity: 1, height: 'auto', overflow: 'visible' }}
                exit={{ height: 0, opacity: 0, overflow: 'hidden' }}
                transition={{ duration: 0.15 }}>
                <label
                  className={clsx(styles.color, styles.palette, {
                    [styles.active]: isCustomColor
                  })}
                  title="自定义颜色"
                  style={{
                    background: isCustomColor ? color : 'transparent',
                    position: 'relative',
                    overflow: 'hidden'
                  }}>
                  {!isCustomColor ? (
                    <Icon
                      icon="mdi:palette-outline"
                      width={18}
                      height={18}
                    />
                  ) : null}
                  <input
                    type="color"
                    value={color}
                    aria-label="自定义颜色"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      opacity: 0,
                      cursor: 'pointer'
                    }}
                    onChange={function (event) {
                      onUpdateColor(event.target.value.toUpperCase())
                    }}
                  />
                </label>

                <Glide.X
                  classNames={{
                    root: styles.presetRow,
                    inner: styles.presetTrack
                  }}>
                  {presetHues.map(function (value) {
                    return (
                      <button
                        key={value}
                        type="button"
                        title={value}
                        className={clsx(styles.color, {
                          [styles.active]: mainColor.toUpperCase() === value.toUpperCase()
                        })}
                        onClick={function () {
                          setPinnedMainColor(value)
                          onUpdateColor(value)
                        }}
                        style={{ background: value }}
                      />
                    )
                  })}
                </Glide.X>

                <div className={styles.shades}>
                  {derivedShades.map(function (value) {
                    return (
                      <button
                        key={value}
                        type="button"
                        title={value}
                        className={clsx(styles.shade, {
                          [styles.active]: color.toUpperCase() === value.toUpperCase()
                        })}
                        onClick={function () {
                          onUpdateColor(value)
                        }}
                        style={{ background: value }}
                      />
                    )
                  })}
                </div>

                <div className={styles.separator} />

                <div className={clsx(styles.ensemble, styles.compact)}>
                  <Icon
                    icon="mdi:format-line-weight"
                    width={14}
                    height={14}
                  />
                  <Slider
                    className={styles.thickness}
                    min={1}
                    max={16}
                    step={1}
                    value={[thickness]}
                    aria-label="粗细"
                    onValueChange={function (next) {
                      onUpdateThickness(Math.round(parseSliderValue(next)))
                    }}
                  />
                </div>

                {showFilled ? (
                  <>
                    <div className={styles.separator} />
                    <motion.button
                      type="button"
                      className={clsx(styles.button, { [styles.active]: filled })}
                      title={filled ? '取消填充' : '填充'}
                      whileTap={{ scale: 0.9 }}
                      onClick={function () {
                        onUpdateFilled(!filled)
                      }}>
                      <Icon
                        icon={filled ? 'mdi:format-color-fill' : 'mdi:format-color-highlight'}
                        width={18}
                        height={18}
                      />
                    </motion.button>
                  </>
                ) : null}

                {showFontSize ? (
                  <>
                    <div className={styles.separator} />
                    <div className={clsx(styles.ensemble, styles.compact)}>
                      <Icon
                        icon="mdi:format-size"
                        width={14}
                        height={14}
                      />
                      <Slider
                        className={styles.fontSize}
                        min={10}
                        max={64}
                        step={1}
                        value={[fontSize]}
                        aria-label="字号"
                        onValueChange={function (next) {
                          onUpdateFontSize(Math.round(parseSliderValue(next)))
                        }}
                      />
                    </div>
                  </>
                ) : null}

                {showOpacity ? (
                  <>
                    <div className={styles.separator} />
                    <div className={clsx(styles.ensemble, styles.compact)}>
                      <Icon
                        icon="mdi:opacity"
                        width={14}
                        height={14}
                      />
                      <Slider
                        className={styles.opacity}
                        min={5}
                        max={100}
                        step={1}
                        value={[Math.round(opacity * 100)]}
                        aria-label="不透明度"
                        tooltip={{
                          formatter(value) {
                            return `${Math.round(value)}%`
                          }
                        }}
                        onValueChange={function (next) {
                          onUpdateOpacity(Math.max(0.05, parseSliderValue(next) / 100))
                        }}
                      />
                    </div>
                  </>
                ) : null}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
