/**
 * 模型浮层选择器：默认（组织）/ 自定义分段 + 模型设置入口
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@cogito/design/components/popover'
import { Tabs, TabsList, TabsTrigger } from '@cogito/design/components/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { useEffect, useRef, useState, type ReactElement } from 'react'

import { AgentModelSettings } from './model-settings'
import styles from './model-picker.module.scss'
import { ensureCogitoProvider } from '@/features/agent/acp/cogito-provider'
import { switchGooseProviderModel } from '@/features/agent/acp/session'
import {
  findModelLabel,
  findProviderBilling,
  findProviderHint,
  findProviderLabel
} from '@/features/agent/model/display'
import { findModelPref, readModelPrefs } from '@/features/agent/model/model-prefs'
import { parseModels } from '@/features/agent/model/providers'
import { isGatewayTarget } from '@/features/quota/gate'
import { useProviderStore, type AgentProvider } from '@/stores/provider'

type InventoryTab = 'default' | 'custom'

interface ModelPickerProps {
  /** 跳转接入管理（模型设置空态） */
  onOpenSettings?: () => void
  children: ReactElement
}

interface VisibleModelRow {
  provider: AgentProvider
  model: string
}

/** 常见接入 → lucide 图标（无品牌包时的可读占位） */
function findProviderIcon(kind: string) {
  const key = kind.trim().toLowerCase().replace(/_/g, '-')
  if (key.includes('deepseek')) return 'lucide:sparkles'
  if (key.includes('openai') || key.includes('azure')) return 'lucide:hexagon'
  if (key.includes('anthropic') || key.includes('claude')) return 'lucide:bot'
  if (key.includes('google') || key.includes('gemini')) return 'lucide:gem'
  if (key.includes('ollama') || key.includes('atomic')) return 'lucide:cpu'
  if (key.includes('moonshot') || key.includes('kimi')) return 'lucide:moon'
  if (key.includes('alibaba') || key.includes('dashscope') || key.includes('qwen')) {
    return 'lucide:cloud'
  }
  if (key.includes('zhipu') || key.includes('glm')) return 'lucide:brain'
  if (key.includes('openrouter')) return 'lucide:route'
  if (key.includes('cursor')) return 'lucide:terminal'
  if (key.includes('cogito') || key.includes('gateway')) return 'lucide:building-2'
  return 'lucide:box'
}

/** 右侧短标签：有计费/运行方式数据时展示 */
function findBillingBadge(billing: string) {
  const value = billing.trim()
  if (!value) return null
  if (value.includes('组织')) return '组织'
  if (value.includes('本机')) return '本机'
  if (value.includes('订阅')) return '订阅'
  if (value.includes('免费') || /^free$/i.test(value)) return 'free'
  if (value.includes('按量')) return '按量'
  if (value.includes('企业')) return '企业'
  if (value.length <= 6) return value
  return null
}

function collectVisibleRows(providers: AgentProvider[], prefs: ReturnType<typeof readModelPrefs>) {
  const rows: VisibleModelRow[] = []
  for (const provider of providers) {
    const models = parseModels(provider.models).filter(function (model) {
      return findModelPref(provider.id, model, prefs).visible
    })
    for (const model of models) {
      rows.push({ provider, model })
    }
  }
  return rows
}

/** 仅滚动 `.list` 口，避免 scrollIntoView 带动整页；居中并避开 sticky 标题 scroll-padding */
function scrollActiveRowIntoView(list: HTMLElement | null) {
  if (!list) return
  const row = list.querySelector('[data-active]')
  if (!(row instanceof HTMLElement)) return

  const stickyPad = Number.parseFloat(getComputedStyle(list).scrollPaddingTop) || 0
  const listRect = list.getBoundingClientRect()
  const rowRect = row.getBoundingClientRect()
  const rowOffset = rowRect.top - listRect.top + list.scrollTop
  const visible = Math.max(list.clientHeight - stickyPad, 0)
  const nextTop = rowOffset - stickyPad - (visible - rowRect.height) / 2
  list.scrollTo({ top: Math.max(0, nextTop), behavior: 'auto' })
}

