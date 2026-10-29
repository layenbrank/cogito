import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Separator } from '@cogito/design/components/separator'
import { Switch } from '@cogito/design/components/switch'
import { Textarea } from '@cogito/design/components/textarea'

import { BUCKETS, isValidDirectiveName } from '@/shared/ipc/specs/sidecar'
import type { DirectiveContent } from '@/views/directive/model/types.ts'
import { InputsEditor } from '@/views/directive/orchestrator/inspector/inputs-editor.tsx'
import { VariablesEditor } from '@/views/directive/orchestrator/inspector/variables-editor.tsx'

interface DirectiveSurfaceProps {
  draft: DirectiveContent
  onPatch: (patch: Partial<DirectiveContent>) => void
}

function DirectiveSurface(props: DirectiveSurfaceProps) {
  const nameError =
    props.draft.name && !isValidDirectiveName(props.draft.name) ? '名称不能含路径分隔符或 ..' : null
  const variables = props.draft.variables ?? {}
  const inputs = props.draft.inputs ?? []

  return (
    <div className="space-y-3">
      <Label htmlFor="directive-name">名称</Label>
      <Input
        id="directive-name"
        value={props.draft.name}
        onChange={function (event) {
          props.onPatch({ name: event.target.value })
        }}
      />
      {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
      <Label htmlFor="directive-desc">描述</Label>
      <Textarea
        id="directive-desc"
        value={props.draft.description}
        onChange={function (event) {
          props.onPatch({ description: event.target.value })
        }}
        rows={2}
      />
      <Label>分类</Label>
      <Select
        items={{
          __none: '未分类',
          system: 'system',
          network: 'network',
          data: 'data',
          ui: 'ui',
          logic: 'logic',
          plugin: 'plugin'
        }}
        value={props.draft.bucket ?? '__none'}
        onValueChange={function (value) {
          if (value === null) return
          props.onPatch({ bucket: value === '__none' ? null : (value as (typeof BUCKETS)[number]) })
        }}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="未分类" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">未分类</SelectItem>
          {BUCKETS.map(function (bucket) {
            return (
              <SelectItem
                key={bucket}
                value={bucket}>
                {bucket}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      <Label>全局 on_error</Label>
      <Select
        items={{
          default: '默认',
          abort: 'abort（中止）',
          continue: 'continue（继续）',
          skip: 'skip（跳过）'
        }}
        value={props.draft.on_error ?? 'default'}
        onValueChange={function (value) {
          if (value === null) return
          props.onPatch({
            on_error: value === 'default' ? undefined : (value as 'abort' | 'continue' | 'skip')
          })
        }}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="默认" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">默认</SelectItem>
          <SelectItem value="abort">abort（中止）</SelectItem>
          <SelectItem value="continue">continue（继续）</SelectItem>
          <SelectItem value="skip">skip（跳过）</SelectItem>
        </SelectContent>
      </Select>

      <Separator />
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        输入
        {inputs.length > 0 ? (
          <span className="ml-1 font-mono normal-case text-muted-foreground/80">
            ({inputs.length})
          </span>
        ) : null}
      </h3>
      <InputsEditor
        inputs={inputs}
        onChange={function (next) {
          props.onPatch({ inputs: next })
        }}
      />

      <Separator />
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        变量
        {Object.keys(variables).length > 0 ? (
          <span className="ml-1 font-mono normal-case text-muted-foreground/80">
            ({Object.keys(variables).length})
          </span>
        ) : null}
      </h3>
      <VariablesEditor
        variables={variables}
        onChange={function (next) {
          props.onPatch({ variables: next })
        }}
      />

      <Separator />
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">权限</h3>
      {(['shell', 'filesystem', 'network', 'ui', 'capture', 'clipboard'] as const).map(
        function (key) {
          const checked = props.draft.permissions?.[key] ?? false
          return (
            <label
              key={key}
              className="flex items-center justify-between gap-2">
              <span>{key}</span>
              <Switch
                checked={checked}
                onCheckedChange={function (next) {
                  props.onPatch({
                    permissions: { ...props.draft.permissions, [key]: next === true }
                  })
                }}
              />
            </label>
          )
        }
      )}
    </div>
  )
}

export { DirectiveSurface }
