import { Button } from '@cogito/design/components/button'
import { FormItem } from '@cogito/design/components/form'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, PointerEvent } from 'react'
import { useController, type Control } from 'react-hook-form'

import { DerivedRamp, PresetRamps } from './color-ramps'
import {
  hsvToHex,
  parseHexColor,
  parseHsv,
  parseRgb,
  readColor,
  rgbToHex,
  TEXT_COLOR,
  type ColorFieldName,
  type Hsv,
  type RgbChannel
} from './colors.ts'
import type { FormValues } from './form'

interface ColorPaletteProps {
  control: Control<FormValues>
  themePrimary: string
}

interface ColorDraft {
  key: 'hex' | RgbChannel
  text: string
}

interface FieldHexes {
  color: string
  textColor: string
}

const HUE_GRADIENT =
  'linear-gradient(to bottom, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)'

const COLOR_CHANNELS: Array<{ key: RgbChannel; label: string; name: string }> = [
  { key: 'r', label: 'R', name: '红' },
  { key: 'g', label: 'G', name: '绿' },
  { key: 'b', label: 'B', name: '蓝' }
]

function squareStyle(hue: number): CSSProperties {
  return {
    backgroundColor: `hsl(${hue}, 100%, 50%)`,
    backgroundImage:
      'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)'
  }
}

function readOffset(event: PointerEvent<HTMLDivElement>, node: HTMLDivElement) {
  const rect = node.getBoundingClientRect()
  const x = rect.width === 0 ? 0 : (event.clientX - rect.left) / rect.width
  const y = rect.height === 0 ? 0 : (event.clientY - rect.top) / rect.height
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y))
  }
}

function isAchromatic(hsv: Hsv) {
  return hsv.s < 0.001 || hsv.v < 0.001
}

function releaseTextFocus() {
  const node = document.activeElement
  if (node instanceof HTMLInputElement) node.blur()
}

