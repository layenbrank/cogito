/**
 * 模型浮层选择器：按接入分组（面向普通用户的名称）+ 模型设置入口
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@cogito/design/components/popover'
import { useState, type ReactElement } from 'react'

import { AgentModelSettings } from './model-settings'
import styles from './model-picker.module.scss'
import { ensureCogitoProvider } from '@/features/agent/acp/cogito-provider'
import { switchGooseProviderModel } from '@/features/agent/acp/session'
import {
  findModelLabel,
  findProviderBilling,
  findProviderLabel
} from '@/features/agent/model/display'
import { findModelPref, readModelPrefs } from '@/features/agent/model/model-prefs'
import { parseModels } from '@/features/agent/model/providers'
import { isGatewayTarget } from '@/features/quota/gate'
import { useProviderStore } from '@/stores/provider'

interface ModelPickerProps {
  /** 跳转接入管理（模型设置空态） */
  onOpenSettings?: () => void
  children: ReactElement
}

function AgentModelPicker(props: ModelPickerProps) {
  const [open, updateOpen] = useState(false)
  const [settingsOpen, updateSettingsOpen] = useState(false)
  /** 模型偏好落在 agent.json：挂载时读一次，设置弹窗关闭（可能改过偏好）时再读一次 */
  const [prefs, updatePrefs] = useState(readModelPrefs)
  const providers = useProviderStore(function (state) {
    return state.providers
  })
  const activeProviderID = useProviderStore(function (state) {
    return state.activeProviderID
  })

  const enabledProviders = providers.filter(function (provider) {
    return provider.enabled
  })

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

  return (
    <>
      <Popover
        open={open}
        onOpenChange={updateOpen}>
        <PopoverTrigger render={props.children} />
        <PopoverContent
          side="top"
          align="start"
          className={styles.panel}>
          <div className={styles.header}>
            <p className={styles.headerTitle}>选择模型</p>
            <p className={styles.hint}>当前对话将使用所选模型回复</p>
          </div>
          <div className={styles.list}>
            {enabledProviders.length === 0 ? (
              <p className={`${styles.empty} text-muted-foreground`}>
                还没有可用模型，请先到设置里添加
              </p>
            ) : (
              enabledProviders.map(function (provider) {
                const groupLabel = findProviderLabel(provider.kind || provider.id, provider.name)
                const billing = findProviderBilling(provider.kind || provider.id, provider.name)
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
                      return (
                        <Button
                          key={`${provider.id}-${model}`}
                          type="button"
                          variant="ghost"
                          className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
                          onClick={function () {
                            void selectModel(provider.id, model)
                          }}>
                          {isActive ? (
                            <Icon
                              icon="lucide:check"
                              className={styles.check}
                              width={16}
                              height={16}
                            />
                          ) : (
                            <span className={styles.checkSlot} />
                          )}
                          <span className={styles.modelBadge}>
                            <Icon
                              icon="lucide:box"
                              width={16}
                              height={16}
                            />
                          </span>
                          <span className={`${styles.rowBody} flex flex-col`}>
                            <span className={styles.modelName}>{findModelLabel(model)}</span>
                            <span className={styles.modelDesc}>
                              {groupLabel} · {billing}
                            </span>
                          </span>
                        </Button>
                      )
                    })}
                  </div>
                )
              })
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
              管理模型
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
