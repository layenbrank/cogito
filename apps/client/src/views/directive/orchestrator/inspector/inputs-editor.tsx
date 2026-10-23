import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import { Switch } from '@cogito/design/components/switch'
import { Textarea } from '@cogito/design/components/textarea'
import { Icon } from '@iconify/react/offline'

import type { DirectiveInput } from '@/views/directive/model/types.ts'

interface InputsEditorProps {
  inputs: DirectiveInput[]
  onChange: (next: DirectiveInput[]) => void
}

/** 清空 = 不声明默认值 */
function parseDefault(raw: string): string | undefined {
  return raw === '' ? undefined : raw
}

function stringifyDefault(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  try {
    return JSON.stringify(value) ?? ''
  } catch (error) {
    console.debug('[directive] 输入默认值无法序列化，按空串处理:', error)
    return ''
  }
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
    <div className="space-y-2">
      {inputs.length === 0 ? (
        <p className="rounded-md border border-dashed px-2.5 py-2 text-center text-xs text-muted-foreground">
          尚未声明输入；运行时可填 JSON 参数
        </p>
      ) : null}
      {inputs.map(function (input, index) {
        return (
          <div
            key={index}
            className="space-y-2 rounded-md border p-2.5">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={Boolean(input.required)}
                  onCheckedChange={function (checked) {
                    patch(index, { required: checked === true })
                  }}
                />
                必填
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="删除输入"
                title="删除输入"
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={function () {
                  remove(index)
                }}>
                <Icon
                  icon="lucide:trash-2"
                  className="size-3.5"
                />
              </Button>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">名称</Label>
              <Input
                value={input.name}
                placeholder="如 deploy"
                className="h-8 font-mono text-xs"
                onChange={function (event) {
                  patch(index, { name: event.target.value })
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">说明</Label>
              <Textarea
                value={input.description ?? ''}
                placeholder="部署目标目录（留空则不部署）"
                rows={2}
                className="min-h-12 resize-y text-xs"
                onChange={function (event) {
                  patch(index, { description: event.target.value })
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">默认值</Label>
              <Input
                value={stringifyDefault(input.default)}
                placeholder="留空 = 无默认值"
                className="h-8 font-mono text-xs"
                onChange={function (event) {
                  patch(index, { default: parseDefault(event.target.value) })
                }}
              />
            </div>
          </div>
        )
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-full"
        onClick={function () {
          props.onChange([...inputs, { name: '', description: '', required: false }])
        }}>
        <Icon
          icon="lucide:plus"
          className="size-3.5"
        />
        添加输入
      </Button>
    </div>
  )
}

export { InputsEditor }