function ColorPalette(props: ColorPaletteProps) {
  const background = useController({
    control: props.control,
    name: 'color',
    rules: { required: '背景颜色是必填的!' }
  })
  const text = useController({
    control: props.control,
    name: 'textColor',
    rules: { required: '文字颜色是必填的!' }
  })

  const backgroundHex = readColor(background.field.value, props.themePrimary)
  const textHex = readColor(text.field.value, TEXT_COLOR)
  const [active, updateActive] = useState<ColorFieldName>('color')
  const [hsvByField, updateHsvByField] = useState(function () {
    return {
      color: parseHsv(backgroundHex),
      textColor: parseHsv(textHex)
    }
  })
  const [priors, updatePriors] = useState<FieldHexes>(function () {
    return { color: backgroundHex, textColor: textHex }
  })
  const [draft, updateDraft] = useState<ColorDraft | null>(null)
  const committedRef = useRef<FieldHexes>({ color: backgroundHex, textColor: textHex })
  const hsvRef = useRef(hsvByField)
  const isGesturing = useRef(false)
  const didSnapshot = useRef(false)

  const currentHex = active === 'color' ? backgroundHex : textHex
  const hsv = hsvByField[active]
  const priorHex = priors[active]
  const rgb = parseRgb(currentHex)

  useEffect(
    function () {
      const next: FieldHexes = { color: backgroundHex, textColor: textHex }
      const fields: ColorFieldName[] = ['color', 'textColor']
      for (const field of fields) {
        if (committedRef.current[field] === next[field]) continue
        committedRef.current[field] = next[field]
        const parsed = parseHsv(next[field])
        hsvRef.current = {
          ...hsvRef.current,
          [field]: {
            h: isAchromatic(parsed) ? hsvRef.current[field].h : parsed.h,
            s: parsed.s,
            v: parsed.v
          }
        }
        updatePriors(function (prev) {
          return { ...prev, [field]: next[field] }
        })
        updateHsvByField(hsvRef.current)
      }
    },
    [backgroundHex, textHex]
  )

  function noteEdit() {
    if (!isGesturing.current || didSnapshot.current) return
    didSnapshot.current = true
    const hex = committedRef.current[active]
    updatePriors(function (prev) {
      return { ...prev, [active]: hex }
    })
  }

  function commitHex(hex: string) {
    const parsed = parseHexColor(hex)
    if (!parsed || parsed === committedRef.current[active]) return
    noteEdit()
    const parsedHsv = parseHsv(parsed)
    hsvRef.current = {
      ...hsvRef.current,
      [active]: {
        h: isAchromatic(parsedHsv) ? hsvRef.current[active].h : parsedHsv.h,
        s: parsedHsv.s,
        v: parsedHsv.v
      }
    }
    updateHsvByField(hsvRef.current)
    committedRef.current[active] = parsed
    if (active === 'color') background.field.onChange(parsed)
    else text.field.onChange(parsed)
  }

  function commitHsv(next: Hsv) {
    const hex = hsvToHex(next)
    hsvRef.current = { ...hsvRef.current, [active]: next }
    updateHsvByField(hsvRef.current)
    if (hex === committedRef.current[active]) return
    noteEdit()
    committedRef.current[active] = hex
    if (active === 'color') background.field.onChange(hex)
    else text.field.onChange(hex)
  }

  function beginGesture() {
    isGesturing.current = true
  }

  function endGesture() {
    if (!isGesturing.current) return
    isGesturing.current = false
    didSnapshot.current = false
    if (active === 'color') background.field.onBlur()
    else text.field.onBlur()
  }

  function onPickField(value: string[]) {
    const next = value[0]
    if (next !== 'color' && next !== 'textColor') return
    if (next === active) return
    releaseTextFocus()
    endGesture()
    updateDraft(null)
    updateActive(next)
  }

  function onRestorePrior() {
    if (priorHex === currentHex) return
    updatePriors(function (prev) {
      return { ...prev, [active]: currentHex }
    })
    commitHex(priorHex)
  }

  function onPickHex(hex: string) {
    releaseTextFocus()
    updateDraft(null)
    beginGesture()
    commitHex(hex)
    endGesture()
  }

  function paintSquare(node: HTMLDivElement, event: PointerEvent<HTMLDivElement>) {
    const offset = readOffset(event, node)
    const current = hsvRef.current[active]
    commitHsv({ h: current.h, s: offset.x, v: 1 - offset.y })
  }

  function paintHue(node: HTMLDivElement, event: PointerEvent<HTMLDivElement>) {
    const offset = readOffset(event, node)
    const current = hsvRef.current[active]
    commitHsv({ h: Math.min(359.999, offset.y * 360), s: current.s, v: current.v })
  }

  function onSquarePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    releaseTextFocus()
    updateDraft(null)
    beginGesture()
    paintSquare(event.currentTarget, event)
  }

  function onHuePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    releaseTextFocus()
    updateDraft(null)
    beginGesture()
    paintHue(event.currentTarget, event)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>, paint: typeof paintSquare) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    paint(event.currentTarget, event)
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    endGesture()
  }

  function onHexFocus() {
    beginGesture()
    updateDraft({ key: 'hex', text: currentHex })
  }

  function onHexChange(event: ChangeEvent<HTMLInputElement>) {
    const text = event.target.value
      .toUpperCase()
      .replace(/[^#0-9A-F]/g, '')
      .slice(0, 7)
    updateDraft({ key: 'hex', text })
    const body = text.replace('#', '')
    const parsed = parseHexColor(text)
    if (parsed && body.length === 6) commitHex(parsed)
  }

  function onHexBlur() {
    const pending = draft?.key === 'hex' ? draft.text : null
    updateDraft(null)
    if (pending) {
      const parsed = parseHexColor(pending)
      if (parsed) commitHex(parsed)
    }
    endGesture()
  }

  function onChannelFocus(key: RgbChannel) {
    beginGesture()
    updateDraft({ key, text: String(rgb[key]) })
  }

  function onChannelChange(key: RgbChannel, event: ChangeEvent<HTMLInputElement>) {
    const text = event.target.value
    if (!/^\d{0,3}$/.test(text)) return
    if (text !== '' && Number(text) > 255) return
    updateDraft({ key, text })
    if (text === '') return
    const next = parseRgb(committedRef.current[active])
    next[key] = Number(text)
    commitHex(rgbToHex(next))
  }

  function onChannelBlur() {
    updateDraft(null)
    endGesture()
  }

  const activeError = (active === 'color' ? background.fieldState.error : text.fieldState.error)
    ?.message
  const otherError = (active === 'color' ? text.fieldState.error : background.fieldState.error)
    ?.message

  return (
    <FormItem>
      <div className="flex items-center justify-between gap-2">
        <Label>颜色</Label>
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[active]}
          onValueChange={onPickField}>
          <ToggleGroupItem
            type="button"
            value="color"
            aria-label="背景颜色"
            className="gap-1.5 px-2">
            <span
              aria-hidden
              className="size-3 rounded-sm border border-border"
              style={{ backgroundColor: backgroundHex }}
            />
            背景
          </ToggleGroupItem>
          <ToggleGroupItem
            type="button"
            value="textColor"
            aria-label="文字颜色"
            className="gap-1.5 px-2">
            <span
              aria-hidden
              className="size-3 rounded-sm border border-border"
              style={{ backgroundColor: textHex }}
            />
            文字
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <PresetRamps
        activeHex={currentHex}
        onPick={onPickHex}
      />

      <div className="flex gap-2">
        <div
          aria-label="饱和度与明度"
          className="relative size-40 cursor-crosshair touch-none"
          onPointerDown={onSquarePointerDown}
          onPointerMove={function (event) {
            onPointerMove(event, paintSquare)
          }}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-md border border-border"
            style={squareStyle(hsv.h)}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background ring-1 ring-foreground"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
          />
        </div>
        <div
          aria-label="色相"
          className="relative h-40 w-11 shrink-0 cursor-ns-resize touch-none"
          onPointerDown={onHuePointerDown}
          onPointerMove={function (event) {
            onPointerMove(event, paintHue)
          }}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-1/2 w-3.5 -translate-x-1/2 rounded-md border border-border"
            style={{ backgroundImage: HUE_GRADIENT }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 h-2 w-[calc(0.875rem+2px)] -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-background ring-1 ring-foreground"
            style={{ top: `${(hsv.h / 360) * 100}%` }}
          />
        </div>
      </div>

      <DerivedRamp
        activeHex={currentHex}
        onPick={onPickHex}
      />

      <div className="flex items-center gap-2">
        <div className="flex h-7 shrink-0 overflow-hidden rounded-md border border-border">
          <div
            role="img"
            aria-label="当前颜色"
            title={currentHex}
            className="h-full w-7"
            style={{ backgroundColor: currentHex }}
          />
          <Button
            type="button"
            variant="outline"
            aria-label="上一次颜色"
            title={priorHex}
            className="h-7 w-7 rounded-none border-0 border-l border-border p-0"
            style={{ backgroundColor: priorHex }}
            onClick={function () {
              onRestorePrior()
            }}
          />
        </div>
        <Input
          value={draft?.key === 'hex' ? draft.text : currentHex}
          aria-label="十六进制"
          spellCheck={false}
          autoComplete="off"
          className="h-7 font-mono text-xs uppercase"
          onFocus={onHexFocus}
          onChange={onHexChange}
          onBlur={onHexBlur}
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        {COLOR_CHANNELS.map(function (channel) {
          return (
            <div
              key={channel.key}
              className="flex items-center gap-1">
              {/* w-4：w-3 会把 B 的右半裁进输入框，看起来像 R */}
              <span className="w-4 shrink-0 text-center text-xs font-medium text-foreground">
                {channel.label}
              </span>
              <Input
                value={draft?.key === channel.key ? draft.text : String(rgb[channel.key])}
                inputMode="numeric"
                aria-label={channel.name}
                className="h-7 px-1 text-center text-xs tabular-nums"
                onFocus={function () {
                  onChannelFocus(channel.key)
                }}
                onChange={function (event) {
                  onChannelChange(channel.key, event)
                }}
                onBlur={onChannelBlur}
              />
            </div>
          )
        })}
      </div>

      {activeError ? <p className="text-sm text-destructive">{activeError}</p> : null}
      {otherError ? <p className="text-sm text-destructive">{otherError}</p> : null}
    </FormItem>
  )
}

export type { ColorPaletteProps }
export { ColorPalette }
