import { Icon } from '@iconify/react/offline'
import { Popover, PopoverContent, PopoverTrigger } from '@i-thinking/design/components/popover'
import { Separator } from '@i-thinking/design/components/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@i-thinking/design/components/tooltip'
import { clsx } from 'clsx'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'

import { Glide } from '@/components/glide/glide'
import { normalizeHex } from '@/features/capture/components/colors'
import { type GraphicsEnum } from '@/features/capture/components/graphics'
import {
  FILLABLE_GRAPHICS,
  FONTSIZE_GRAPHICS,
  NON_OPACITY_GRAPHICS
} from './constants'

import styles from './utility.module.scss'

interface UtilityPropsPanelProps {
  active: GraphicsEnum | null
  color: string
  thickness: number
  filled: boolean
  opacity: number
  fontSize: number
  pickerOpen: boolean
  setPickerOpen: (open: boolean) => void
  presetHues: string[]
  mainColor: string
  derivedShades: string[]
  isCustomColor: boolean
  setPinnedMainColor: (color: string) => void
  onUpdateColor: (color: string) => void
  onUpdateThickness: (thickness: number) => void
  onUpdateFilled: (filled: boolean) => void
  onUpdateOpacity: (opacity: number) => void
  onUpdateFontSize: (fontSize: number) => void
}

function UtilityPropsPanel(props: UtilityPropsPanelProps) {
  const {
    active,
    color,
    thickness,
    filled,
    opacity,
    fontSize,
    pickerOpen,
    setPickerOpen,
    presetHues,
    mainColor,
    derivedShades,
    isCustomColor,
    setPinnedMainColor,
    onUpdateColor,
    onUpdateThickness,
    onUpdateFilled,
    onUpdateOpacity,
    onUpdateFontSize
  } = props

  const visible = active !== null
  const showFilled = active !== null && FILLABLE_GRAPHICS.has(active)
  const showFontSize = active !== null && FONTSIZE_GRAPHICS.has(active)
  const showOpacity = active !== null && !NON_OPACITY_GRAPHICS.has(active)

  return (
    <AnimatePresence>
      {visible && (
        <m.div
          className={styles.row}
          style={{
            transformOrigin: 'top',
            overflow: 'hidden'
          }}
          initial={{
            opacity: 0,
            scaleY: 0
          }}
          animate={{
            opacity: 1,
            scaleY: 1
          }}
          exit={{
            opacity: 0,
            scaleY: 0
          }}
          transition={{
            duration: 0.15
          }}>
          <Popover
            open={pickerOpen}
            onOpenChange={setPickerOpen}>
            <Tooltip open={pickerOpen ? false : undefined}>
              <TooltipTrigger
                render={
                  <PopoverTrigger
                    render={
                      <m.button
                        type="button"
                        className={clsx(styles.color, styles.palette, {
                          [styles.active]: isCustomColor || pickerOpen
                        })}
                        whileTap={{ scale: 0.85 }}
                        animate={{ scale: pickerOpen ? 1.1 : 1 }}
                        transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                        style={{ background: isCustomColor ? color : 'transparent' }}
                      />
                    }
                  />
                }>
                {!isCustomColor && (
                  <Icon
                    icon="mdi:palette-outline"
                    width={18}
                    height={18}
                  />
                )}
              </TooltipTrigger>
              <TooltipContent>自定义颜色</TooltipContent>
            </Tooltip>
            <PopoverContent
              align="start"
              className="w-auto">
              <div className={styles.panelStack}>
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
                        style={{
                          background: value
                        }}
                      />
                    )
                  })}
                </Glide.X>
                <Separator />
                <input
                  type="color"
                  aria-label="自定义颜色"
                  value={color}
                  className="border-border bg-background h-7 w-full cursor-pointer rounded-md border p-0.5"
                  onChange={function (event) {
                    onUpdateColor(normalizeHex(event.target.value))
                  }}
                />
              </div>
            </PopoverContent>
          </Popover>

          <div className={styles.shades}>
            {derivedShades.map(function (value) {
              return (
                <button
                  key={value}
                  title={value}
                  className={clsx(styles.shade, {
                    [styles.active]: color.toUpperCase() === value.toUpperCase()
                  })}
                  onClick={function () {
                    onUpdateColor(value)
                  }}
                  style={{
                    background: value
                  }}
                />
              )
            })}
          </div>

          <div className={styles.separator} />

          <div
            className={clsx(styles.ensemble, styles.compact)}
            title={`粗细 ${Math.round(thickness)}`}>
            <Icon
              icon="mdi:format-line-weight"
              width={14}
              height={14}
            />
            <input
              type="range"
              className={styles.thickness}
              min={1}
              max={16}
              step={1}
              value={thickness}
              aria-label="粗细"
              onChange={function (event) {
                onUpdateThickness(Math.round(Number(event.target.value)))
              }}
            />
          </div>

          {showFilled && (
            <>
              <div className={styles.separator} />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <m.button
                      type="button"
                      className={clsx(styles.button, { [styles.active]: filled })}
                      whileTap={{ scale: 0.9 }}
                      onClick={function () {
                        onUpdateFilled(!filled)
                      }}
                    />
                  }>
                  <Icon
                    icon={filled ? 'mdi:format-color-fill' : 'mdi:format-color-highlight'}
                    width={18}
                    height={18}
                  />
                </TooltipTrigger>
                <TooltipContent>{filled ? '取消填充' : '填充'}</TooltipContent>
              </Tooltip>
            </>
          )}

          {showFontSize && (
            <>
              <div className={styles.separator} />
              <div
                className={clsx(styles.ensemble, styles.compact)}
                title={`字号 ${Math.round(fontSize)}`}>
                <Icon
                  icon="mdi:format-size"
                  width={14}
                  height={14}
                />
                <input
                  type="range"
                  className={styles.fontSize}
                  min={10}
                  max={64}
                  step={1}
                  value={fontSize}
                  aria-label="字号"
                  onChange={function (event) {
                    onUpdateFontSize(Math.round(Number(event.target.value)))
                  }}
                />
              </div>
            </>
          )}

          {showOpacity && (
            <>
              <div className={styles.separator} />
              <div
                className={clsx(styles.ensemble, styles.compact)}
                title={`不透明度 ${Math.round(opacity * 100)}%`}>
                <Icon
                  icon="mdi:opacity"
                  width={14}
                  height={14}
                />
                <input
                  type="range"
                  className={styles.opacity}
                  min={5}
                  max={100}
                  step={1}
                  value={Math.round(opacity * 100)}
                  aria-label="不透明度"
                  onChange={function (event) {
                    onUpdateOpacity(Math.max(0.05, Number(event.target.value) / 100))
                  }}
                />
              </div>
            </>
          )}
        </m.div>
      )}
    </AnimatePresence>
  )
}

export type { UtilityPropsPanelProps }
export { UtilityPropsPanel }
