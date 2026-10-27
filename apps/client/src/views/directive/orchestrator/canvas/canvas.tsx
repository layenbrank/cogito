import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import { Icon } from '@iconify/react/offline'
import type { ReactNode } from 'react'

import type { DirectiveContent } from '@/views/directive/model/types.ts'
import type { Step } from '@/views/directive/model/types.ts'
import {
  buildControlStep,
  duplicateStep,
  moveByToken,
  nextStepId,
  nextToken,
  removeStep
} from '@/views/directive/model/step-utils.ts'
import type { ControlKind } from '@/views/directive/model/step-utils.ts'

import { StepNode } from '@/views/directive/orchestrator/canvas/step-node.tsx'

interface CanvasProps {
  draft: DirectiveContent
  selectedToken: string | null
  onSelectToken: (token: string | null) => void
  onChange: (next: DirectiveContent) => void
}

function buildActionStep(actionId: string, siblings: Step[]): Step {
  const id = nextStepId(actionId, siblings)
  return { id, token: nextToken(), action: actionId, params: {} }
}

function Canvas(props: CanvasProps) {
  function patchSteps(steps: Step[]) {
    props.onChange({ ...props.draft, steps })
  }

  function insertControl(kind: ControlKind) {
    const id = nextStepId(kind, props.draft.steps)
    const step = buildControlStep(kind, id)
    patchSteps([...props.draft.steps, step])
    props.onSelectToken(step.token ?? null)
  }

  function insertAction(actionId: string) {
    const siblings = props.draft.steps
    const step = buildActionStep(actionId, siblings)
    patchSteps([...siblings, step])
    props.onSelectToken(step.token ?? null)
  }

  function findChildBranches(step: Step): { label: string; steps: Step[] }[] {
    if ('if' in step) {
      const branches = [{ label: 'then', steps: step.then }]
      if (step.else && step.else.length > 0) branches.push({ label: 'else', steps: step.else })
      return branches
    }
    if ('parallel' in step) return [{ label: 'parallel', steps: step.parallel }]
    if ('repeat' in step) return [{ label: 'steps', steps: step.steps }]
    if ('steps' in step && !('action' in step)) return [{ label: 'steps', steps: step.steps }]
    return []
  }

  function renderSteps(steps: Step[], depth: number): ReactNode {
    return steps.map(function (step, index) {
      const stepKind = 'action' in step ? step.action : 'control'
      const token = step.token ?? step.id ?? `step-${depth}-${stepKind}`
      const childBranches = findChildBranches(step)

      return (
        <StepNode
          key={token}
          step={step}
          depth={depth}
          showConnector={index > 0}
          isSelected={props.selectedToken === token}
          onSelect={function () {
            props.onSelectToken(token)
          }}
          onMoveUp={function () {
            patchSteps(moveByToken(props.draft.steps, token, -1))
          }}
          onMoveDown={function () {
            patchSteps(moveByToken(props.draft.steps, token, 1))
          }}
          onDuplicate={function () {
            patchSteps(duplicateStep(props.draft.steps, token))
          }}
          onRemove={function () {
            patchSteps(removeStep(props.draft.steps, token))
            if (props.selectedToken === token) props.onSelectToken(null)
          }}>
          {childBranches.map(function (child) {
            if (child.steps.length === 0) return null
            return (
              <div
                key={`${token}-${child.label}-${child.steps
                  .map(function (step) {
                    return step.token ?? step.id
                  })
                  .join('-')}`}
                className="space-y-3 border-l border-dashed border-border pl-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {child.label}
                </p>
                {renderSteps(child.steps, depth + 1)}
              </div>
            )
          })}
        </StepNode>
      )
    })
  }

  const steps = props.draft.steps

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted">
      <div className="flex items-center gap-2 border-b bg-background px-3 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted">
            <Icon
              icon="lucide:plus"
              className="size-3.5"
            />
            插入步骤
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              onClick={function () {
                insertControl('if')
              }}>
              条件分支
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={function () {
                insertControl('repeat')
              }}>
              循环
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={function () {
                insertControl('parallel')
              }}>
              并行
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={function () {
                insertControl('steps')
              }}>
              步骤块
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="sm"
          variant="outline"
          onClick={function () {
            const first = steps[0]
            const actionId = first && 'action' in first ? first.action : 'shell.run'
            insertAction(actionId)
          }}>
          插入动作
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">{steps.length} 步</span>
      </div>
      <ScrollArea className="h-0 min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-6">
          {steps.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-background px-6 py-10 text-center">
              <p className="text-sm font-medium">从左侧动作目录插入第一步</p>
              <p className="mt-1 text-xs text-muted-foreground">
                也可使用上方菜单添加条件、循环或并行结构
              </p>
            </div>
          ) : (
            renderSteps(steps, 0)
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

export { Canvas }
