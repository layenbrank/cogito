import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { Label } from '@i-thinking/design/components/label'
import { Textarea } from '@i-thinking/design/components/textarea'

import type { DirectiveInput } from '@/shared/ipc/specs/sidecar'
import type { CorexRun } from '@/stores/corex.ts'
import type { Caps } from './run-caps'
import { RunMenu } from './run-menu'
import { RunPanelLog } from './run-panel-log.tsx'
import { RunPanelStatus } from './run-panel-status.tsx'

interface RunPanelRunTabProps {
  directiveName: string
  caps: Caps
  declaredInputs: DirectiveInput[]
  hasDeclaredInputs: boolean
  showAdvancedJson: boolean
  inputValues: Record<string, string>
  paramsJson: string
  activeRun: CorexRun | undefined
  stepCount: number
  logText: string
  isFollowing: boolean
  onInputValuesChange: (next: Record<string, string>) => void
  onParamsJsonChange: (text: string) => void
  onToggleAdvancedJson: () => void
  onRun: () => void
  onCancelRun: (runId: string) => void
  beforeGuard: () => Promise<string | null>
  onFollowingChange: (following: boolean) => void
  onResumeFollow: () => void
}

function RunPanelRunTab(props: RunPanelRunTabProps) {
  return (
    <>
      <div className="grid shrink-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="min-w-0 space-y-2">
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
                        const next = event.target.value
                        props.onInputValuesChange({
                          ...props.inputValues,
                          [input.name]: next
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
                rows={2}
                className="max-h-24 min-h-12 resize-y font-mono text-xs"
              />
            </div>
          )}
          {props.hasDeclaredInputs ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-1 text-xs text-muted-foreground"
              onClick={props.onToggleAdvancedJson}>
              {props.showAdvancedJson ? '使用表单' : '高级 JSON'}
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RunMenu
            name={props.directiveName}
            caps={props.caps}
            onOnce={props.onRun}
            beforeGuard={props.beforeGuard}
          />
          {props.activeRun?.status === 'running' ? (
            <Button
              size="sm"
              variant="outline"
              onClick={function () {
                void props.onCancelRun(props.activeRun!.id)
              }}>
              取消
            </Button>
          ) : null}
        </div>
      </div>

      {props.activeRun ? (
        <RunPanelStatus
          activeRun={props.activeRun}
          stepCount={props.stepCount}
          isFollowing={props.isFollowing}
          onResumeFollow={props.onResumeFollow}
        />
      ) : null}

      <RunPanelLog
        logText={props.logText}
        placeholder="运行日志将显示在这里…"
        isFollowing={props.isFollowing}
        onFollowingChange={props.onFollowingChange}
      />
    </>
  )
}

export { RunPanelRunTab }
