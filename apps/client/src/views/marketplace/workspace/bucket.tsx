import { ToggleGroup, ToggleGroupItem } from '@i-thinking/design/components/toggle-group'

type Option<T extends string> = {
  label: string
  value: T
}

type BucketProps<T extends string> = {
  value: T
  options: Array<Option<T>>
  onUpdate: (value: T) => void
}

/** 左侧分类栏：竖排单选，宽度固定，自身滚动 */
function Bucket<T extends string>(props: BucketProps<T>) {
  return (
    <div className="h-full w-32 min-w-32 overflow-y-auto pl-2">
      <ToggleGroup
        orientation="vertical"
        spacing={1}
        value={[props.value]}
        onValueChange={function (next) {
          const value = next[0] as T | undefined
          if (!value) return
          props.onUpdate(value)
        }}
        className="w-full rounded-xl border border-border/60 bg-card/50 p-1">
        {props.options.map(function (option) {
          return (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              className="h-8.5 w-full justify-start px-2.5 text-sm">
              {option.label}
            </ToggleGroupItem>
          )
        })}
      </ToggleGroup>
    </div>
  )
}

export { Bucket }
export type { BucketProps, Option }
