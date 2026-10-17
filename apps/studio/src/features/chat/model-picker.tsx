import { Icon } from '@iconify/react/offline'
import {
  findProviderSource,
  PROVIDER_SOURCE_LABELS,
  PROVIDER_SOURCE_NOTES,
  supportsTools
} from '@i-thinking/agent/provider'
import { Button } from '@i-thinking/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@i-thinking/design/components/dropdown-menu'
import { Input } from '@i-thinking/design/components/input'
import { useState } from 'react'

import { canThink, findModelKey, findModelPref, readModelPrefs } from './model-prefs.ts'
import { ModelSettings, type ModelRow } from './model-settings.tsx'
import { findPlatformBlocker } from './platform.ts'
import { findTargetLabel } from '@/features/chat/port/model.ts'
import { useProviders } from '@/features/chat/provider/query.ts'
import { collectProviderModels } from '@/features/chat/provider/row.ts'
import type { ProviderModel, ProviderRow } from '@/features/chat/provider/row.ts'
import { useAgentStore } from '@/stores/agent.ts'

/**
 * 模型选择器：**一份清单，两种来源分组**。
 *
 * 对照 Cursor / Copilot 的模型菜单：分组表达「这个模型谁提供的」（组织 ／ 我的）；能力、工具、
 * 审批对两组完全一致（调用都由主进程发出，见 `features/chat/platform.ts` 的说明），**只有计费口径
 * 不一样** —— 同一个模型名两组各有一份，组织模型经平台网关（占平台额度），我的模型直连上游
 * （只进本机账本）。所以分组标题带上 `PROVIDER_SOURCE_NOTES`，否则「用了某个模型但额度不动」
 * 看起来就像个 bug（实例见 docs/apps/studio/troubleshooting.md 的额度一节）。
 *
 * 选中项落 `chat.providerID` + `chat.model`，是发送链路唯一认的两个字段；
 * 组织模型那一行由登录态与网关目录派生，在设置页只读。
 */

interface ModelPickerProps {
  /** 没有可用模型时的出路：由 app 决定去哪儿（这里是设置页） */
  onOpenSettings?: () => void
}

interface ModelOption {
  provider: ProviderRow
  model: ProviderModel
}

/** 按来源分组，组内保序；组织模型永远排在前面 */
function groupOptions(rows: ProviderRow[]): { platform: ModelOption[]; local: ModelOption[] } {
  const platform: ModelOption[] = []
  const local: ModelOption[] = []

  for (const provider of rows) {
    if (!provider.enabled) continue

    const bucket = findProviderSource(provider.kind) === 'platform' ? platform : local
    bucket.push(
      ...collectProviderModels(provider).map(function (model) {
        return { provider, model }
      })
    )
  }

  return { platform, local }
}

/** 能力标签：只说会被链路用上的差异（不支持工具 = 只能聊天） */
function findCapabilityTags(model: ProviderModel): string[] {
  const tags: string[] = []
  if (!supportsTools(model)) tags.push('仅聊天')
  if (model.capabilities?.reasoning) tags.push('推理')
  return tags
}

function ModelItem(props: { option: ModelOption; isActive: boolean; onPick: () => void }) {
  const { option } = props
  const tags = findCapabilityTags(option.model)

  return (
    <DropdownMenuItem onClick={props.onPick}>
      <Icon
        icon="lucide:check"
        className={props.isActive ? 'text-primary' : 'opacity-0'}
      />
      <span className="min-w-0 flex-1 truncate">{option.model.name || option.model.id}</span>

      {option.model.providerName ? (
        <span className="text-muted-foreground shrink-0 text-xs">{option.model.providerName}</span>
      ) : null}

      {tags.map(function (tag) {
        return (
          <span
            key={tag}
            className="bg-muted text-muted-foreground shrink-0 rounded px-1 py-0.5 text-xs">
            {tag}
          </span>
        )
      })}
    </DropdownMenuItem>
  )
}

