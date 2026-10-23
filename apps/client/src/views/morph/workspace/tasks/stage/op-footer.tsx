import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Spinner } from '@cogito/design/components/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'

import styles from '@/views/morph/workspace/tasks/stage/op-footer.module.scss'

type OpFooterProps = {
  fields?: ReactNode
  hint?: string
  submitLabel: string
  submitDisabled?: boolean
  submitLoading?: boolean
  onSubmit: () => void
  extra?: ReactNode
  className?: string
}

function OpFooter(props: OpFooterProps) {
  const {
    fields,
    hint,
    submitLabel,
    submitDisabled,
    submitLoading,
    onSubmit,
    extra,
    className
  } = props

  const hasSettings = Boolean(fields)

  return (
    <footer
      className={clsx(
        styles.footer,
        hasSettings && styles.stacked,
        className
      )}>
      {hasSettings ? <div className={styles.settings}>{fields}</div> : null}
      <div className={styles.actionBar}>
        <div className={styles.actionLead}>{extra}</div>
        <div className={styles.actionTrail}>
          {hint ? (
            hint.length > 40 ? (
              <Tooltip>
                <TooltipTrigger
                  render={<span className={styles.hint} />}>
                  {hint}
                </TooltipTrigger>
                <TooltipContent side="top">{hint}</TooltipContent>
              </Tooltip>
            ) : (
              <span className={styles.hint}>{hint}</span>
            )
          ) : null}
          <Button
            className={styles.submit}
            disabled={submitDisabled || submitLoading}
            onClick={onSubmit}>
            {submitLoading ? (
              <Spinner className="size-3.5" />
            ) : (
              <Icon
                icon="ant-design:play-circle-outlined"
                className="size-3.5"
              />
            )}
            {submitLabel}
          </Button>
        </div>
      </div>
    </footer>
  )
}

export { OpFooter }
export type { OpFooterProps }
