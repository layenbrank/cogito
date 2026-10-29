import { Button } from '@cogito/design/components/button'
import { Label } from '@cogito/design/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Textarea } from '@cogito/design/components/textarea'

import type { ActionEntry } from '@/lib/directive-ipc.ts'

interface RunSurfaceTrialTabProps {
  catalog: ActionEntry[]
  trialAction: string
  trialParamsJson: string
  onTrialActionChange: (actionId: string) => void
  onTrialParamsJsonChange: (text: string) => void
  onTrial: () => void
}

function RunSurfaceTrialTab(props: RunSurfaceTrialTabProps) {
  return (
    <div className="grid shrink-0 max-w-xl gap-2">
      <Label>动作</Label>
      <Select
        items={Object.fromEntries(
          props.catalog.map(function (entry) {
            return [entry.id, entry.id]
          })
        )}
        value={props.trialAction || undefined}
        onValueChange={function (value) {
          if (value) props.onTrialActionChange(value)
        }}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="选择要试跑的动作" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {props.catalog.map(function (entry) {
            return (
              <SelectItem
                key={entry.id}
                value={entry.id}>
                {entry.id}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      <Label>参数 (JSON)</Label>
      <Textarea
        value={props.trialParamsJson}
        onChange={function (event) {
          props.onTrialParamsJsonChange(event.target.value)
        }}
        rows={3}
        className="font-mono text-xs"
      />
      <Button
        size="sm"
        className="w-fit"
        onClick={props.onTrial}>
        试跑
      </Button>
    </div>
  )
}

export { RunSurfaceTrialTab }
