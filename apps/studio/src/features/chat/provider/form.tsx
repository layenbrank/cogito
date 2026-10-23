import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@cogito/design/components/form'
import { Input } from '@cogito/design/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Switch } from '@cogito/design/components/switch'
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch, type Control, type ControllerRenderProps } from 'react-hook-form'

import { PROVIDER_KINDS } from './constants.ts'
import { ModelChips, ModelField, ModelsField } from './model-field.tsx'
import { collectModelOptions } from './models.ts'
import { applyProviderPreset, PROVIDER_FORM_DEFAULTS } from './preset.ts'
import type { ProviderRow } from './row.ts'
import { PROVIDER_SCHEMA, toModelIDs, type ProviderValues } from './schema.ts'

interface ProviderFormProps {
  provider: ProviderRow | null
  isSaving: boolean
  isUpdating: boolean
  submitLabel: string
  onSubmit: (values: ProviderValues) => void
  onCancel: () => void
}

function toDefaults(provider: ProviderRow | null): ProviderValues {
  if (!provider) return { ...PROVIDER_FORM_DEFAULTS }

  return {
    kind: provider.kind,
    name: provider.name ?? '',
    baseUrl: provider.baseUrl ?? '',
    model: provider.model ?? '',
    models: toModelIDs(provider.models ?? null),
    // 已存的 Key 不读回（主进程只有写/问有没有/删），留空表示不改
    apiKey: '',
    enabled: provider.enabled
  }
}

function KeyField(props: {
  provider: ProviderRow | null
  field: ControllerRenderProps<ProviderValues, 'apiKey'>
}) {
  const [isVisible, updateVisible] = useState(false)
  const { field } = props

  return (
    <div className="relative">
      <Input
        {...field}
        type={isVisible ? 'text' : 'password'}
        autoComplete="off"
        className="pe-9"
        placeholder={props.provider ? '留空表示不修改' : '输入 API Key'}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute inset-e-0.5 top-1/2 -translate-y-1/2"
        aria-label={isVisible ? '隐藏 API Key' : '显示 API Key'}
        onClick={function () {
          updateVisible(function (current) {
            return !current
          })
        }}>
        {isVisible ? <Icon icon="lucide:eye-off" /> : <Icon icon="lucide:eye" />}
      </Button>
    </div>
  )
}

function ApiKeyField(props: { control: Control<ProviderValues>; provider: ProviderRow | null }) {
  return (
    <FormField
      control={props.control}
      name="apiKey"
      render={function ({ field }) {
        return (
          <FormItem>
            <FormLabel>API Key</FormLabel>
            <FormControl>
              <KeyField
                provider={props.provider}
                field={field}
              />
            </FormControl>
            <FormDescription>
              旧密钥不会显示。留空表示不修改，填写后只写入主进程密钥库。
            </FormDescription>
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}

function ProviderForm(props: ProviderFormProps) {
  const { provider, isSaving, isUpdating, submitLabel, onSubmit, onCancel } = props

  const form = useForm<ProviderValues>({
    resolver: zodResolver(PROVIDER_SCHEMA),
    defaultValues: toDefaults(provider)
  })

  // 候选清单跟着厂商 + 已声明的名字走；当前默认模型也算一个候选（见 collectModelOptions）
  // 用 useWatch 订阅而不是 form.watch()：后者返回的函数不能被安全记忆化（React Compiler 会跳过本组件）
  const kind = useWatch({ control: form.control, name: 'kind' })
  const declared = useWatch({ control: form.control, name: 'models' })
  const current = useWatch({ control: form.control, name: 'model' })
  const modelOptions = collectModelOptions({ kind, declared, current })

  return (
    <Form {...form}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit(onSubmit)}>
        {isUpdating ? (
          <ApiKeyField
            control={form.control}
            provider={provider}
          />
        ) : null}
        <FormField
          control={form.control}
          name="kind"
          render={function ({ field }) {
            return (
              <FormItem>
                <FormLabel>Provider</FormLabel>
                <Select
                  items={PROVIDER_KINDS}
                  value={field.value}
                  onValueChange={function (value) {
                    if (value === null) return
                    field.onChange(value)

                    // 换厂商时把这一家的出厂值填回去（规则见 applyProviderPreset）
                    const patch = applyProviderPreset(value, form.getValues())
                    form.setValue('name', patch.name)
                    form.setValue('baseUrl', patch.baseUrl)
                    form.setValue('model', patch.model)
                    form.setValue('models', patch.models)
                  }}>
                  <FormControl>
                    <SelectTrigger
                      className="w-full"
                      aria-label="Provider">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {PROVIDER_KINDS.map(function (kind) {
                      return (
                        <SelectItem
                          key={kind.value}
                          value={kind.value}>
                          {kind.label}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                <FormDescription>
                  选云端厂商会自动填好服务地址与常用模型，密钥要自己填；本地运行时模型名请照 `ollama
                  list` 填。
                </FormDescription>
                <FormMessage />
              </FormItem>
            )
          }}
        />

        <FormField
          control={form.control}
          name="name"
          render={function ({ field }) {
            return (
              <FormItem>
                <FormLabel>名称</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="本地 Ollama"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )
          }}
        />

        <FormField
          control={form.control}
          name="baseUrl"
          render={function ({ field }) {
            return (
              <FormItem>
                <FormLabel>服务地址</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="http://127.0.0.1:11434/v1"
                  />
                </FormControl>
                <FormDescription>
                  OpenAI 兼容根路径，要带 /v1（Ollama：http://127.0.0.1:11434/v1；LM Studio：
                  http://127.0.0.1:1234/v1）
                </FormDescription>
                <FormMessage />
              </FormItem>
            )
          }}
        />

        <FormField
          control={form.control}
          name="model"
          render={function ({ field }) {
            return (
              <FormItem>
                <FormLabel>默认模型</FormLabel>
                <FormControl>
                  <ModelField
                    value={field.value}
                    options={modelOptions}
                    placeholder="选择或输入模型名"
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormDescription>
                  发送时默认用它。清单只是预填，清单外的名字直接输入后回车也能用。
                </FormDescription>
                <FormMessage />
              </FormItem>
            )
          }}
        />

        <FormField
          control={form.control}
          name="models"
          render={function ({ field }) {
            return (
              <FormItem>
                <FormLabel>可选用模型</FormLabel>
                <FormControl>
                  <ModelsField
                    value={field.value}
                    options={modelOptions}
                    placeholder="选择可用模型"
                    onChange={field.onChange}
                  />
                </FormControl>
                <ModelChips
                  models={field.value}
                  onChange={field.onChange}
                />
                <FormDescription>
                  会出现在对话页的模型选择器里；留空表示只提供默认模型。
                </FormDescription>
                <FormMessage />
              </FormItem>
            )
          }}
        />

        {isUpdating ? null : (
          <ApiKeyField
            control={form.control}
            provider={provider}
          />
        )}

        <FormField
          control={form.control}
          name="enabled"
          render={function ({ field }) {
            return (
              <FormItem className="flex flex-row items-center justify-between">
                <FormLabel>启用</FormLabel>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-label="启用"
                  />
                </FormControl>
              </FormItem>
            )
          }}
        />

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}>
            取消
          </Button>
          <Button
            type="submit"
            disabled={isSaving}>
            {isSaving ? '保存中…' : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  )
}

export { ProviderForm }
