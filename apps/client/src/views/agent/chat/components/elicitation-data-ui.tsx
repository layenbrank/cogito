/**
 * 结构化追问 data part：按 ChatSchemaField 渲染表单并回执。
 */
import { makeAssistantDataUI, type DataMessagePartProps } from '@assistant-ui/react'
import { ELICITATION_PART_NAME } from '@cogito/chat/adapters/chat-model'
import type { ChatElicitationSchema, ChatSchemaField } from '@cogito/chat/ports'
import { QuestionActions, QuestionDescription, QuestionPrompt } from '@cogito/design/assistant/question'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Switch } from '@cogito/design/components/switch'
import { useState } from 'react'
import { toast } from 'sonner'

import { chatModelPort } from '@/features/agent/port/instance'

interface ChatElicitationPartData {
  elicitationId: string
  schema: ChatElicitationSchema
  prompt?: string
}

function findInitialValues(fields: readonly ChatSchemaField[]): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.default !== undefined) {
      values[field.name] = field.default
      continue
    }
    if (field.type === 'boolean') {
      values[field.name] = false
    } else if (field.type === 'number' || field.type === 'integer') {
      values[field.name] = ''
    } else {
      values[field.name] = ''
    }
  }
  return values
}

function SchemaFieldInput(props: {
  field: ChatSchemaField
  value: unknown
  onChange: (next: unknown) => void
}) {
  const field = props.field
  const id = `elicitation-${field.name}`

  if (field.type === 'boolean') {
    return (
      <div className="flex items-center gap-2">
        <Switch
          id={id}
          checked={Boolean(props.value)}
          onCheckedChange={function (checked) {
            props.onChange(checked)
          }}
        />
        <Label htmlFor={id}>{field.description ?? field.name}</Label>
      </div>
    )
  }

  if (field.type === 'enum' && field.enumValues && field.enumValues.length > 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>
          {field.description ?? field.name}
          {field.required ? ' *' : ''}
        </Label>
        <Select
          value={typeof props.value === 'string' ? props.value : ''}
          onValueChange={function (next) {
            props.onChange(next)
          }}>
          <SelectTrigger
            id={id}
            className="w-full">
            <SelectValue placeholder="请选择" />
          </SelectTrigger>
          <SelectContent>
            {field.enumValues.map(function (option) {
              return (
                <SelectItem
                  key={option.value}
                  value={option.value}>
                  {option.label ?? option.value}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </div>
    )
  }

  const inputType = field.type === 'number' || field.type === 'integer' ? 'number' : 'text'

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {field.description ?? field.name}
        {field.required ? ' *' : ''}
      </Label>
      <Input
        id={id}
        type={inputType}
        value={typeof props.value === 'string' || typeof props.value === 'number' ? String(props.value) : ''}
        onChange={function (event) {
          const raw = event.target.value
          if (field.type === 'number' || field.type === 'integer') {
            props.onChange(raw === '' ? '' : Number(raw))
            return
          }
          props.onChange(raw)
        }}
      />
    </div>
  )
}

function ElicitationPartRender(props: DataMessagePartProps<ChatElicitationPartData>) {
  // assistant-ui 的 DataMessagePartProps<T> 与 MessagePartState 交叉后 data 退化为 any，这里收回类型
  const { elicitationId, schema, prompt } = props.data as ChatElicitationPartData
  const fields = schema.fields ?? []
  const [values, updateValues] = useState(function () {
    return findInitialValues(fields)
  })
  const [submitted, updateSubmitted] = useState(false)

  function patchValue(name: string, next: unknown) {
    updateValues(function (previous) {
      return { ...previous, [name]: next }
    })
  }

  function respond(action: 'accept' | 'cancel') {
    if (submitted) return
    updateSubmitted(true)
    const delivered = chatModelPort.respondToElicitation?.({
      elicitationId,
      action,
      content:
        action === 'accept'
          ? Object.fromEntries(
              Object.entries(values).filter(function (entry) {
                return entry[1] !== '' && entry[1] !== undefined
              })
            )
          : undefined
    })
    if (delivered) {
      toast.success(action === 'accept' ? '已提交' : '已取消', { duration: 1000 })
      return
    }
    updateSubmitted(false)
    toast.error('这次追问已经失效，请重新发送', { duration: 2000 })
  }

  return (
    <form
      className="not-prose border-border bg-background my-2 space-y-3 rounded-md border p-4"
      onSubmit={function (event) {
        event.preventDefault()
        respond('accept')
      }}>
      <QuestionPrompt>{schema.title ?? '需要你补充信息'}</QuestionPrompt>
      {prompt ? <QuestionDescription>{prompt}</QuestionDescription> : null}
      {schema.description ? <QuestionDescription>{schema.description}</QuestionDescription> : null}
      {fields.map(function (field: ChatSchemaField) {
        return (
          <SchemaFieldInput
            key={field.name}
            field={field}
            value={values[field.name]}
            onChange={function (next) {
              patchValue(field.name, next)
            }}
          />
        )
      })}
      <QuestionActions>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={submitted}
          onClick={function () {
            respond('cancel')
          }}>
          取消
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={submitted}>
          提交
        </Button>
      </QuestionActions>
    </form>
  )
}

const AgentElicitationDataUI = makeAssistantDataUI({
  name: ELICITATION_PART_NAME,
  render: ElicitationPartRender
})

export { AgentElicitationDataUI }
