import { Button } from '@cogito/design/components/button'
import { Checkbox } from '@cogito/design/components/checkbox'
import { Input } from '@cogito/design/components/input'
import { Textarea } from '@cogito/design/components/textarea'
import { cn } from 'cn'

import {
  CONTROL_CLASS,
  Field,
  Glyph,
  ITEM_CARD_CLASS,
  ItemCardActionRow,
  TEXTAREA_CLASS
} from './controls'
import type { DirectiveInput } from './types'

/**
 * 输入**声明**编辑器：写进指令里的 `inputs`（名字 / 说明 / 必填 / 默认值）。
 *
 * 布局：操作行 → 名称 → 说明 → 默认值（与变量 / 触发器条目卡同一节奏）。
 */

interface InputsEditorProps {
  inputs: DirectiveInput[]
  onChange: (next: DirectiveInput[]) => void
}

/** 默认值按文本编辑：清空 = 没声明默认值，不写一个空串冒充 */
function parseDefault(raw: string): string | undefined {
  return raw === '' ? undefined : raw
}

function InputsEditor(props: InputsEditorProps) {
  const inputs = props.inputs

  function patch(index: number, next: Partial<DirectiveInput>) {
    props.onChange(
      inputs.map(function (input, i) {
        return i === index ? { ...input, ...next } : input
      })
    )
  }

  function remove(index: number) {
    props.onChange(
      inputs.filter(function (_, i) {
        return i !== index
      })
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {inputs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 px-3 py-2.5 text-center text-xs text-muted-foreground">
          还没声明输入；运行时按下面的「运行参数」填值
        </p>
      ) : null}
      {inputs.map(function (input, index) {
        const isRequired = Boolean(input.required)

        return (
          <div
            key={index}
            className={ITEM_CARD_CLASS}>
            <ItemCardActionRow>
              <label
                title={isRequired ? '必填：运行时必须填写' : '选为必填：运行时必须填写'}
                className={cn(
                  'inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border transition-colors',
                  isRequired
                    ? 'border-primary/60 bg-primary/10'
                    : 'border-border/70 bg-background hover:border-border'
                )}>
                <Checkbox
                  checked={isRequired}
                  aria-label="必填"
                  onCheckedChange={function (checked) {
                    patch(index, { required: checked === true })
                  }}
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="删除输入"
                title="删除输入"
                className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={function () {
                  remove(index)
                }}>
                <Glyph icon="mdi:trash-can-outline" />
              </Button>
            </ItemCardActionRow>
            <Field label="名称">
              <Input
                className={CONTROL_CLASS}
                value={input.name}
                placeholder="如 deploy"
                aria-label="输入名字"
                onChange={function (event) {
                  patch(index, { name: event.target.value })
                }}
              />
            </Field>
            <Field
              label="说明"
              hint="会显示在运行参数表单里，也可在下方「运行参数」区通过 ⓘ 查看">
              <Textarea
                className={TEXTAREA_CLASS}
                value={input.description ?? ''}
                placeholder="部署目标目录（留空则不部署）"
                aria-label="输入说明"
                onChange={function (event) {
                  patch(index, { description: event.target.value })
                }}
              />
            </Field>
            <Field
              label="默认值"
              hint="留空表示不声明默认值">
              <Input
                className={CONTROL_CLASS}
                value={
                  input.default === undefined || input.default === null ? '' : String(input.default)
                }
                placeholder="留空 = 无"
                aria-label="默认值"
                onChange={function (event) {
                  patch(index, { default: parseDefault(event.target.value) })
                }}
              />
            </Field>
          </div>
        )
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-full cursor-pointer rounded-lg"
        onClick={function () {
          props.onChange([...inputs, { name: '', description: '', required: false }])
        }}>
        <Glyph icon="mdi:plus" />
        添加输入
      </Button>
    </div>
  )
}

export default InputsEditor
