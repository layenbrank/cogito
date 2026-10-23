import { Icon } from '@iconify/react/offline'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { Checkbox } from '@cogito/design/components/checkbox'
import { Input } from '@cogito/design/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@cogito/design/components/popover'
import { cn } from 'cn'
import { useState, type ComponentProps } from 'react'

import { addModelIDs, filterModelOptions, toggleModelID } from './models.ts'

/**
 * 模型名选择器（provider 表单用）。
 *
 * 两个字段共用一套「候选清单 + 搜索 + 手填」的交互，区别只在单选还是多选：
 * - `ModelField`：默认模型，单选；
 * - `ModelsField`：可选用模型，多选，勾中的名字由 `ModelChips` 显示在控件下面。
 *
 * 候选清单是**预填不是白名单**：本地运行时没有清单，云端厂商哪天新上模型也不会等发版，
 * 所以任何位置都可以直接敲一个名字用（回车即取用）。这也是不用 `Select` 的原因
 * （`Select` 的选项是封闭集合，且不能输入）。
 */

/** 触发器要接住的外部属性：`FormControl` 注入的 `id` / `aria-*` / `ref` 都在这里面 */
type FieldTriggerProps = Omit<ComponentProps<'button'>, 'value' | 'onChange' | 'type'>

interface TriggerProps extends FieldTriggerProps {
  text: string
  isPlaceholder: boolean
  isOpen: boolean
}

/**
 * 触发器。`FormControl` 用 Base UI 的 `useRender` 把 `id` / `aria-*` / `ref` 注入到子元素上，
 * 所以这里必须把未知 props 原样透传给按钮，label 的 for 与错误提示的 aria 才接得上。
 */
function Trigger(props: TriggerProps) {
  const { text, isPlaceholder, isOpen, className, ...rest } = props

  return (
    <Button
      {...rest}
      type="button"
      variant="outline"
      role="combobox"
      aria-expanded={isOpen}
      className={cn('w-full justify-between font-normal', className)}>
      <span className={cn('truncate', isPlaceholder && 'text-muted-foreground')}>{text}</span>
      <Icon
        icon="lucide:chevron-down"
        className="text-muted-foreground size-4 shrink-0"
      />
    </Button>
  )
}

/** 搜索框。回车是「取用当前候选/手填值」的快捷键，所以要拦掉表单提交 */
function SearchBox(props: {
  query: string
  placeholder: string
  onQueryChange: (query: string) => void
  onSubmitQuery: () => void
}) {
  return (
    <div className="border-border border-b p-1.5">
      <div className="relative">
        <Icon
          icon="lucide:search"
          className="text-muted-foreground pointer-events-none absolute inset-s-2 top-1/2 size-3.5 -translate-y-1/2"
        />
        <Input
          autoFocus
          value={props.query}
          aria-label="搜索模型"
          placeholder={props.placeholder}
          className="h-8 ps-7 text-xs"
          onChange={function (event) {
            props.onQueryChange(event.target.value)
          }}
          onKeyDown={function (event) {
            if (event.key !== 'Enter') return
            event.preventDefault()
            props.onSubmitQuery()
          }}
        />
      </div>
    </div>
  )
}

/** 候选行（单选：当前值带勾） */
function OptionRow(props: { label: string; isActive: boolean; onPick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-selected={props.isActive}
      onClick={props.onPick}
      className="hover:bg-accent h-auto w-full justify-start gap-2 rounded-sm px-2 py-1.5 text-xs">
      <Icon
        icon="lucide:check"
        className={cn('size-3.5 shrink-0', props.isActive ? 'text-primary' : 'opacity-0')}
      />
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
    </Button>
  )
}

/** 候选行（多选：勾选框，点完不关面板，可以连着挑几个） */
function CheckRow(props: { label: string; isChecked: boolean; onToggle: () => void }) {
  return (
    <label className="hover:bg-accent flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs">
      <Checkbox
        checked={props.isChecked}
        onCheckedChange={props.onToggle}
      />
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
    </label>
  )
}

/** 清单为空时的提示：本地运行时没有公开清单，靠手填 */
function EmptyHint(props: { query: string; hasOptions: boolean }) {
  if (!props.hasOptions) {
    return (
      <p className="text-muted-foreground px-2 py-3 text-xs leading-relaxed">
        本地运行时没有公开清单：直接输入模型名（`ollama list` 里那个）后回车。
      </p>
    )
  }

  if (!props.query) return null

  return <p className="text-muted-foreground px-2 py-3 text-xs">没有匹配的模型</p>
}

interface ModelFieldProps extends FieldTriggerProps {
  options: readonly string[]
  /** 表单值：当前选中的模型名 */
  value: string
  placeholder: string
  onChange: (value: string) => void
}

