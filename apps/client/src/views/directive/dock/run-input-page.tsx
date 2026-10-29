/**
 * 「参数」页：指令运行参数与动作试跑参数集中在这里，输出页只负责回显。
 */
import { Separator } from '@cogito/design/components/separator'
import type { ReactNode } from 'react'

import { RunSurfaceInputTab } from '@/views/directive/run/run-surface-input-tab.tsx'
import { RunSurfaceTrialTab } from '@/views/directive/run/run-surface-trial-tab.tsx'
import type { RunDockState } from '@/views/directive/run/use-run-dock.ts'

interface RunInputPageProps {
  run: RunDockState
}

interface SectionProps {
  title: string
  hint: string
  children: ReactNode
}

function Section(props: SectionProps) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-xs font-medium">{props.title}</span>
        <span className="text-[11px] text-muted-foreground">{props.hint}</span>
      </div>
      {props.children}
    </section>
  )
}

function RunInputPage(props: RunInputPageProps) {
  const run = props.run
  const name = run.directiveName
  if (!name) return null

  return (
    <div className="h-full min-h-0 overflow-y-auto px-3 py-2">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <Section
          title="运行指令"
          hint="填写输入后运行；单次运行与守护任务共用同一入口">
          <RunSurfaceInputTab
            directiveName={name}
            caps={run.caps}
            declaredInputs={run.declaredInputs}
            hasDeclaredInputs={run.hasDeclaredInputs}
            showAdvancedJson={run.showAdvancedJson}
            inputValues={run.inputValues}
            paramsJson={run.paramsJson}
            activeRun={run.activeRun}
            onInputValuesChange={run.setInputValues}
            onParamsJsonChange={run.setParamsJson}
            onToggleAdvancedJson={function () {
              run.toggleAdvancedJson()
            }}
            onRun={run.handleRun}
            onCancelRun={function (runId) {
              void run.cancelRun(runId)
            }}
            beforeGuard={run.beforeGuard}
          />
        </Section>

        <Separator />

        <Section
          title="试跑动作"
          hint="跳过指令编排，直接带参数调用单个动作验证效果">
          <RunSurfaceTrialTab
            catalog={run.catalog}
            trialAction={run.trialAction}
            trialParamsJson={run.trialParamsJson}
            onTrialActionChange={run.setTrialActionPick}
            onTrialParamsJsonChange={run.setTrialParamsJson}
            onTrial={run.handleTrial}
          />
        </Section>
      </div>
    </div>
  )
}

export { RunInputPage }
