import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'

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
        spacing={0}
        value={[props.value]}
        onValueChange={function (next) {
          const value = next[0] as T | undefined
          if (!value) return
          props.onUpdate(value)
        }}
        className="w-full gap-0.5 rounded-xl border border-slate-900/6 bg-white/40 p-1">
        {props.options.map(function (option) {
          return (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              className="h-[34px] w-full justify-start rounded-lg px-2.5 text-[13px] hover:bg-white/55 aria-pressed:bg-white aria-pressed:text-slate-900 aria-pressed:shadow-[0_1px_3px_rgba(15,23,42,0.08)] data-[state=on]:bg-white data-[state=on]:text-slate-900 data-[state=on]:shadow-[0_1px_3px_rgba(15,23,42,0.08)]">
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
