import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { clsx } from 'clsx'

import type { GooseProviderEntry } from '@/features/agent/acp/goose-providers'
import styles from '@/views/agent/settings/settings.module.scss'

type ProbeStatus = 'unknown' | 'ok' | 'fail'

interface ProviderCardHeaderProps {
  entry: GooseProviderEntry
  status: ProbeStatus
  isOpen: boolean
  onToggle: () => void
}

function ProviderCardHeader(props: ProviderCardHeaderProps) {
  const { entry, status, isOpen } = props
  return (
    <div className={`${styles.cardHeader} flex items-center justify-between gap-3`}>
      <div className={`${styles.cardIdentity} flex items-center gap-2.5`}>
        <span className={styles.cardBadge}>
          <Icon
            icon={entry.isAcp ? 'mdi:console' : 'mdi:api'}
            width={18}
            height={18}
          />
        </span>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span
              className={clsx(
                styles.statusDot,
                status === 'ok' && styles.statusOk,
                status === 'fail' && styles.statusFail,
                entry.configured && status === 'unknown' && styles.statusOk
              )}
            />
            <span className={styles.cardName}>{entry.providerName}</span>
            <span className={styles.kindPill}>{entry.providerId}</span>
            {entry.configured ? <span className={styles.statusLabelOk}>已配置</span> : null}
            {entry.isAcp ? <span className={styles.kindPill}>ACP</span> : null}
          </div>
          {entry.description ? <p className={styles.fieldHint}>{entry.description}</p> : null}
        </div>
      </div>
      <div className={`${styles.cardActions} flex items-center gap-1`}>
        <Button
          variant="ghost"
          size="sm"
          className={styles.actionBtn}
          onClick={props.onToggle}>
          {isOpen ? '收起' : entry.configured ? '编辑' : '配置'}
        </Button>
      </div>
    </div>
  )
}

export { ProviderCardHeader }
export type { ProbeStatus }
