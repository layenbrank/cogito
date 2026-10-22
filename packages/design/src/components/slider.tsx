import { Slider as SliderPrimitive } from '@base-ui/react/slider'
import { cn } from 'cn'
import * as React from 'react'

type TipFormatter = ((value: number) => React.ReactNode) | null

/** 对齐 antd `tooltip`：默认悬停/拖动显示；`false` 关闭；`open` 强制显隐 */
interface SliderTooltipProps {
  open?: boolean
  formatter?: TipFormatter
}

type SliderProps = SliderPrimitive.Root.Props & {
  tooltip?: false | SliderTooltipProps
}

function findThumbCount(
  value: SliderPrimitive.Root.Props['value'],
  defaultValue: SliderPrimitive.Root.Props['defaultValue']
) {
  if (Array.isArray(value)) return value.length
  if (typeof value === 'number') return 1
  if (Array.isArray(defaultValue)) return defaultValue.length
  return 1
}

function parseValues(
  value: SliderPrimitive.Root.Props['value'],
  defaultValue: SliderPrimitive.Root.Props['defaultValue'],
  min: number
): number[] {
  if (Array.isArray(value)) return [...value]
  if (typeof value === 'number') return [value]
  if (Array.isArray(defaultValue)) return [...defaultValue]
  if (typeof defaultValue === 'number') return [defaultValue]
  return [min]
}

function formatTip(formatter: TipFormatter | undefined, value: number) {
  if (formatter === null) return null
  if (formatter) return formatter(value)
  return String(value)
}

/** 单拇指取值；range 时取首项 */
function parseSliderValue(value: number | readonly number[]): number {
  if (typeof value === 'number') return value
  return value[0] ?? 0
}

function SliderTip(props: { children: React.ReactNode; isVisible: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute bottom-[calc(100%+0.625rem)] left-1/2 z-10 -translate-x-1/2',
        'min-w-8 rounded-md bg-foreground px-2.5 py-1.5 text-sm leading-none font-medium text-background tabular-nums',
        'transition-[opacity,transform] duration-150',
        props.isVisible
          ? 'translate-y-0 opacity-100'
          : 'translate-y-1 opacity-0',
        'motion-reduce:transition-none'
      )}>
      {props.children}
      <span
        className={cn(
          'absolute top-full left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45',
          'bg-foreground'
        )}
      />
    </span>
  )
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  tooltip,
  onValueChange,
  ...props
}: SliderProps) {
  const isControlled = value !== undefined
  const [draft, setDraft] = React.useState(function () {
    return parseValues(value, defaultValue, min)
  })
  const [isHovering, setHovering] = React.useState(false)
  const [isDragging, setDragging] = React.useState(false)
  const [hoverIndex, setHoverIndex] = React.useState(0)

  const thumbCount = findThumbCount(value, defaultValue)
  // 受控时直接从 value 派生，勿再用 effect 回写 draft（会触发级联渲染）
  const displayValues = isControlled ? parseValues(value, defaultValue, min) : draft

  React.useEffect(
    function () {
      if (!isDragging) return
      function endDrag() {
        setDragging(false)
      }
      window.addEventListener('pointerup', endDrag)
      window.addEventListener('pointercancel', endDrag)
      return function () {
        window.removeEventListener('pointerup', endDrag)
        window.removeEventListener('pointercancel', endDrag)
      }
    },
    [isDragging]
  )

  const tipOff = tooltip === false
  const tipOpts = tooltip && typeof tooltip === 'object' ? tooltip : {}
  const tipFormatter = tipOpts.formatter
  const tipForced = tipOpts.open
  const canShowTip = !tipOff && tipFormatter !== null
  const isTipActive =
    canShowTip && (tipForced === true || (tipForced !== false && (isHovering || isDragging)))

  return (
    <SliderPrimitive.Root
      className={cn('data-horizontal:w-full data-vertical:h-full', className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      onValueChange={function (next, details) {
        const nextValues = Array.isArray(next) ? [...next] : [next]
        if (!isControlled) setDraft(nextValues)
        onValueChange?.(next, details)
      }}
      {...props}>
      <SliderPrimitive.Control
        className={cn(
          'relative flex w-full touch-none items-center select-none py-1',
          'data-disabled:pointer-events-none data-disabled:opacity-50',
          'data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col'
        )}
        onPointerDown={function () {
          setDragging(true)
        }}
        onPointerUp={function () {
          setDragging(false)
        }}
        onPointerCancel={function () {
          setDragging(false)
        }}>
        <SliderPrimitive.Track
          data-slot="slider-track"
          className={cn(
            'relative grow overflow-hidden rounded-full select-none',
            // 在浅灰面板上 muted 几乎看不见，用前景透明色保证轨道底可见
            'bg-foreground/10 dark:bg-foreground/20',
            'data-horizontal:h-2 data-horizontal:w-full',
            'data-vertical:h-full data-vertical:w-2'
          )}>
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className={cn(
              'rounded-full select-none bg-primary',
              'data-horizontal:h-full data-vertical:w-full'
            )}
          />
        </SliderPrimitive.Track>
        {Array.from({ length: thumbCount }, function (_, index) {
          const tipValue = displayValues[index] ?? min
          const tipContent = formatTip(tipFormatter, tipValue)
          const isThisTipVisible =
            tipContent !== null &&
            canShowTip &&
            (tipForced === true ||
              (isTipActive && (thumbCount === 1 || hoverIndex === index)))

          return (
            <SliderPrimitive.Thumb
              data-slot="slider-thumb"
              key={index}
              index={thumbCount > 1 ? index : undefined}
              className={cn(
                'group/thumb relative block size-4 shrink-0 cursor-pointer rounded-full border-0 select-none',
                // 外圈主色底 + 内芯 background（伪元素），不用 border，白底才能看见
                'bg-primary hover:bg-primary-hover active:bg-primary-active',
                'before:pointer-events-none before:absolute before:inset-[3px] before:rounded-full before:bg-background before:content-[""]',
                'transition-[transform,background-color] duration-150',
                'after:absolute after:-inset-2.5 after:rounded-full after:content-[""]',
                'hover:scale-110 active:scale-105',
                'focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/45',
                'disabled:pointer-events-none disabled:opacity-50',
                'motion-reduce:transition-none motion-reduce:hover:scale-100'
              )}
              onPointerEnter={function () {
                setHoverIndex(index)
                setHovering(true)
              }}
              onPointerLeave={function () {
                if (!isDragging) setHovering(false)
              }}
              onFocus={function () {
                setHoverIndex(index)
                setHovering(true)
              }}
              onBlur={function () {
                if (!isDragging) setHovering(false)
              }}>
              {canShowTip && tipContent !== null ? (
                <SliderTip isVisible={isThisTipVisible}>{tipContent}</SliderTip>
              ) : null}
            </SliderPrimitive.Thumb>
          )
        })}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider, parseSliderValue }
export type { SliderProps, SliderTooltipProps, TipFormatter }
