import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { Label } from '@i-thinking/design/components/label'
import { Switch } from '@i-thinking/design/components/switch'
import { Icon } from '@iconify/react/offline'

interface VariablesEditorProps {
  variables: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}

interface VariableValueProps {
  value: unknown
  onChange: (next: unknown) => void
}

/**
 * 变量值控件：布尔 / 数字 / 其它按文本。
 * 复杂对象以 JSON 文本展示；改写后仍按字符串写回（与 studio 行为一致）。
 */
function VariableValue(props: VariableValueProps) {
  const value = props.value

  if (typeof value === 'boolean') {
    return (
      <label className="flex h-8 items-center gap-2 text-xs">
        <Switch
          checked={value}
          onCheckedChange={function (checked) {
            props.onChange(checked === true)
          }}
        />
        {value ? 'true' : 'false'}
      </label>
    )
  }

  if (typeof value === 'number') {
    return (
      <Input
        type="number"
        className="h-8 font-mono text-xs"
        value={value}
        aria-label="变量值"
        onChange={function (event) {
          props.onChange(Number(event.target.value))
        }}
      />
    )
  }

  const text =
    typeof value === 'string'
      ? value
      : value === undefined || value === null
        ? ''
        : JSON.stringify(value)

  return (
    <Input
      type="text"
      className="h-8 font-mono text-xs"
      value={text}
      aria-label="变量值"
      onChange={function (event) {
        props.onChange(event.target.value)
      }}
    />
  )
}

/**
 * key 用行索引：避免改名时整行重挂丢焦点。
 */
function VariablesEditor(props: VariablesEditorProps) {
  const entries = Object.entries(props.variables)

  return (
    <div className="space-y-2">
      {entries.length === 0 ? (
        <p className="rounded-md border border-dashed px-2.5 py-2 text-center text-xs text-muted-foreground">
          尚未声明变量；步骤参数里可用 {'{{variables.xxx}}'}
        </p>
      ) : null}
      {entries.map(function (entry, index) {
        const key = entry[0]
        return (
          <div
            key={index}
            className="space-y-2 rounded-md border p-2.5">
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="删除变量"
                title="删除变量"
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={function () {
                  const next = { ...props.variables }
                  delete next[key]
                  props.onChange(next)
                }}>
                <Icon
                  icon="lucide:trash-2"
                  className="size-3.5"
                />
              </Button>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">变量名</Label>
              <Input
                className="h-8 font-mono text-xs"
                value={key}
                placeholder="如 base"
                aria-label="变量名"
                onChange={function (event) {
                  const next: Record<string, unknown> = {}
                  Object.entries(props.variables).forEach(function (item) {
                    next[item[0] === key ? event.target.value : item[0]] = item[1]
                  })
                  props.onChange(next)
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">值</Label>
              <VariableValue
                value={entry[1]}
                onChange={function (next) {
                  props.onChange({ ...props.variables, [key]: next })
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
          props.onChange({ ...props.variables, [`var${entries.length + 1}`]: '' })
        }}>
        <Icon
          icon="lucide:plus"
          className="size-3.5"
        />
        添加变量
      </Button>
    </div>
  )
}

export { VariablesEditor }
