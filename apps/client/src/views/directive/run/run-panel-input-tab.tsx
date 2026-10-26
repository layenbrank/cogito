/**
 * 「参数」页的运行表单：声明式输入（或 JSON 直填）+ 运行入口。
 * 输出只在「输出」页，这里不再叠任何日志/状态区。
 */
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import { Textarea } from '@cogito/design/components/textarea'

import type { DirectiveInput } from '@/shared/ipc/specs/sidecar'
import type { CorexRun } from '@/stores/corex.ts'
import type { Caps } from './run-caps'
import { RunMenu } from './run-menu'

interface RunPanelInputTabProps {
  directiveName: string
  caps: Caps
  declaredInputs: DirectiveInput[]
  hasDeclaredInputs: boolean
  showAdvancedJson: boolean
  inputValues: Record<string, string>
  paramsJson: string
  /** 该指令自身的进行中运行；用于显示取消 */
  activeRun: CorexRun | undefined
  onInputValuesChange: (next: Record<string, string>) => void
  onParamsJsonChange: (text: string) => void
  onToggleAdvancedJson: () => void
  onRun: () => void
  onCancelRun: (runId: string) => void
  beforeGuard: () => Promise<string | null>
}

function RunPanelInputTab(props: RunPanelInputTabProps) {
  return (
    <div className="space-y-2">
      {props.hasDeclaredInputs && !props.showAdvancedJson ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {props.declaredInputs.map(function (input) {
            return (
              <div
                key={input.name}
                className="min-w-0 space-y-1">
                <Label
                  htmlFor={`run-input-${input.name}`}
                  className="text-xs">
                  {input.name}
                  {input.required ? <span className="text-destructive"> *</span> : null}
                </Label>
                <Input
                  id={`run-input-${input.name}`}
                  value={props.inputValues[input.name] ?? ''}
                  placeholder={input.description || '值或 JSON'}
                  onChange={function (event) {
                    props.onInputValuesChange({
                      ...props.inputValues,
                      [input.name]: event.target.value
                    })
                  }}
                  className="h-8 font-mono text-xs"
                />
              </div>
            )
          })}
        </div>
      ) : (
        <div className="min-w-0 space-y-1">
          <Label
            htmlFor="run-params"
            className="text-xs">
            输入参数 (JSON)
          </Label>
          <Textarea
            id="run-params"
            value={props.paramsJson}
            onChange={function (event) {
              props.onParamsJsonChange(event.target.value)
            }}
            rows={4}
            className="max-h-40 min-h-16 resize-y font-mono text-xs"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <RunMenu
          name={props.directiveName}
          caps={props.caps}
          onOnce={props.onRun}
          beforeGuard={props.beforeGuard}
        />
        {props.hasDeclaredInputs ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={props.onToggleAdvancedJson}>
            {props.showAdvancedJson ? '使用表单' : '高级 JSON'}
          </Button>
        ) : null}
        {props.activeRun ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={function () {
              void props.onCancelRun(props.activeRun!.id)
            }}>
            取消运行
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export { RunPanelInputTab }
