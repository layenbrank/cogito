import { Button } from '@i-thinking/design/components/button'
import { cn } from 'cn'
import { toast } from 'sonner'

import { useMarkdownStore } from '@/stores/markdown'
import { t } from '@/views/markdown/locale.ts'
import styles from '@/views/markdown/workspace/overlay/summary.module.scss'

function Summary() {
  const activePath = useMarkdownStore(function (state) {
    return state.activePath
  })
  const isDirty = useMarkdownStore(function (state) {
    return state.isDirty
  })
  const stats = useMarkdownStore(function (state) {
    return state.stats
  })
  const viewMode = useMarkdownStore(function (state) {
    return state.viewMode
  })

  function onCopyPath() {
    if (!activePath) return
    void navigator.clipboard.writeText(activePath).then(function () {
      toast.success(t('COPY_PATH'))
    })
  }

  return (
    <div
      className={cn(
        styles.summary,
        styles.root,
        'justify-between gap-2 border-t border-border bg-background text-xs text-muted-foreground'
      )}>
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn(isDirty ? 'text-amber-600 dark:text-amber-400' : '')}>
          {isDirty ? t('UNSAVED') : t('SAVED')}
        </span>
        <button
          type="button"
          className="truncate hover:text-foreground"
          title={activePath ?? t('UNTITLED')}
          onClick={onCopyPath}>
          {activePath ?? t('UNTITLED')}
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span>
          {stats.words} {t('WORDS')} · {stats.chars} {t('CHARS')} · {stats.lines}{' '}
          {t('LINES')}
        </span>
        <span className="uppercase tracking-wide">{viewMode}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-xs"
          onClick={onCopyPath}>
          {t('COPY_PATH')}
        </Button>
      </div>
    </div>
  )
}

export default Summary
