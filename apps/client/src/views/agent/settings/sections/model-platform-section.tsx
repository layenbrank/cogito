import { Icon } from '@iconify/react/offline'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Spinner } from '@cogito/design/components/spinner'

import {
  findModelLabel,
  findProviderBilling,
  findProviderLabel
} from '@/features/agent/model/display'
import { parseModels } from '@/features/agent/model/providers'
import type { useProviderStore } from '@/stores/provider'
import styles from '@/views/agent/settings/settings.module.scss'

type StoreProviderRow = ReturnType<typeof useProviderStore.getState>['providers'][number]

function PlatformModelsSection(props: {
  loading: boolean
  provider: StoreProviderRow | null
  onModelChange: (providerId: string, model: string) => unknown
}) {
  const models = props.provider ? parseModels(props.provider.models) : []

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>组织模型</span>
        <span className={styles.sectionMeta}>
          {props.loading ? '加载中…' : `${models.length} 个`}
        </span>
      </div>

      {props.loading ? (
        <div className="flex justify-center py-8">
          <Spinner className="size-5" />
        </div>
      ) : !props.provider || models.length === 0 ? (
        <p
          className={`${styles.empty} text-muted-foreground`}
          title="请确认已登录，且管理员已在后台启用模型">
          暂无组织模型
        </p>
      ) : (
        <div className={styles.list}>
          <div className={styles.row}>
            <div className={styles.rowIdentity}>
              <span className={styles.cardBadge}>
                <Icon
                  icon="lucide:building-2"
                  width={16}
                  height={16}
                />
              </span>
              <div className="min-w-0">
                <span className={styles.cardName}>
                  {findProviderLabel(props.provider.kind, props.provider.name)}
                </span>
                <p className={styles.rowMeta}>
                  {findProviderBilling(props.provider.kind, props.provider.name)}
                  {' · '}
                  {models.length} 个可用
                </p>
              </div>
            </div>
            <div className={styles.rowActions}>
              <Select
                value={props.provider.model ?? models[0] ?? null}
                onValueChange={function (model) {
                  if (model === null) return
                  void props.onModelChange(props.provider!.id, model)
                }}>
                <SelectTrigger
                  aria-label="默认组织模型"
                  className={styles.modelSelect}>
                  <SelectValue placeholder="默认模型" />
                </SelectTrigger>
                <SelectContent align="center">
                  {models.map(function (model) {
                    return (
                      <SelectItem
                        key={model}
                        value={model}>
                        {findModelLabel(model)}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export { PlatformModelsSection }
