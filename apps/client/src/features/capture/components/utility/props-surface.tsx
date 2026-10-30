import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@cogito/design/components/popover'
import { Separator } from '@cogito/design/components/separator'
import { parseSliderValue, Slider } from '@cogito/design/components/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { clsx } from 'clsx'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useState } from 'react'

import { Glide } from '@/components/glide/glide'
import { normalizeHex } from '@/features/capture/components/colors'
import { type GraphicsEnum } from '@/features/capture/components/graphics'
import {
  FILLABLE_GRAPHICS,
  FONTSIZE_GRAPHICS,
  NON_OPACITY_GRAPHICS
} from './constants'

import styles from './utility.module.scss'

interface UtilityPropsSurfaceProps {
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

function UtilityPropsSurface(props: UtilityPropsSurfaceProps) {
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

  const [isTooltipOpen, updateTooltipOpen] = useState(false)
  const visible = active !== null
  const showFilled = active !== null && FILLABLE_GRAPHICS.has(active)
  const showFontSize = active !== null && FONTSIZE_GRAPHICS.has(active)
  const showOpacity = active !== null && !NON_OPACITY_GRAPHICS.has(active)

  function handlePickerOpenChange(next: boolean) {
    setPickerOpen(next)
    if (next) updateTooltipOpen(false)
  }

  return (
    <AnimatePresence>
      {visible && (
        <m.div
          className={styles.row}
          style={{
            transformOrigin: 'top'
          }}
          initial={{
            opacity: 0,
            height: 0,
            overflow: 'hidden'
          }}
          animate={{
            opacity: 1,
            height: 'auto',
            overflow: 'visible'
          }}
          exit={{
            opacity: 0,
            height: 0,
            overflow: 'hidden'
          }}
          transition={{
            duration: 0.15
          }}>
          <Popover
            open={pickerOpen}
            onOpenChange={handlePickerOpenChange}>
            <Tooltip
              open={pickerOpen ? false : isTooltipOpen}
              onOpenChange={function (next) {
                if (!pickerOpen) updateTooltipOpen(next)
              }}>
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
                      <Button
                        key={value}
                        type="button"
                        variant="ghost"
                        size="icon-xs"
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
                <Button
                  key={value}
                  type="button"
                  variant="ghost"
                  size="icon-xs"
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
              onValueChange={function (next: number | readonly number[]) {
                onUpdateThickness(Math.round(parseSliderValue(next)))
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
                  onValueChange={function (next: number | readonly number[]) {
                    onUpdateFontSize(Math.round(parseSliderValue(next)))
                  }}
                />
              </div>
            </>
          )}

          {showOpacity && (
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
                  onValueChange={function (next: number | readonly number[]) {
                    onUpdateOpacity(Math.max(0.05, parseSliderValue(next) / 100))
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

export type { UtilityPropsSurfaceProps }
export { UtilityPropsSurface }