function AgentModelPicker(props: ModelPickerProps) {
  const [open, updateOpen] = useState(false)
  const [settingsOpen, updateSettingsOpen] = useState(false)
  /** 模型偏好落在 agent.json：挂载时读一次，设置弹窗关闭（可能改过偏好）时再读一次 */
  const [prefs, updatePrefs] = useState(readModelPrefs)
  const [tab, updateTab] = useState<InventoryTab>('default')
  const listRef = useRef<HTMLDivElement>(null)
  /** 仅在打开 / 切到含选中项的 tab 后滚一次，避免打开后用户手滑再被拽回去 */
  const pendingActiveScrollRef = useRef(false)
  const providers = useProviderStore(function (state) {
    return state.providers
  })
  const activeProviderID = useProviderStore(function (state) {
    return state.activeProviderID
  })

  const enabledProviders = providers
    .filter(function (provider) {
      return provider.enabled
    })
    // 组织模型固定排最前：登录即可用，不该被个人接入的「最近更新」挤到后面；
    // 其余分组保持 store 顺序（即最近更新的接入在前）
    .toSorted(function (a, b) {
      const aGateway = isGatewayTarget(a.kind || a.id)
      const bGateway = isGatewayTarget(b.kind || b.id)
      if (aGateway === bGateway) return 0
      return aGateway ? -1 : 1
    })

  const defaultProviders = enabledProviders.filter(function (provider) {
    return isGatewayTarget(provider.kind || provider.id)
  })
  const customProviders = enabledProviders.filter(function (provider) {
    return !isGatewayTarget(provider.kind || provider.id)
  })

  const tabProviders = tab === 'default' ? defaultProviders : customProviders
  const visibleRows = collectVisibleRows(tabProviders, prefs)

  async function selectModel(providerId: string, model: string) {
    const provider = useProviderStore.getState().providers.find(function (row) {
      return row.id === providerId
    })
    // goose 认的是 providerId（行里的 kind），不是本地行 id
    const gooseProviderId = provider?.kind || providerId
    useProviderStore.getState().toSetActiveProvider(providerId)
    await useProviderStore.getState().toUpdateProvider([{ id: providerId, model }])
    updateOpen(false)
    try {
      if (isGatewayTarget(gooseProviderId)) {
        await ensureCogitoProvider()
      }
      await switchGooseProviderModel(gooseProviderId, model)
    } catch (error) {
      console.warn('[model-picker] 切换 goose session 失败:', error)
    }
  }

  function openPicker(next: boolean) {
    if (next) {
      pendingActiveScrollRef.current = true
      updatePrefs(readModelPrefs())
      const active = enabledProviders.find(function (provider) {
        return provider.id === activeProviderID
      })
      if (active && isGatewayTarget(active.kind || active.id)) {
        updateTab('default')
      } else if (active) {
        updateTab('custom')
      } else if (defaultProviders.length === 0 && customProviders.length > 0) {
        updateTab('custom')
      } else {
        updateTab('default')
      }
    } else {
      pendingActiveScrollRef.current = false
    }
    updateOpen(next)
  }

  useEffect(
    function () {
      if (!open || !pendingActiveScrollRef.current) return

      let cancelled = false
      const outer = requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (cancelled) return
          pendingActiveScrollRef.current = false
          scrollActiveRowIntoView(listRef.current)
        })
      })

      return function () {
        cancelled = true
        cancelAnimationFrame(outer)
      }
    },
    [open, tab, activeProviderID, prefs]
  )

  function renderProviderGroup(provider: AgentProvider) {
    const kind = provider.kind || provider.id
    const groupLabel = findProviderLabel(kind, provider.name)
    const billing = findProviderBilling(kind, provider.name)
    const hint = findProviderHint(kind, provider.name)
    const badge = findBillingBadge(billing)
    const models = parseModels(provider.models).filter(function (model) {
      return findModelPref(provider.id, model, prefs).visible
    })
    if (models.length === 0) return null

    return (
      <div
        key={provider.id}
        className={styles.group}>
        <div className={styles.groupTitle}>{groupLabel}</div>
        {models.map(function (model) {
          const isActive = provider.id === activeProviderID && provider.model === model
          const label = findModelLabel(model, provider)
          const desc = hint.length > 36 ? `${hint.slice(0, 34)}…` : hint
          return (
            <Tooltip key={`${provider.id}-${model}`}>
              <TooltipTrigger
                delay={420}
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    data-active={isActive || undefined}
                    className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
                    onClick={function () {
                      void selectModel(provider.id, model)
                    }}
                  />
                }>
                <span className={styles.modelBadge}>
                  <Icon
                    icon={findProviderIcon(kind)}
                    width={15}
                    height={15}
                  />
                  {isActive ? (
                    <span className={styles.checkMark}>
                      <Icon
                        icon="lucide:check"
                        width={9}
                        height={9}
                      />
                    </span>
                  ) : null}
                </span>
                <span className={styles.rowBody}>
                  <span className={styles.modelName}>{label}</span>
                  <span className={styles.modelDesc}>{desc}</span>
                </span>
                {badge ? <span className={styles.billingBadge}>{badge}</span> : null}
              </TooltipTrigger>
              <TooltipContent
                side="left"
                sideOffset={10}
                className="max-w-56 flex-col items-start gap-1 rounded-lg px-3 py-2 text-[12px] leading-snug">
                <p className="text-[13px] font-medium">{label}</p>
                <p className="text-background/75">{hint}</p>
                {billing ? <p className="text-background/55">{billing}</p> : null}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    )
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={openPicker}>
        <PopoverTrigger render={props.children} />
        <PopoverContent
          side="top"
          align="start"
          className={styles.surface}>
          <div className={styles.tabs}>
            <Tabs
              value={tab}
              className={styles.tabsRoot}
              onValueChange={function (value) {
                if (value !== 'default' && value !== 'custom') return
                pendingActiveScrollRef.current = true
                updateTab(value as InventoryTab)
              }}>
              <TabsList
                size="default"
                className={styles.tabsList}>
                <TabsTrigger
                  value="default"
                  className="flex-1">
                  默认
                </TabsTrigger>
                <TabsTrigger
                  value="custom"
                  className="flex-1">
                  自定义
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div
            ref={listRef}
            className={styles.list}>
            {enabledProviders.length === 0 ? (
              <p className={`${styles.empty} text-muted-foreground`}>
                还没有可用模型，请先到设置里添加
              </p>
            ) : visibleRows.length === 0 ? (
              <p className={`${styles.empty} text-muted-foreground`}>
                {tab === 'default' ? '暂无组织默认模型' : '暂无自定义接入，请到设置添加'}
              </p>
            ) : (
              tabProviders.map(renderProviderGroup)
            )}
          </div>

          <div className={styles.footer}>
            <Button
              variant="ghost"
              className={`${styles.settingsBtn} w-full`}
              onClick={function () {
                updateOpen(false)
                if (props.onOpenSettings) {
                  props.onOpenSettings()
                  return
                }
                updateSettingsOpen(true)
              }}>
              <Icon
                icon="lucide:settings"
                width={16}
                height={16}
              />
              模型设置
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <AgentModelSettings
        open={settingsOpen}
        onClose={function () {
          updateSettingsOpen(false)
          updatePrefs(readModelPrefs())
        }}
        onOpenProviders={props.onOpenSettings}
      />
    </>
  )
}

export { AgentModelPicker }
export type { ModelPickerProps }
