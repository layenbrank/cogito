/**
 * 输入区「思考强度」：和模型分开、常驻在 composer 里（对齐 VS Code Copilot）。
 *
 * 为什么不塞进模型浮层：切模型和切档位是两件事 —— 模型是「用谁」，
 * 档位是「这次让它想多久」，后者用户会频繁动。混在一个浮层里，
 * 每次调档位都要先打开模型列表，顺带把「用哪个模型」重新看一遍。
 *
 * 模型不支持思考（`canThink` 为假）时整块不渲染：宁可不出现，
 * 也不摆一个点了没反应的禁用项 —— 会让人以为是自己没配对。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { cn } from 'cn'
import { useState } from 'react'

import {
  canThink,
  findModelKey,
  findModelPref,
  THINKING_OPTIONS,
  writeModelThinking
} from '@/features/agent/model/model-prefs'
import type { ThinkingLevel } from '@/features/persist'
import { useProviderStore } from '@/stores/provider'

function ComposerThinking() {
  const activeProvider = useProviderStore(function (state) {
    return state.providers.find(function (provider) {
      return provider.id === state.activeProviderID && provider.enabled
    })
  })
  /** 刚点过、还没被别处读到的档位；菜单重开时清空，重新以 agent.json 为准 */
  const [draft, updateDraft] = useState<Record<string, ThinkingLevel>>({})
  const [open, updateOpen] = useState(false)

  const providerID = activeProvider?.id ?? ''
  const model = activeProvider?.model?.trim() ?? ''
  // 没有模型、或模型名字看不出推理家族时，这个入口没有意义
  const supported = Boolean(providerID && model) && canThink(model)

  const key = findModelKey(providerID, model)
  const selected = draft[key] ?? findModelPref(providerID, model).thinking
  const option =
    THINKING_OPTIONS.find(function (item) {
      return item.value === selected
    }) ?? THINKING_OPTIONS[0]

  if (!supported) return null

  function openMenu(next: boolean) {
    // 打开时清掉草稿：设置弹窗里可能刚改过同一份偏好，别让旧值盖住磁盘
    if (next) updateDraft({})
    updateOpen(next)
  }

  function select(next: ThinkingLevel) {
    if (!providerID || !model) return
    writeModelThinking(providerID, model, next)
    updateDraft(function (previous) {
      return { ...previous, [key]: next }
    })
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={openMenu}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`思考强度：${option.label}`}
            title={`思考强度：${option.label} · ${option.hint}`}
            className={cn(
              'text-muted-foreground h-7 shrink-0 gap-1 px-2 text-xs',
              // 关闭档给一点「没开」的视觉落差，但仍可点
              option.value === 'off' && 'opacity-70'
            )}
          />
        }>
        <Icon
          icon="lucide:brain"
          className="size-3.5 shrink-0"
        />
        {/* 窄的 composer 只留图标（title 里有全量说明），宽了再补档位名 */}
        <span className="hidden @min-[36rem]:inline">{option.label}</span>
        <Icon
          icon="lucide:chevrons-up-down"
          className="size-3 shrink-0 opacity-55"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-64">
        {/* Label 是 base-ui GroupLabel：脱离 Group 会抛 MenuGroupContext is missing */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>思考强度</DropdownMenuLabel>
          <p className="text-muted-foreground px-2 pb-1 text-[11px] leading-snug">
            档位越高，回答前推演越多、也越慢；按模型保存，换模型互不影响。
          </p>
          {THINKING_OPTIONS.map(function (item) {
            const active = item.value === selected
            return (
              <DropdownMenuItem
                key={item.value}
                className="gap-2"
                onClick={function () {
                  select(item.value)
                }}>
                <Icon
                  icon={active ? 'lucide:check' : 'lucide:circle'}
                  className={cn(
                    'size-3.5 shrink-0',
                    active ? 'text-primary' : 'text-muted-foreground/40'
                  )}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[13px]">{item.label}</span>
                  <span className="text-muted-foreground text-[11px]">{item.hint}</span>
                </span>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { ComposerThinking }
