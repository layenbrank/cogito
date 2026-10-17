import { Badge } from '@i-thinking/design/components/badge'
import { Button } from '@i-thinking/design/components/button'
import { DialogDescription, DialogHeader, DialogTitle } from '@i-thinking/design/components/dialog'
import { Spinner } from '@i-thinking/design/components/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@i-thinking/design/components/tooltip'
import { Icon } from '@iconify/react/offline'
import { useState } from 'react'

import type { CorexAction } from '@/stores/corex'

import { BUCKET_LABELS, findBucketMark } from '@/views/directive/list/bucket'
import {
  createDefaultValues,
  findParamProblem,
  setParamValue
} from '@/views/directive/params/field'
import { ParamField } from '@/views/directive/params/param-field'
import { findPermissionIcon, findPermissionLabel } from '@/views/directive/permissions'
import RunOutput from '@/views/directive/run/run-output'
import { useTrial } from './use-trial'

/**
 * 单动作试跑：动作库里挑一个动作、填上参数、就地跑一次。
 *
 * 只做「这一个动作」，不落指令文件、不进列表的运行记录 —— 拼指令之前先用它确认参数和输出长什么样。
 * 输出区直接复用运行台的面板：进度帧、复制、查找这些不该有第二套实现。
 */

interface Props {
  action: CorexAction
  onBack: () => void
}

interface PermissionNoticeProps {
  permissions: readonly string[]
}

/** 试跑是真执行：会用到哪些权限得先说清楚 */
function PermissionNotice(props: PermissionNoticeProps) {
  if (props.permissions.length === 0) return null

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="secondary"
            className="cursor-help text-xs font-normal">
            <Icon icon="mdi:shield-key-outline" />
            {`需要 ${props.permissions.length} 项权限`}
          </Badge>
        }
      />
      <TooltipContent>
        <ul className="flex flex-col gap-1 py-0.5">
          {props.permissions.map(function (permission) {
            return (
              <li
                key={permission}
                className="flex items-center gap-1.5 text-xs">
                <Icon icon={findPermissionIcon(permission)} />
                {findPermissionLabel(permission)}
              </li>
            )
          })}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}

function TrialPanel(props: Props) {
  const { action } = props
  const [values, setValues] = useState(function () {
    return createDefaultValues(action.params)
  })
  const [error, setError] = useState<string | null>(null)
  const { run, isRunning, start } = useTrial()

  function handleChange(name: string, value: unknown): void {
    setValues(function (prev) {
      return setParamValue(prev, name, value)
    })
  }

  function handleRun(): void {
    const problem = findParamProblem(action.params, values)
    if (problem) {
      setError(problem)
      return
    }

    setError(null)
    start(action.id, values)
  }

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="-ml-1.5 text-muted-foreground"
            onClick={props.onBack}>
            <Icon icon="mdi:arrow-left" />
            动作库
          </Button>
          <span className="ml-auto">
            <PermissionNotice permissions={action.permissions} />
          </span>
        </div>

        <DialogTitle className="flex min-w-0 items-center gap-2 text-base">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon
              icon={findBucketMark(action.bucket).icon}
              className="size-4"
            />
          </span>
          <span className="truncate">{action.name}</span>
        </DialogTitle>

        <DialogDescription className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Badge
            variant="outline"
            className="font-mono">
            {action.id}
          </Badge>
          <span>{BUCKET_LABELS[action.bucket]}</span>
          <span>{action.description}</span>
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex w-64 shrink-0 flex-col gap-2.5 overflow-y-auto pr-1">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground">
            {action.params.length > 0 ? `参数（${action.params.length}）` : '参数'}
          </p>

          {action.params.length === 0 ? (
            <p className="rounded-md border border-dashed px-2.5 py-2 text-xs text-muted-foreground">
              这个动作不需要参数，直接试跑。
            </p>
          ) : (
            action.params.map(function (param) {
              return (
                <ParamField
                  key={param.name}
                  param={param}
                  value={values[param.name]}
                  onChange={function (value) {
                    handleChange(param.name, value)
                  }}
                />
              )
            })
          )}

          <div className="mt-auto flex flex-col gap-2 pt-2">
            {error ? (
              <p className="flex items-start gap-1 text-xs text-destructive">
                <Icon
                  icon="mdi:alert-circle-outline"
                  className="mt-0.5 size-3.5 shrink-0"
                />
                {error}
              </p>
            ) : null}

            <Button
              type="button"
              size="sm"
              disabled={isRunning}
              onClick={handleRun}>
              {isRunning ? <Spinner className="size-3.5" /> : <Icon icon="mdi:play" />}
              {isRunning ? '试跑中…' : '试跑'}
            </Button>

            <p className="text-xs leading-snug text-muted-foreground">
              留空即不传该参数，corex 用声明里的默认值。试跑会真的执行这个动作。
            </p>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
          {run ? (
            // 换一次试跑就换组件：跟随、筛选、滚动位置都该跟着换
            <RunOutput
              key={run.id}
              run={run}
              stepTotal={1}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-muted-foreground">
              <Icon
                icon="mdi:play-circle-outline"
                className="size-6 opacity-60"
              />
              <p className="text-sm">填好参数，点「试跑」看输出</p>
              <p className="text-xs opacity-80">只跑这一个动作，不进指令列表的运行记录</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default TrialPanel
