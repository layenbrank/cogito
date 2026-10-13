/**
 * 模型浮层选择器：按已启用接入分组 + 模型设置
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@i-thinking/design/components/popover'
import { useMemo, useState, type ReactElement } from 'react'

import { AgentModelSettings } from './model-settings'
import styles from './model-picker.module.scss'
import { switchGooseProviderModel } from '@/features/agent/acp/session'
import { findModelPref, readModelPrefs } from '@/features/agent/model/model-prefs'
import { parseModels } from '@/features/agent/model/providers'
import { useProviderStore } from '@/stores/provider'

interface ModelPickerProps {
  /** 跳转接入管理（模型设置空态） */
  onOpenSettings?: () => void
  children: ReactElement
}

function AgentModelPicker(props: ModelPickerProps) {
  const [open, updateOpen] = useState(false)
  const [settingsOpen, updateSettingsOpen] = useState(false)
  const [prefsTick, updatePrefsTick] = useState(0)
  const providers = useProviderStore(function (state) {
    return state.providers
  })
  const activeProviderID = useProviderStore(function (state) {
    return state.activeProviderID
  })

  const enabledProviders = providers.filter(function (provider) {
    return provider.enabled
  })

  const prefs = useMemo(
    function () {
      return readModelPrefs()
    },
    [prefsTick, settingsOpen]
  )

  async function selectModel(providerId: string, model: string) {
    useProviderStore.getState().toSetActiveProvider(providerId)
    await useProviderStore.getState().toUpdateProvider([{ id: providerId, model }])
    updateOpen(false)
    try {
      await switchGooseProviderModel(providerId, model)
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
            <p className={styles.headerTitle}>模型</p>
            <p className={styles.hint}>选择当前对话使用的接入与模型</p>
          </div>
          <div className={styles.list}>
            {enabledProviders.length === 0 ? (
              <p className={`${styles.empty} text-muted-foreground`}>
                请先在设置中配置 goose 供应商
              </p>
            ) : (
              enabledProviders.map(function (provider) {
                const kindLabel = provider.name || provider.kind
                const models = parseModels(provider.models).filter(function (model) {
                  return findModelPref(provider.id, model, prefs).visible
                })
                if (models.length === 0) return null
                return (
                  <div
                    key={provider.id}
                    className={styles.group}>
                    <div className={styles.groupTitle}>
                      {provider.name}
                      <span className={styles.kind}>{provider.kind}</span>
                    </div>
                    {models.map(function (model) {
                      const isActive = provider.id === activeProviderID && provider.model === model
                      return (
                        <button
                          key={`${provider.id}-${model}`}
                          type="button"
                          className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
                          onClick={function () {
                            void selectModel(provider.id, model)
                          }}>
                          {isActive ? (
                            <Icon
                              icon="mdi:check"
                              className={styles.check}
                              width={16}
                              height={16}
                            />
                          ) : (
                            <span className={styles.checkSlot} />
                          )}
                          <span className={styles.modelBadge}>
                            <Icon
                              icon="mdi:cube-outline"
                              width={16}
                              height={16}
                            />
                          </span>
                          <span className={`${styles.rowBody} flex flex-col`}>
                            <span className={styles.modelName}>{model}</span>
                            <span className={styles.modelDesc}>
                              {kindLabel} · {provider.kind}
                            </span>
                          </span>
                        </button>
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
                updateSettingsOpen(true)
              }}>
              <Icon
                icon="mdi:cog-outline"
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
          updatePrefsTick(function (tick) {
            return tick + 1
          })
        }}
        onOpenProviders={props.onOpenSettings}
      />
    </>
  )
}

export { AgentModelPicker }
export type { ModelPickerProps }
