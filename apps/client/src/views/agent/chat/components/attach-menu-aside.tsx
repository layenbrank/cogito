import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'
import { toast } from 'sonner'

import styles from './attach-menu.module.scss'
import type { AttachCategory } from './attach-menu-types.ts'

const CATEGORIES: Array<{
  key: AttachCategory
  label: string
  icon: string
  enabled: boolean
}> = [
  { key: 'goal', label: '目标', icon: 'mdi:target', enabled: false },
  { key: 'plan', label: '计划', icon: 'mdi:clipboard-text-outline', enabled: false },
  { key: 'files', label: '工作区', icon: 'mdi:folder-outline', enabled: true },
  { key: 'plugins', label: '插件', icon: 'mdi:puzzle-outline', enabled: false },
  { key: 'skills', label: '技能', icon: 'mdi:hammer-wrench', enabled: true }
]

interface AttachMenuAsideProps {
  category: AttachCategory
  onCategoryChange: (category: AttachCategory) => void
  onClearQuery: () => void
}

function AttachMenuAside(props: AttachMenuAsideProps) {
  return (
    <div className={styles.aside}>
      {CATEGORIES.map(function (item) {
        const isActive = props.category === item.key
        return (
          <button
            key={item.key}
            type="button"
            className={clsx(styles.asideItem, isActive && styles.asideActive)}
            disabled={!item.enabled}
            onClick={function () {
              if (!item.enabled) {
                toast.info('即将推出')
                return
              }
              props.onCategoryChange(item.key)
              props.onClearQuery()
            }}>
            <span className={styles.asideIcon}>
              <Icon
                icon={item.icon}
                width={15}
                height={15}
              />
            </span>
            <span className={styles.asideLabel}>{item.label}</span>
            {item.key === 'files' || item.key === 'skills' ? (
              <Icon
                icon="mdi:chevron-right"
                width={14}
                height={14}
                className={styles.asideChevron}
              />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export { AttachMenuAside }
