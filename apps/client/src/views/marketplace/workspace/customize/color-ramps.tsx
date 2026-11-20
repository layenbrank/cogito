import { Button } from '@cogito/design/components/button'
import type { ReactNode } from 'react'

import { Glide } from '@/components/glide/glide'
import { PRESET_RAMPS, buildDerivedRamp, type RampStop } from './colors.ts'

interface RampPickProps {
  activeHex: string
  onPick: (hex: string) => void
}

interface SwatchProps {
  hex: string
  label: string
  isSelected: boolean
  onPick: (hex: string) => void
}

function Swatch(props: SwatchProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={props.label}
      aria-pressed={props.isSelected}
      title={props.hex}
      className="rounded-md p-0"
      style={{
        backgroundColor: props.hex,
        boxShadow: props.isSelected
          ? 'inset 0 0 0 2px var(--background), inset 0 0 0 4px var(--foreground)'
          : 'inset 0 0 0 1px var(--border)'
      }}
      onClick={function () {
        props.onPick(props.hex)
      }}
    />
  )
}

function RampGlide(props: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1">
      <span className="text-xs font-medium text-foreground/75">{props.label}</span>
      <div
        role="group"
        aria-label={props.label}
        className="min-w-0">
        <Glide.X
          className="h-7 w-full"
          styles={{ inner: { gap: '0px', alignItems: 'center' } }}>
          {props.children}
        </Glide.X>
      </div>
    </div>
  )
}

function PresetRamps(props: RampPickProps) {
  return (
    <RampGlide label="预设">
      {PRESET_RAMPS.map(function (stops: RampStop[], index) {
        const name = stops[0]?.name ?? ''
        return (
          <div
            key={name}
            role="group"
            aria-label={`${name}色阶`}
            className="flex shrink-0 items-center">
            {index > 0 ? (
              <span
                aria-hidden
                className="bg-border mx-1.5 h-4 w-px"
              />
            ) : null}
            <div className="flex gap-0.5">
              {stops.map(function (stop, index) {
                return (
                  <Swatch
                    key={`${name}-${index}`}
                    hex={stop.hex}
                    label={`${name} ${stop.hex}`}
                    isSelected={stop.hex === props.activeHex}
                    onPick={props.onPick}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </RampGlide>
  )
}

function DerivedRamp(props: RampPickProps) {
  const stops = buildDerivedRamp(props.activeHex)

  return (
    <RampGlide label="衍生">
      <div className="flex gap-0.5">
        {stops.map(function (hex, index) {
          const isSeed = index === Math.floor(stops.length / 2)
          return (
            <Swatch
              key={`${index}-${hex}`}
              hex={hex}
              label={isSeed ? `当前 ${hex}` : hex}
              isSelected={hex === props.activeHex}
              onPick={props.onPick}
            />
          )
        })}
      </div>
    </RampGlide>
  )
}

export type { RampPickProps }
export { DerivedRamp, PresetRamps }
