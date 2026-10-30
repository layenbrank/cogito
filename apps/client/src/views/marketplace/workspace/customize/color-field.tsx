import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@cogito/design/components/form'
import { Popover, PopoverContent, PopoverTrigger } from '@cogito/design/components/popover'
import { cn } from 'cn'
import { useLayoutEffect, useRef } from 'react'

import { Glide } from '@/components/glide/glide'
import { normalizeHex } from '@/utils/color'
import { type ColorFieldName } from '@/views/marketplace/workspace/customize/colors.ts'
import {
  PRESET_SWATCH_CLASS,
  SWATCH_SIZE_CLASS
} from '@/views/marketplace/workspace/customize/form'

interface ColorFieldProps {
  name: ColorFieldName
  label: string
  shades: string[]
  hues: string[]
  value: string | undefined
  fallback: string
  onPick: (color: string) => void
}

function ColorField(props: ColorFieldProps) {
  const current = normalizeHex(props.value || props.fallback)
  const activeRef = useRef<HTMLButtonElement | null>(null)

  useLayoutEffect(
    function () {
      const node = activeRef.current
      if (!node) return
      node.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest'
      })
    },
    [current]
  )

  return (
    <FormField
      name={props.name}
      rules={{ required: `${props.label}是必填的!` }}
      render={function ({ field }) {
        return (
          <FormItem>
            <FormLabel>{props.label}</FormLabel>
            <div className="flex min-w-0 items-center gap-2">
              <div
                role="radiogroup"
                aria-label={props.label}
                className="min-w-0 flex-1">
                <Glide.X
                  className="h-11 w-full"
                  styles={{ inner: { gap: '0.5rem' } }}>
                  {props.shades.map(function (color) {
                    const isSelected = current === normalizeHex(color)
                    return (
                      <Button
                        key={color}
                        ref={
                          isSelected
                            ? function (node: HTMLButtonElement | null) {
                                activeRef.current = node
                              }
                            : undefined
                        }
                        type="button"
                        variant="ghost"
                        role="radio"
                        aria-checked={isSelected}
                        aria-label={color}
                        title={color}
                        className={cn(
                          SWATCH_SIZE_CLASS,
                          'shrink-0 cursor-pointer rounded-md border-2 p-0 transition-colors',
                          isSelected ? 'border-primary' : 'border-border'
                        )}
                        style={{ backgroundColor: color }}
                        onClick={function () {
                          field.onChange(color)
                        }}
                      />
                    )
                  })}
                </Glide.X>
              </div>

              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={`${props.label}更多颜色`}
                      className="shrink-0"
                    />
                  }>
                  <Icon
                    icon="lucide:palette"
                    aria-hidden
                  />
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-64">
                  <div className="grid grid-cols-6 gap-2">
                    {props.hues.map(function (color) {
                      return (
                        <Button
                          key={color}
                          type="button"
                          variant="ghost"
                          aria-label={color}
                          title={color}
                          className={cn(
                            PRESET_SWATCH_CLASS,
                            'cursor-pointer rounded-sm border border-border'
                          )}
                          style={{ backgroundColor: color }}
                          onClick={function () {
                            props.onPick(color)
                          }}
                        />
                      )
                    })}
                  </div>
                  <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    自定义
                    <input
                      type="color"
                      value={current.toLowerCase()}
                      aria-label={`${props.label}自定义颜色`}
                      className="h-7 w-full cursor-pointer rounded-md border border-border bg-transparent p-0.5"
                      onChange={function (event) {
                        props.onPick(event.target.value)
                      }}
                    />
                  </label>
                </PopoverContent>
              </Popover>
            </div>
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}

export type { ColorFieldProps }
export { ColorField }