export function ModelPicker(props: ModelPickerProps) {
  const [query, updateQuery] = useState('')
  const [isSettingsOpen, updateSettingsOpen] = useState(false)
  const [prefs, updatePrefs] = useState(readModelPrefs)

  const providerID = useAgentStore(function (state) {
    return state.settings.chat.providerID
  })
  const model = useAgentStore(function (state) {
    return state.settings.chat.model
  })
  const update = useAgentStore(function (state) {
    return state.update
  })

  const providersQuery = useProviders()
  const providers = providersQuery.data ?? []
  const blocker = findPlatformBlocker()

  // 生效目标只从发送链路那份推导里拿（`findTargetLabel`），不在这里另算一遍 ——
  // 否则「显示的模型」和「真正跑的模型」会各说各话（兜底选中组织模型时最容易错）
  const target = findTargetLabel(providers, { providerID, model })
  const isAuto = providerID === null

  const active = providers.find(function (provider) {
    return provider.id === providerID
  })
  const activeModel = active
    ? collectProviderModels(active).find(function (item) {
        return item.id === model
      })
    : undefined
  const activeLabel = model && active ? activeModel?.name || model : ''

  const keyword = query.trim().toLowerCase()
  const grouped = groupOptions(providers)

  function isVisible(option: ModelOption): boolean {
    if (!findModelPref(option.provider.id, option.model.id, prefs).isVisible) return false
    if (!keyword) return true

    const label = `${option.model.name ?? ''} ${option.model.id} ${option.model.providerName ?? ''} ${option.provider.name}`
    return label.toLowerCase().includes(keyword)
  }

  function renderGroup(label: string, note: string, options: ModelOption[], hint: string | null) {
    const visible = options.filter(isVisible)
    if (visible.length === 0 && !hint) return null

    return (
      <DropdownMenuGroup>
        <DropdownMenuLabel className="text-muted-foreground text-xs leading-relaxed">
          <span>{label}</span>
          <span className="text-muted-foreground/80 text-xs font-normal">{` · ${note}`}</span>
        </DropdownMenuLabel>

        {visible.length === 0 ? (
          <p className="text-muted-foreground px-2 py-1.5 text-xs leading-relaxed">{hint}</p>
        ) : (
          visible.map(function (option) {
            return (
              <ModelItem
                key={findModelKey(option.provider.id, option.model.id)}
                option={option}
                isActive={option.provider.id === providerID && option.model.id === model}
                onPick={function () {
                  void update('chat', { providerID: option.provider.id, model: option.model.id })
                }}
              />
            )
          })
        )}
      </DropdownMenuGroup>
    )
  }

  const rows: ModelRow[] = [...grouped.platform, ...grouped.local].map(function (option) {
    return {
      key: findModelKey(option.provider.id, option.model.id),
      providerID: option.provider.id,
      providerName: option.provider.name,
      model: option.model.id,
      canThink: option.model.capabilities?.reasoning ?? canThink(option.model.id)
    }
  })

  const hasAnyModel = grouped.platform.length > 0 || grouped.local.length > 0

  // 触发按钮只说真的会发生的事：钉住了就报那个模型，自动就报「自动 · 当前会跑的模型」。
  // 之前未钉住时显示「选择模型」，但它其实已经在用某个模型跑了 —— 语义是错的。
  const trigger = providersQuery.isLoading
    ? { text: '读取模型…', title: '正在读取模型…' }
    : !target
      ? { text: '选择模型', title: blocker ?? '还没有可用模型' }
      : isAuto
        ? {
            text: `自动 · ${target.model}`,
            title: `自动：跟随当前可用模型（组织模型优先），现在会跑 ${target.model}（${target.source}）`
          }
        : { text: activeLabel || target.model, title: `${target.model} · ${target.source}` }

  // 一个模型都没有时，触发按钮直接就是「添加模型」，比点开空菜单再找入口短一步
  if (!hasAnyModel && !providersQuery.isLoading) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground h-7 max-w-52 justify-start gap-1 px-2 text-xs"
        aria-label="选择模型"
        title={blocker ?? '还没有可用模型，去设置里添加'}
        onClick={props.onOpenSettings}>
        <Icon icon="lucide:circle-alert" />
        <span className="truncate">添加模型</span>
      </Button>
    )
  }

  return (
    <>
      <DropdownMenu
        onOpenChange={function (open) {
          if (!open) updateQuery('')
        }}>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground h-7 max-w-52 justify-start gap-1 px-2 text-xs"
              aria-label="选择模型"
              title={trigger.title}
            />
          }>
          <span className="truncate">{trigger.text}</span>
          <Icon
            icon="lucide:chevron-down"
            className="size-3.5 shrink-0 opacity-60"
          />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          className="w-80 p-0">
          <div className="border-border relative border-b p-2">
            <Icon
              icon="lucide:search"
              className="text-muted-foreground pointer-events-none absolute start-4 top-1/2 size-3.5 -translate-y-1/2"
            />
            <Input
              value={query}
              placeholder="搜索模型…"
              aria-label="搜索模型"
              className="h-8 ps-8 text-xs"
              onKeyDown={function (event) {
                event.stopPropagation()
              }}
              onChange={function (event) {
                updateQuery(event.target.value)
              }}
            />
          </div>

          <div className="max-h-72 overflow-y-auto p-1">
            {/* 「自动」= 不钉住 provider：发送链路按组织模型优先兜底。给用户一个显式回退的入口，
                否则一旦选了具体模型就再也回不到自动（之前只能去设置页面改 provider 列）。 */}
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={function () {
                  void update('chat', { providerID: null, model: '' })
                }}
                title="跟随当前可用模型（组织模型优先）">
                <Icon
                  icon="lucide:check"
                  className={isAuto ? 'text-primary' : 'opacity-0'}
                />
                <span className="min-w-0 flex-1 truncate">自动</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {target ? target.model : '还没有可用模型'}
                </span>
              </DropdownMenuItem>
            </DropdownMenuGroup>

            <DropdownMenuSeparator className="my-1" />

            {renderGroup(
              PROVIDER_SOURCE_LABELS.platform,
              PROVIDER_SOURCE_NOTES.platform,
              grouped.platform,
              blocker ?? '服务端没有可用模型'
            )}
            {renderGroup(
              PROVIDER_SOURCE_LABELS.local,
              PROVIDER_SOURCE_NOTES.local,
              grouped.local,
              null
            )}

            {providersQuery.isLoading ? (
              <p className="text-muted-foreground px-2 py-1.5 text-xs">正在读取模型…</p>
            ) : null}

            {!providersQuery.isLoading && keyword && !hasAnyModel ? (
              <p className="text-muted-foreground px-2 py-1.5 text-xs">没有匹配的模型</p>
            ) : null}
          </div>

          <DropdownMenuSeparator className="m-0" />
          <div className="p-1">
            <DropdownMenuItem
              onClick={function () {
                props.onOpenSettings?.()
              }}>
              <Icon icon="lucide:plus" />
              添加模型
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={function () {
                updateSettingsOpen(true)
              }}>
              <Icon icon="lucide:settings" />
              模型设置
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <ModelSettings
        open={isSettingsOpen}
        rows={rows}
        onOpenProviders={props.onOpenSettings}
        onOpenChange={function (open) {
          updateSettingsOpen(open)
          if (!open) updatePrefs(readModelPrefs())
        }}
      />
    </>
  )
}