/** 默认模型：单选，允许清单外的名字 */
function ModelField(props: ModelFieldProps) {
  const { options, value, placeholder, onChange, ...triggerProps } = props
  const [isOpen, updateOpen] = useState(false)
  const [query, updateQuery] = useState('')

  const visible = filterModelOptions(options, query)
  const keyword = query.trim()
  const isCustom = keyword !== '' && !options.includes(keyword)

  function pick(id: string): void {
    if (!id) return
    onChange(id)
    updateOpen(false)
  }

  return (
    <Popover
      open={isOpen}
      onOpenChange={function (next) {
        updateOpen(next)
        if (!next) updateQuery('')
      }}>
      <PopoverTrigger
        render={
          <Trigger
            {...triggerProps}
            isOpen={isOpen}
            text={value || placeholder}
            isPlaceholder={!value}
          />
        }
      />
      <PopoverContent
        align="start"
        className="w-(--anchor-width) p-0">
        <SearchBox
          query={query}
          placeholder="搜索或输入模型名"
          onQueryChange={updateQuery}
          onSubmitQuery={function () {
            pick(visible[0] ?? keyword)
          }}
        />
        <div className="max-h-60 overflow-y-auto p-1">
          <EmptyHint
            query={keyword}
            hasOptions={options.length > 0}
          />
          {visible.map(function (id) {
            return (
              <OptionRow
                key={id}
                label={id}
                isActive={id === value}
                onPick={function () {
                  pick(id)
                }}
              />
            )
          })}
          {isCustom ? (
            <OptionRow
              label={`使用 “${keyword}”`}
              isActive={false}
              onPick={function () {
                pick(keyword)
              }}
            />
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface ModelsFieldProps extends FieldTriggerProps {
  options: readonly string[]
  /** 表单值：已选中的模型名清单 */
  value: string[]
  placeholder: string
  onChange: (value: string[]) => void
}

/** 可选用模型：多选，可手填，可全选/清空 */
function ModelsField(props: ModelsFieldProps) {
  const { options, value, placeholder, onChange, ...triggerProps } = props
  const [isOpen, updateOpen] = useState(false)
  const [query, updateQuery] = useState('')

  const visible = filterModelOptions(options, query)
  const keyword = query.trim()
  const isCustom = keyword !== '' && !value.includes(keyword)
  const hasPickable = visible.some(function (id) {
    return !value.includes(id)
  })

  function toggle(id: string): void {
    onChange(toggleModelID(value, id))
  }

  return (
    <Popover
      open={isOpen}
      onOpenChange={function (next) {
        updateOpen(next)
        if (!next) updateQuery('')
      }}>
      <PopoverTrigger
        render={
          <Trigger
            {...triggerProps}
            isOpen={isOpen}
            text={value.length > 0 ? `已选 ${value.length} 个模型` : placeholder}
            isPlaceholder={value.length === 0}
          />
        }
      />
      <PopoverContent
        align="start"
        className="w-(--anchor-width) p-0">
        <SearchBox
          query={query}
          placeholder="搜索或输入模型名"
          onQueryChange={updateQuery}
          onSubmitQuery={function () {
            const first = visible.find(function (id) {
              return !value.includes(id)
            })
            if (first) toggle(first)
            else if (isCustom) onChange(addModelIDs(value, [keyword]))
          }}
        />
        <div className="max-h-60 overflow-y-auto p-1">
          <EmptyHint
            query={keyword}
            hasOptions={options.length > 0}
          />
          {visible.map(function (id) {
            return (
              <CheckRow
                key={id}
                label={id}
                isChecked={value.includes(id)}
                onToggle={function () {
                  toggle(id)
                }}
              />
            )
          })}
          {isCustom ? (
            <CheckRow
              label={`添加 “${keyword}”`}
              isChecked={false}
              onToggle={function () {
                onChange(addModelIDs(value, [keyword]))
              }}
            />
          ) : null}
        </div>
        {hasPickable || value.length > 0 ? (
          <div className="border-border flex items-center justify-between border-t p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={!hasPickable}
              onClick={function () {
                onChange(addModelIDs(value, visible))
              }}>
              全选
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={value.length === 0}
              onClick={function () {
                onChange([])
              }}>
              清空
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

/** 已选模型芯片：点 X 单独摘掉一个 */
function ModelChips(props: { models: readonly string[]; onChange: (models: string[]) => void }) {
  if (props.models.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1">
      {props.models.map(function (id) {
        return (
          <Badge
            key={id}
            variant="secondary"
            className="gap-0.5 ps-2 pe-1 font-normal">
            <span className="max-w-44 truncate">{id}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`移除 ${id}`}
              className="text-muted-foreground hover:text-foreground size-4 rounded-full"
              onClick={function () {
                props.onChange(toggleModelID(props.models, id))
              }}>
              <Icon
                icon="lucide:x"
                className="size-3"
              />
            </Button>
          </Badge>
        )
      })}
    </div>
  )
}

export { ModelChips, ModelField, ModelsField }
