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

  return (
    <FormField
      name={props.name}
      rules={{ required: `${props.label}是必填的!` }}
      render={function ({ field }) {
        return (
          <FormItem>
            <FormLabel>{props.label}</FormLabel>
            <div className="flex items-center gap-2">
              <div
                role="radiogroup"
                aria-label={props.label}
                className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1">
                {props.shades.map(function (color) {
                  const isSelected = current === normalizeHex(color)
                  return (
                    <button
                      key={color}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      aria-label={color}
                      title={color}
                      className={cn(
                        SWATCH_SIZE_CLASS,
                        'shrink-0 cursor-pointer rounded-md border border-border transition-shadow',
                        isSelected && 'ring-2 ring-primary ring-offset-1'
                      )}
                      style={{ backgroundColor: color }}
                      onClick={function () {
                        field.onChange(color)
                      }}
                    />
                  )
                })}
              </div>

              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={`${props.label}更多颜色`}
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
                        <button
                          key={color}
                          type="button"
                          aria-label={color}
                          title={color}
                          className={cn(PRESET_SWATCH_CLASS, 'cursor-pointer rounded-sm border border-border')}
                          style={{ backgroundColor: color }}
                          onClick={function () {
                            props.onPick(color)
                          }}
                        />
                      )
                    })}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
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
