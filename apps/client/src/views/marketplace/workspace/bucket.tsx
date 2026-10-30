import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'
import { useLayoutEffect, useRef } from 'react'

import { Glide } from '@/components/glide/glide'

type Option<T extends string> = {
  label: string
  value: T
}

type BucketProps<T extends string> = {
  value: T
  options: Array<Option<T>>
  onUpdate: (value: T) => void
}

/**
 * 全宽胶囊轨 + 内容宽度子项；溢出靠 Glide.X 滚轮横向滑，不均分撑满。
 * 选中用实心主色（不用外阴影），避免被 overflow 裁切。
 */
function Bucket<T extends string>(props: BucketProps<T>) {
  const activeRef = useRef<HTMLElement | null>(null)

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
    [props.value]
  )

  return (
    <div className="sticky top-0 z-10 w-full bg-background/95 py-2 backdrop-blur-sm">
      <Glide.X className="h-10 w-full rounded-full bg-muted p-1.5">
        <ToggleGroup
          spacing={1}
          value={[props.value]}
          onValueChange={function (next) {
            const value = next[0] as T | undefined
            if (!value) return
            props.onUpdate(value)
          }}
          className="flex w-max gap-1 rounded-full bg-transparent p-0 shadow-none">
          {props.options.map(function (option) {
            const isActive = option.value === props.value
            return (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                ref={
                  isActive
                    ? function (node: HTMLElement | null) {
                        activeRef.current = node
                      }
                    : undefined
                }
                className={[
                  'h-7 shrink-0 !rounded-full px-3.5 text-xs shadow-none transition-colors',
                  'text-foreground/70 hover:bg-card hover:text-foreground',
                  'data-[state=on]:bg-primary data-[state=on]:font-semibold data-[state=on]:text-primary-foreground',
                  'data-[state=on]:hover:bg-primary data-[state=on]:hover:text-primary-foreground',
                  'data-[pressed]:bg-primary data-[pressed]:font-semibold data-[pressed]:text-primary-foreground'
                ].join(' ')}>
                {option.label}
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
      </Glide.X>
    </div>
  )
}

export { Bucket }
export type { BucketProps, Option }
