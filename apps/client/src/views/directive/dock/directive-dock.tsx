/**
 * 指令底栏：VS Code 风格活动页（运行 / 试跑 / 历史 / 终端）。
 * 每个选项卡独占一页；仅「终端」PTY 用 invisible 保活，其余 inactive 用 hidden。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'
import { useEffect, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'

import { TerminalOutputTab } from '@/features/terminal/terminal-output-tab'
import { TerminalTabs } from '@/features/terminal/terminal-tabs'
import { useTerminalStore, type DockActivity } from '@/stores/terminal'
import { safeDecodeURIComponent } from '@/utils/safe-decode.ts'
import { RunPanelHistoryTab } from '@/views/directive/run/run-panel-history-tab.tsx'
import { RunPanelRunTab } from '@/views/directive/run/run-panel-run-tab.tsx'
import { RunPanelTrialTab } from '@/views/directive/run/run-panel-trial-tab.tsx'
import { useRunDock } from '@/views/directive/run/use-run-dock.ts'

interface DirectiveDockProps {
  cwd?: string | null
  emptyCwdMessage?: string
}

interface ActivityItem {
  id: DockActivity
  label: string
  icon: string
  /** 无指令名时隐藏（试跑 / 历史需要上下文） */
  needsName?: boolean
}

const ACTIVITIES: ActivityItem[] = [
  { id: 'run', label: '运行', icon: 'lucide:play' },
  { id: 'trial', label: '试跑动作', icon: 'lucide:flask-conical', needsName: true },
  { id: 'history', label: '历史', icon: 'lucide:history', needsName: true },
  { id: 'terminal', label: '终端', icon: 'lucide:terminal' }
]

function DirectiveDock(props: DirectiveDockProps) {
  const params = useParams()
  const directiveName = params.name ? safeDecodeURIComponent(params.name) : null

  const activity = useTerminalStore(function (state) {
    return state.activity
  })
  const setActivity = useTerminalStore(function (state) {
    return state.setActivity
  })
  const closePanel = useTerminalStore(function (state) {
    return state.closePanel
  })

  const run = useRunDock(directiveName)

  const visibleActivities = ACTIVITIES.filter(function (item) {
    return !item.needsName || Boolean(directiveName)
  })

  useEffect(
    function () {
      if (directiveName) return
      if (activity === 'trial' || activity === 'history') setActivity('run')
    },
    [directiveName, activity, setActivity]
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex h-9 shrink-0 items-stretch gap-0.5 border-b bg-muted/40 px-1">
        {visibleActivities.map(function (item) {
          const active = activity === item.id
          return (
            <button
              key={item.id}
              type="button"
              aria-selected={active}
              className={cn(
                'relative inline-flex items-center gap-1.5 px-2.5 text-xs transition-colors',
                'rounded-none outline-none focus-visible:bg-muted/80',
                'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity',
                active
                  ? 'bg-background font-medium text-foreground after:opacity-100'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
              onClick={function () {
                setActivity(item.id)
              }}>
              <Icon
                icon={item.icon}
                className="size-3.5 shrink-0 opacity-70"
                aria-hidden
              />
              {item.label}
            </button>
          )
        })}
        <div className="ml-auto flex items-center pr-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="关闭面板"
            title="关闭面板"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={function () {
              closePanel()
            }}>
            <Icon
              icon="lucide:x"
              className="size-3.5"
            />
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* 运行 / 试跑 / 历史：inactive 用 hidden，互不叠显 */}
        <DockPage active={activity === 'run'}>
          <div className="flex h-full min-h-0 flex-col">
            {directiveName ? (
              <div className="max-h-[40%] shrink-0 space-y-2 overflow-y-auto border-b px-3 py-2">
                <RunPanelRunTab
                  directiveName={directiveName}
                  caps={run.caps}
                  declaredInputs={run.declaredInputs}
                  hasDeclaredInputs={run.hasDeclaredInputs}
                  showAdvancedJson={run.showAdvancedJson}
                  inputValues={run.inputValues}
                  paramsJson={run.paramsJson}
                  activeRun={run.activeRun}
                  stepCount={run.stepCount}
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
              </div>
            ) : run.activeRun ? (
              <div className="shrink-0 border-b px-3 py-2">
                <RunPanelRunTab
                  directiveName={run.activeRun.name}
                  caps={run.caps}
                  declaredInputs={[]}
                  hasDeclaredInputs={false}
                  showAdvancedJson
                  inputValues={{}}
                  paramsJson="{}"
                  activeRun={run.activeRun}
                  stepCount={run.stepCount}
                  onInputValuesChange={function () {}}
                  onParamsJsonChange={function () {}}
                  onToggleAdvancedJson={function () {}}
                  onRun={function () {}}
                  onCancelRun={function (runId) {
                    void run.cancelRun(runId)
                  }}
                  beforeGuard={function () {
                    return Promise.resolve(null)
                  }}
                  readOnly
                />
              </div>
            ) : null}
            <div className="min-h-0 flex-1">
              <TerminalOutputTab active={activity === 'run'} />
            </div>
          </div>
        </DockPage>

        <DockPage active={activity === 'trial'}>
          <div className="flex h-full min-h-0 flex-col">
            <div className="max-h-[45%] shrink-0 space-y-2 overflow-y-auto border-b px-3 py-2">
              <RunPanelTrialTab
                catalog={run.catalog}
                trialAction={run.trialAction}
                trialParamsJson={run.trialParamsJson}
                onTrialActionChange={run.setTrialActionPick}
                onTrialParamsJsonChange={run.setTrialParamsJson}
                onTrial={run.handleTrial}
              />
            </div>
            <div className="min-h-0 flex-1">
              <TerminalOutputTab active={activity === 'trial'} />
            </div>
          </div>
        </DockPage>

        <DockPage active={activity === 'history'}>
          <div className="h-full min-h-0 overflow-hidden px-3 py-2">
            <RunPanelHistoryTab runHistory={run.runHistory} />
          </div>
        </DockPage>

        {/* 终端：invisible 保活 PTY，勿用 hidden */}
        <div
          className={cn(
            'absolute inset-0',
            activity === 'terminal' ? 'z-10' : 'pointer-events-none invisible z-0'
          )}
          aria-hidden={activity !== 'terminal'}>
          <TerminalTabs
            cwd={props.cwd}
            emptyCwdMessage={props.emptyCwdMessage}
          />
        </div>
      </div>
    </div>
  )
}

interface DockPageProps {
  active: boolean
  children: ReactNode
}

/** 普通活动页：非选中直接 hidden，避免多页叠在一起被看见 */
function DockPage(props: DockPageProps) {
  return (
    <div
      className={cn('absolute inset-0 z-10', props.active ? 'block' : 'hidden')}
      aria-hidden={!props.active}>
      {props.children}
    </div>
  )
}

export { DirectiveDock }
