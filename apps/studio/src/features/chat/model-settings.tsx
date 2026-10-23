import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { parseSliderValue, Slider } from '@cogito/design/components/slider'
import { Switch } from '@cogito/design/components/switch'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  CONTEXT_MARKS,
  findContextByIndex,
  findContextIndex,
  findModelPref,
  MODEL_PREF,
  readModelPrefs,
  THINKING_OPTIONS,
  writeModelPrefs,
  type ModelPref,
  type ThinkingLevel
} from './model-prefs.ts'

interface ModelRow {
  key: string
  providerID: string
  providerName: string
  model: string
  canThink: boolean
}

interface ModelSettingsProps {
  open: boolean
  rows: ModelRow[]
  onOpenChange: (open: boolean) => void
  /** 一个模型都没有时，去设置页加接入 */
  onOpenProviders?: () => void
}

function ContextControl(props: { value: number; onChange: (contextWindow: number) => void }) {
  const index = findContextIndex(props.value)

  return (
    <label className="flex min-w-0 items-center gap-2">
      <Slider
        min={0}
        max={CONTEXT_MARKS.length - 1}
        step={1}
        value={index}
        aria-label="上下文窗口"
        className="min-w-16"
        onValueChange={function (next) {
          props.onChange(findContextByIndex(parseSliderValue(next)))
        }}
      />
      <span className="text-muted-foreground w-9 shrink-0 text-xs">{CONTEXT_MARKS[index]}</span>
    </label>
  )
}

/**
 * 模型列表底部的「模型设置」。
 * 对照 Qoder：表格里改思考强度、显示、上下文窗口，取消或保存，不跳设置页。
 */
export function ModelSettings(props: ModelSettingsProps) {
  const [draft, updateDraft] = useState<Record<string, ModelPref>>({})
  const [seenOpen, updateSeenOpen] = useState(props.open)
  if (props.open !== seenOpen) {
    updateSeenOpen(props.open)
    if (props.open) updateDraft(readModelPrefs())
  }

  function patch(key: string, change: Partial<ModelPref>) {
    updateDraft(function (prev) {
      return {
        ...prev,
        [key]: {
          ...(prev[key] ?? { ...MODEL_PREF }),
          ...change
        }
      }
    })
  }

  function save() {
    try {
      writeModelPrefs(draft)
      toast.success('已保存模型设置')
      props.onOpenChange(false)
    } catch (error) {
      console.warn('[model-settings] 保存失败', error)
      toast.error('模型设置没保存上')
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>模型设置</DialogTitle>
          <DialogDescription>
            关掉显示后，这个模型不再出现在列表里。思考强度和上下文窗口会记在本机，发送时还不会带上。
          </DialogDescription>
        </DialogHeader>

        {props.rows.length === 0 ? (
          <div className="flex flex-col items-start gap-2 py-6">
            <p className="text-muted-foreground text-sm">还没有可用模型</p>
            {props.onOpenProviders ? (
              <Button
                type="button"
                variant="link"
                className="h-auto px-0"
                onClick={function () {
                  props.onOpenChange(false)
                  props.onOpenProviders?.()
                }}>
                去添加模型接入
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="max-h-[min(52vh,28rem)] overflow-auto">
            <div className="text-muted-foreground grid grid-cols-[minmax(0,1.3fr)_7.5rem_4.5rem_minmax(8rem,1fr)] gap-2 px-1 pb-2 text-xs">
              <span>模型名称</span>
              <span>思考强度</span>
              <span className="text-center">显示状态</span>
              <span>上下文窗口</span>
            </div>
            <div className="flex flex-col">
              {props.rows.map(function (row) {
                const pref = findModelPref(row.providerID, row.model, draft)
                return (
                  <div
                    key={row.key}
                    className="grid grid-cols-[minmax(0,1.3fr)_7.5rem_4.5rem_minmax(8rem,1fr)] items-center gap-2 border-t px-1 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
                        <Icon
                          icon="lucide:box"
                          className="size-4"
                        />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{row.model}</span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {row.providerName}
                        </span>
                      </span>
                    </div>

                    {row.canThink ? (
                      <Select
                        items={THINKING_OPTIONS}
                        value={pref.thinking}
                        onValueChange={function (value) {
                          if (value === null) return
                          patch(row.key, { thinking: value as ThinkingLevel })
                        }}>
                        <SelectTrigger
                          className="h-8 w-full"
                          aria-label={`${row.model} 的思考强度`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {THINKING_OPTIONS.map(function (option) {
                            return (
                              <SelectItem
                                key={option.value}
                                value={option.value}>
                                {option.label}
                              </SelectItem>
                            )
                          })}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-muted-foreground text-xs">不支持</span>
                    )}

                    <div className="flex justify-center">
                      <Switch
                        size="sm"
                        checked={pref.isVisible}
                        aria-label={`${row.model} 是否显示`}
                        onCheckedChange={function (checked) {
                          patch(row.key, { isVisible: checked })
                        }}
                      />
                    </div>

                    <ContextControl
                      value={pref.contextWindow}
                      onChange={function (contextWindow) {
                        patch(row.key, { contextWindow })
                      }}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={function () {
              props.onOpenChange(false)
            }}>
            取消
          </Button>
          <Button
            type="button"
            onClick={save}>
            保存设置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export type { ModelRow }
