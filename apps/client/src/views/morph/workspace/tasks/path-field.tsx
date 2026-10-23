import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { clsx } from 'clsx'

import styles from '@/views/morph/workspace/tasks/path-field.module.scss'

type PathFieldProps = {
  label: string
  value: string
  placeholder: string
  browseLabel?: string
  onBrowse: () => void
  compact?: boolean
}

function PathField(props: PathFieldProps) {
  const { label, value, placeholder, browseLabel = '浏览…', onBrowse, compact } = props

  return (
    <div className={clsx(styles.field, compact && styles.compact)}>
      {compact ? null : <span className={styles.label}>{label}</span>}
      <div className={styles.row}>
        <Input
          className={clsx(styles.input, 'rounded-e-none')}
          value={value}
          placeholder={compact ? label || placeholder : placeholder}
          readOnly
          aria-label={label}
        />
        <Button
          variant="outline"
          className={clsx(styles.browse, 'rounded-s-none')}
          onClick={onBrowse}>
          <Icon
            icon="ant-design:folder-open-outlined"
            className="size-3.5"
          />
          {browseLabel}
        </Button>
      </div>
    </div>
  )
}

export { PathField }
export type { PathFieldProps }
