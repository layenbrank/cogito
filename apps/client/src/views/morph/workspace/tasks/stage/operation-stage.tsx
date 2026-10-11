import { clsx } from 'clsx'
import type { ReactNode } from 'react'

import { OpChrome } from '@/views/morph/workspace/tasks/stage/op-chrome.tsx'
import { OpFooter } from '@/views/morph/workspace/tasks/stage/op-footer.tsx'
import styles from '@/views/morph/workspace/tasks/stage/operation-stage.module.scss'

type OperationStageProps = {
  title: string
  meta?: string
  icon?: string
  actions?: ReactNode
  onBack: () => void
  children: ReactNode
  fields?: ReactNode
  hint?: string
  extra?: ReactNode
  submitLabel: string
  submitDisabled?: boolean
  submitLoading?: boolean
  onSubmit: () => void
  className?: string
}

/**
 * Full-bleed operation workspace: chrome + board + footer (no side form rail).
 */
function OperationStage(props: OperationStageProps) {
  const {
    title,
    meta,
    icon,
    actions,
    onBack,
    children,
    fields,
    hint,
    extra,
    submitLabel,
    submitDisabled,
    submitLoading,
    onSubmit,
    className
  } = props

  return (
    <section
      className={clsx(styles.stage, styles.root, className)}
      aria-label={title}>
      <OpChrome
        title={title}
        meta={meta}
        icon={icon}
        actions={actions}
        onBack={onBack}
      />
      <div className={styles.body}>{children}</div>
      <OpFooter
        fields={fields}
        hint={hint}
        extra={extra}
        submitLabel={submitLabel}
        submitDisabled={submitDisabled}
        submitLoading={submitLoading}
        onSubmit={onSubmit}
      />
    </section>
  )
}

export { OperationStage }
export type { OperationStageProps }
