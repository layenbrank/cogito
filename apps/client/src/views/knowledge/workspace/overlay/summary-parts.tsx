import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'

import { t } from '@/views/knowledge/locale.ts'

interface SummaryWorkspaceProps {
  workspaceLabel: string
  rootDir: string | null
  isBootstrapping: boolean
  isDirty: boolean
  activePath: string | null
  fileLabel: string
  onCopyPath: () => void
}

function SummaryWorkspaceRow(props: SummaryWorkspaceProps) {
  return (
    <div className="flex min-w-0 items-center">
      <span
        className="flex max-w-36 items-center gap-1 truncate px-2 py-0.5"
        title={props.rootDir ?? undefined}>
        <Icon
          icon="lucide:folder"
          className="size-3 shrink-0 opacity-60"
        />
        <span className="truncate">{props.workspaceLabel}</span>
      </span>
      {props.isBootstrapping ? (
        <span className="px-2 opacity-70">{t('SESSION_BOOTSTRAP')}</span>
      ) : props.isDirty ? (
        <span className="px-2 text-amber-600 dark:text-amber-400">{t('UNSAVED')}</span>
      ) : props.activePath ? (
        <span className="px-2 opacity-70">{t('SAVED')}</span>
      ) : (
        <span className="px-2 opacity-70">{t('UNTITLED')}</span>
      )}
      <Button
        variant="ghost"
        type="button"
        className="h-auto max-w-56 truncate px-2 py-0.5 hover:bg-foreground/5 hover:text-foreground"
        title={props.activePath ?? t('UNTITLED')}
        onClick={props.onCopyPath}>
        {props.isBootstrapping && !props.activePath ? '…' : props.fileLabel}
      </Button>
    </div>
  )
}

interface SummaryStatsProps {
  isBootstrapping: boolean
  words: number
  chars: number
  lines: number
  viewMode: string
}

function SummaryStatsRow(props: SummaryStatsProps) {
  if (props.isBootstrapping) {
    return (
      <span className="px-2 py-0.5 opacity-70">{t('SESSION_BOOTSTRAP')}</span>
    )
  }
  return (
    <>
      <span className="px-2 py-0.5">
        {props.words} {t('WORDS')}
      </span>
      <span className="px-2 py-0.5">
        {props.chars} {t('CHARS')}
      </span>
      <span className="px-2 py-0.5">
        {props.lines} {t('LINES')}
      </span>
      <span className="px-2 py-0.5 uppercase tracking-wide">{props.viewMode}</span>
    </>
  )
}

export { SummaryStatsRow, SummaryWorkspaceRow }
