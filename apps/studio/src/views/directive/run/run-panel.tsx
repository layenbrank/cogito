import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { Progress } from '@cogito/design/components/progress'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useEffect } from 'react'

import { findModifierLabel } from '@/features/window/shortcuts'
import type { CorexRun } from '@/stores/corex'

import { useNow } from '@/views/directive/use-now'
import RunChips from './run-chips'
import RunOutput from './run-output'
import { RUN_STATUS_STYLES, formatElapsed, isRunning } from './run-status'

/**
 * 运行台：下半屏的任务条 + 选中任务的输出。
 *
 * 任务是页面的，不是某条指令的 —— 切指令不该把还在跑的任务藏起来。任务条与任务细节都归
 * `RunChips`，这里只管台面：标题栏（有几条在跑、几条失败）与输出区。
 *
 * 收起后只剩 48px 的标题栏，所以把「当前关注的任务」搬到标题栏里，并给它一条贴底进度线：
 * 收起的本意是腾地方，不是让人看不见任务还在跑。台体（Chips/Output）收起时卸载，
 * 避免分栏缩小时跟着整墙回流。
 *
 * 这里只读运行元数据（一步一变），输出流归 `RunOutput` 自己订阅，标题栏不跟着每秒几百帧
 * 的输出重渲染。
 */

/** 耗时刷新：只在这条在跑时开表 */
const ELAPSED_MS = 500

interface Props {
  runs: readonly CorexRun[]
  /** 指令名 → 声明的步骤数，用来算进度与「x/y 步」 */
  stepCounts: Record<string, number>
  isCollapsed: boolean
  selectedId: string | null
  onToggle: () => void
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onClear: () => void
  /** 关注的任务已经结束、且输出就摆在眼前 —— 通知宿主清掉未读 */
  onVisible: (name: string) => void
}

interface FocusProps {
  run: CorexRun
  stepTotal: number
  now: number
}

/** 选中的那条；id 因席位复用对不上时，按指令名钉回同一枚 */
function findFocus(runs: readonly CorexRun[], selectedId: string | null): CorexRun | null {
  if (runs.length === 0) return null
  const selected = runs.find(function (run) {
    return run.id === selectedId
  })
  if (selected) return selected
  return runs[runs.length - 1]
}

function FocusRun(props: FocusProps) {
  const { run } = props
  const style = RUN_STATUS_STYLES[run.status]

  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs">
      <Icon
        icon={style.icon}
        className={cn('size-3.5 shrink-0', style.tone, isRunning(run) && 'animate-pulse')}
      />
      <span className="min-w-0 truncate font-medium">{run.name}</span>
      <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
        {formatElapsed(run, props.now)}
      </span>
      {props.stepTotal > 0 ? (
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {run.doneSteps}/{props.stepTotal} 步
        </span>
      ) : null}
    </span>
  )
}

function RunPanel(props: Props) {
  const { isCollapsed, onVisible } = props
  const running = props.runs.filter(isRunning)
  const failed = props.runs.filter(function (run) {
    return run.status === 'failed'
  }).length
  const now = useNow(ELAPSED_MS, running.length > 0)

  const focus = findFocus(props.runs, props.selectedId)
  const focusSteps = focus ? (props.stepCounts[focus.name] ?? 0) : 0
  const isFocusRunning = focus ? isRunning(focus) : false

  /**
   * 关注的任务跑完就清未读 —— 收起时不清：只剩一行标题栏，用户并没看到输出。
   *
   * 依赖的是 run **对象本身**：`patchRun` 只克隆被改的那一条，所以只有它自己的结束会换引用，
   * 恰好触发一次。`!endedAt` 早退则保证了「起一条运行、盯着它跑完」不亮未读点。
   */
  const visibleRun = isCollapsed ? null : focus
  useEffect(
    function () {
      if (!visibleRun || !visibleRun.endedAt) return
      onVisible(visibleRun.name)
    },
    [visibleRun, onVisible]
  )

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
      <header className="relative flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="cursor-pointer"
          aria-label={props.isCollapsed ? '展开运行台' : '收起运行台'}
          title={props.isCollapsed ? '展开运行台' : '收起运行台'}
          onClick={props.onToggle}>
          <Icon
            icon={props.isCollapsed ? 'mdi:chevron-up' : 'mdi:chevron-down'}
          />
        </Button>
        <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground">
          <Icon
            icon="mdi:console-line"
            className="size-4"
          />
          运行
        </span>

        {running.length > 0 ? (
          <Badge
            variant="secondary"
            className="gap-1 font-normal">
            <Icon
              icon="mdi:progress-clock"
              className="animate-pulse"
            />
            {`${running.length} 个进行中`}
          </Badge>
        ) : null}
        {failed > 0 ? (
          <Badge
            variant="outline"
            className="gap-1 border-destructive/40 font-normal text-destructive">
            <Icon icon="mdi:alert-circle-outline" />
            {`${failed} 个失败`}
          </Badge>
        ) : null}

        <div className="ml-auto flex min-w-0 items-center gap-2">
          {props.isCollapsed && focus ? (
            <FocusRun
              run={focus}
              stepTotal={focusSteps}
              now={now}
            />
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="cursor-pointer"
            disabled={props.runs.length === running.length}
            title={
              props.runs.length === running.length
                ? '没有已完成的任务可清理'
                : '移除全部已完成的任务'
            }
            onClick={props.onClear}>
            <Icon icon="mdi:broom" />
            清空已完成
          </Button>
        </div>

        {focus && isFocusRunning && focusSteps > 0 ? (
          <Progress
            value={Math.min(100, (focus.doneSteps / focusSteps) * 100)}
            className="absolute inset-x-0 bottom-0 h-0.5 rounded-none"
            aria-label={`${focus.name} 运行进度`}
          />
        ) : null}
      </header>

      {/*
        收起时卸载台体：没有开合动画后不必保留裁切内容，
        否则分栏一缩，Chips/Output 仍跟着整墙回流。
      */}
      {props.isCollapsed ? null : focus ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <RunChips
            runs={props.runs}
            selectedId={props.selectedId}
            stepCounts={props.stepCounts}
            now={now}
            onSelect={props.onSelect}
            onRemove={props.onRemove}
          />

          <RunOutput
            key={focus.id}
            run={focus}
            stepTotal={focusSteps}
          />
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center text-muted-foreground">
            <Icon
              icon="mdi:console-line"
              className="size-6 opacity-60"
            />
            <p className="text-sm">还没有运行记录</p>
            <p className="text-xs opacity-80">
              点「运行」开始，编辑器里也可以按 {findModifierLabel()} + Enter
            </p>
          </div>
        </div>
      )}
    </section>
  )
}

export default RunPanel
