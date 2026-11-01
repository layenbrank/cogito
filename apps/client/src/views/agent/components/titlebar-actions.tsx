/**
 * Agent 标题栏右侧动作：新建 + 布局开合（贴窗控，对齐 Qoder）。
 * 文案见 layout-copy：会话列表 / 工作区 / 专注，不提三栏。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Kbd, KbdGroup } from '@cogito/design/components/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'

import { BROWSER_CONTROL } from '@/features/browser-bar/metrics'
import { bindingLabels, parseBinding } from '@/keyboard/binding'
import { runCommand } from '@/keyboard/commands'
import { resolveBinding } from '@/keyboard/definitions'
import { COMMAND } from '@/keyboard/definitions/ids'
import {
  ASIDE_FOCUS_HINT,
  findAsideFocusLabel,
  findAsideToggleLabel,
  findSidebarToggleLabel
} from '@/views/agent/components/layout-copy'

interface TitlebarLayoutState {
  isSidebarOpen: boolean
  isAsideOpen: boolean
  isAsideMaximized: boolean
}

interface TitlebarActionsProps {
  layout?: TitlebarLayoutState
  /** 额外动作（如委派），插在布局按钮与窗控之间 */
  extra?: ReactNode
}

/** 按当前平台渲染键帽：Windows 为 Ctrl+…，勿再手写 ⌘ */
function TitlebarShortcut(props: { commandId: string }) {
  const binding = parseBinding(resolveBinding(props.commandId))
  if (!binding) return null
  return (
    <KbdGroup>
      {bindingLabels(binding).map(function (label) {
        return <Kbd key={label}>{label}</Kbd>
      })}
    </KbdGroup>
  )
}

function TitlebarIconButton(props: {
  label: string
  hint?: string
  commandId?: string
  icon: string
  isActive?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-region="false"
            aria-label={props.label}
            aria-pressed={props.isActive}
            className={clsx(
              'shrink-0 rounded-lg border-0',
              props.isActive
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-foreground/8 hover:text-foreground'
            )}
            style={{
              width: BROWSER_CONTROL,
              height: BROWSER_CONTROL,
              minWidth: BROWSER_CONTROL
            }}
            onClick={props.onClick}
          />
        }>
        <Icon
          icon={props.icon}
          className="size-4"
          aria-hidden
        />
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="max-w-56">
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1.5">
            {props.label}
            {props.commandId ? <TitlebarShortcut commandId={props.commandId} /> : null}
          </span>
          {props.hint ? (
            <span className="text-background/70 text-xs font-normal">{props.hint}</span>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function TitlebarActions(props: TitlebarActionsProps) {
  const layout = props.layout

  function run(id: string) {
    void runCommand(id).catch(function (error) {
      console.warn('[agent/titlebar] 命令失败:', id, error)
    })
  }

  return (
    <div
      data-region="false"
      className="flex shrink-0 items-center gap-0.5"
      style={{ height: BROWSER_CONTROL }}>
      <TitlebarIconButton
        label="新建任务"
        commandId={COMMAND.AGENT_NEW_TASK}
        icon="lucide:plus"
        onClick={function () {
          run(COMMAND.AGENT_NEW_TASK)
        }}
      />
      {layout ? (
        <>
          <span
            aria-hidden
            className="bg-border mx-1 hidden h-4 w-px sm:block"
          />
          <TitlebarIconButton
            label={findSidebarToggleLabel(layout.isSidebarOpen)}
            commandId={COMMAND.AGENT_TOGGLE_SIDEBAR}
            icon={layout.isSidebarOpen ? 'lucide:panel-left-close' : 'lucide:panel-left'}
            isActive={!layout.isSidebarOpen}
            onClick={function () {
              run(COMMAND.AGENT_TOGGLE_SIDEBAR)
            }}
          />
          <TitlebarIconButton
            label={findAsideToggleLabel(layout.isAsideOpen)}
            commandId={COMMAND.AGENT_TOGGLE_ASIDE}
            icon={layout.isAsideOpen ? 'lucide:panel-right-close' : 'lucide:panel-right'}
            isActive={!layout.isAsideOpen && !layout.isAsideMaximized}
            onClick={function () {
              run(COMMAND.AGENT_TOGGLE_ASIDE)
            }}
          />
          <TitlebarIconButton
            label={findAsideFocusLabel(layout.isAsideMaximized)}
            hint={layout.isAsideMaximized ? undefined : ASIDE_FOCUS_HINT}
            commandId={COMMAND.AGENT_MAXIMIZE_ASIDE}
            icon={layout.isAsideMaximized ? 'lucide:minimize-2' : 'lucide:maximize-2'}
            isActive={layout.isAsideMaximized}
            onClick={function () {
              run(COMMAND.AGENT_MAXIMIZE_ASIDE)
            }}
          />
        </>
      ) : null}
      {props.extra ? (
        <>
          <span
            aria-hidden
            className="bg-border mx-1 hidden h-4 w-px sm:block"
          />
          {props.extra}
        </>
      ) : null}
    </div>
  )
}

export { TitlebarActions }
export type { TitlebarActionsProps, TitlebarLayoutState }
