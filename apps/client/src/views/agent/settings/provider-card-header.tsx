import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'

import type { GooseProviderEntry } from '@/features/agent/acp/goose-providers'
import {
  findProviderBilling,
  findProviderHint,
  findProviderLabel
} from '@/features/agent/model/display'
import styles from '@/views/agent/settings/settings.module.scss'

type ProbeStatus = 'unknown' | 'ok' | 'fail'

interface ProviderCardHeaderProps {
  entry: GooseProviderEntry
  status: ProbeStatus
  isOpen: boolean
  onToggle: () => void
  /** 已配置列表用「更新密钥」口径；添加流程用「配置」 */
  actionLabel?: string
}

function ProviderCardHeader(props: ProviderCardHeaderProps) {
  const { entry, status, isOpen } = props
  const label = findProviderLabel(entry.providerId, entry.providerName)
  const hint = findProviderHint(entry.providerId, entry.providerName, entry.description)
  const billing = findProviderBilling(entry.providerId, entry.providerName)
  const action =
    props.actionLabel ?? (isOpen ? '收起' : entry.configured ? '更新密钥' : '配置')

  return (
    <div className={`${styles.cardHeader} flex items-center justify-between gap-3`}>
      <div className={`${styles.cardIdentity} flex min-w-0 items-center gap-2.5`}>
        <span className={styles.cardBadge}>
          <Icon
            icon={entry.isAcp ? 'lucide:terminal' : 'lucide:plug'}
            width={18}
            height={18}
          />
        </span>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className={clsx(
              styles.statusDot,
              status === 'ok' && styles.statusOk,
              status === 'fail' && styles.statusFail,
              entry.configured && status === 'unknown' && styles.statusOk
            )}
          />
          <span
            className={styles.cardName}
            title={hint}>
            {label}
          </span>
          {entry.configured ? <span className={styles.statusLabelOk}>已配置</span> : null}
          {entry.isAcp ? (
            <span className={styles.kindPill}>本机 CLI</span>
          ) : (
            <span className={styles.kindPill}>{billing}</span>
          )}
        </div>
      </div>
      <div className={`${styles.cardActions} flex shrink-0 items-center gap-1`}>
        <Button
          variant="ghost"
          size="sm"
          className={styles.actionBtn}
          onClick={props.onToggle}>
          {action}
        </Button>
      </div>
    </div>
  )
}

export { ProviderCardHeader }
export type { ProbeStatus }
