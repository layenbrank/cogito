import { Badge } from '@cogito/design/components/badge'
import { Icon } from '@iconify/react/offline'
import type { ReactNode } from 'react'

import { findStepKind } from '@/views/directive/model/step-utils.ts'
import type { Step } from '@/views/directive/model/types.ts'

import {
  KIND_LABEL,
  findStepHint,
  findStepIcon,
  findStepTitle
} from '@/views/directive/orchestrator/canvas/step-node-icon.ts'
import { StepNodeMenu } from '@/views/directive/orchestrator/canvas/step-node-menu.tsx'

interface StepNodeProps {
  step: Step
  depth: number
  isSelected: boolean
  showConnector: boolean
  onSelect: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDuplicate: () => void
  onRemove: () => void
  children?: ReactNode
}

function StepNode(props: StepNodeProps) {
  const kind = findStepKind(props.step)
  const title = findStepTitle(props.step, kind)
  const hint = findStepHint(props.step)

  return (
    <div className="relative">
      {props.showConnector ? (
        <div
          aria-hidden
          className="absolute left-1/2 top-0 h-4 w-px -translate-x-1/2 -translate-y-full bg-border"
        />
      ) : null}
      <div
        role="button"
        tabIndex={0}
        onClick={props.onSelect}
        onKeyDown={function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            props.onSelect()
          }
        }}
        className={
          'group flex w-full cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-left text-sm shadow-sm transition-colors ' +
          (props.isSelected
            ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
            : 'border-border bg-card hover:border-primary/40 hover:bg-muted/40')
        }
        style={{ marginLeft: props.depth * 16 }}>
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground">
          <Icon
            icon={findStepIcon(kind)}
            className="size-4"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{KIND_LABEL[kind]}</Badge>
            {props.step.id ? (
              <span className="truncate text-xs text-muted-foreground">{props.step.id}</span>
            ) : null}
          </div>
          <p className="mt-1 truncate font-medium">{title}</p>
          {hint ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <StepNodeMenu
          onMoveUp={props.onMoveUp}
          onMoveDown={props.onMoveDown}
          onDuplicate={props.onDuplicate}
          onRemove={props.onRemove}
        />
      </div>
      {props.children ? <div className="mt-4 space-y-4 pl-2">{props.children}</div> : null}
    </div>
  )
}

export { StepNode }
