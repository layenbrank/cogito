import { ScrollArea } from '@i-thinking/design/components/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@i-thinking/design/components/tabs'
import { useMemo, useState, type ReactNode } from 'react'

import { useCorexStore } from '@/stores/corex.ts'
import { replaceStep } from '@/views/directive/model/step-utils.ts'
import type { DirectiveContent, Step } from '@/views/directive/model/types.ts'

import { findStepByToken } from '@/views/directive/orchestrator/inspector/find-step-by-token.ts'
import { DirectivePanel } from '@/views/directive/orchestrator/inspector/directive-panel.tsx'
import { collectStepRefs } from '@/views/directive/orchestrator/inspector/param-ref.ts'
import { StepPanel } from '@/views/directive/orchestrator/inspector/step-panel.tsx'

interface InspectorProps {
  draft: DirectiveContent
  selectedToken: string | null
  onChange: (next: DirectiveContent) => void
}

function Inspector(props: InspectorProps) {
  const catalog = useCorexStore(function (state) {
    return state.catalog
  })
  const step = findStepByToken(props.draft.steps, props.selectedToken)
  const tabKey = props.selectedToken ?? '__directive__'

  const refContext = useMemo(
    function () {
      return {
        variables: props.draft.variables ?? {},
        inputs: props.draft.inputs ?? [],
        steps: collectStepRefs(props.draft.steps, {
          excludeId: step?.id ?? null
        })
      }
    },
    [props.draft.variables, props.draft.inputs, props.draft.steps, step?.id]
  )

  function patchDraft(patch: Partial<DirectiveContent>) {
    props.onChange({ ...props.draft, ...patch })
  }

  function patchStep(next: Step) {
    if (!props.selectedToken) return
    const steps = replaceStep(props.draft.steps, props.selectedToken, next)
    patchDraft({ steps: steps })
  }

  const directivePanel = (
    <DirectivePanel
      draft={props.draft}
      onPatch={patchDraft}
    />
  )

  const stepPanel = (
    <StepPanel
      step={step}
      selectedToken={props.selectedToken}
      catalog={catalog}
      refContext={refContext}
      onPatchStep={patchStep}
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-l bg-background">
      <InspectorTabShell
        key={tabKey}
        selectedToken={props.selectedToken}
        stepPanel={stepPanel}
        directivePanel={directivePanel}
      />
    </div>
  )
}

interface InspectorTabShellProps {
  selectedToken: string | null
  stepPanel: ReactNode
  directivePanel: ReactNode
}

function InspectorTabShell(props: InspectorTabShellProps) {
  const [tab, setTab] = useState(function () {
    return props.selectedToken ? 'step' : 'directive'
  })

  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b px-3 pt-2">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="step">步骤</TabsTrigger>
          <TabsTrigger value="directive">指令</TabsTrigger>
        </TabsList>
      </div>
      <ScrollArea className="h-0 min-h-0 flex-1">
        <div className="space-y-4 p-3 text-sm">
          <TabsContent
            value="step"
            className="mt-0">
            {props.stepPanel}
          </TabsContent>
          <TabsContent
            value="directive"
            className="mt-0">
            {props.directivePanel}
          </TabsContent>
        </div>
      </ScrollArea>
    </Tabs>
  )
}

export { Inspector }
