import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { toast } from 'sonner'

import { useMarkdownStore } from '@/stores/markdown'
import { t } from '@/views/markdown/locale.ts'

/** 窗口底栏状态（Decorations.section） */
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
  const isFocusMode = useMarkdownStore(function (state) {
    return state.isFocusMode
  })
  const rootDir = useMarkdownStore(function (state) {
    return state.rootDir
  })

  if (isFocusMode) return null

  const workspaceLabel = rootDir
    ? rootDir.split(/[\\/]/).filter(Boolean).pop()
    : t('WORKSPACE')
  const fileLabel = activePath?.split(/[/\\]/).pop() ?? t('UNTITLED')

  function onCopyPath() {
    if (!activePath) return
    void navigator.clipboard.writeText(activePath).then(function () {
      toast.success(t('COPY_PATH'))
    })
  }

  return (
    <div
      className={cn(
        'flex h-[22px] w-full min-w-0 items-center justify-between text-[11px] leading-none text-muted-foreground'
      )}>
      <div className="flex min-w-0 items-center">
        <span
          className="flex max-w-36 items-center gap-1 truncate px-2 py-0.5"
          title={rootDir ?? undefined}>
          <Icon
            icon="lucide:folder"
            className="size-3 shrink-0 opacity-60"
          />
          <span className="truncate">{workspaceLabel}</span>
        </span>
        {isDirty ? (
          <span className="px-2 text-amber-600 dark:text-amber-400">{t('UNSAVED')}</span>
        ) : (
          <span className="px-2 opacity-70">{t('SAVED')}</span>
        )}
        <button
          type="button"
          className="max-w-56 truncate px-2 py-0.5 hover:bg-foreground/5 hover:text-foreground"
          title={activePath ?? t('UNTITLED')}
          onClick={onCopyPath}>
          {fileLabel}
        </button>
      </div>
      <div className="flex shrink-0 items-center">
        <span className="px-2 py-0.5">
          {stats.words} {t('WORDS')}
        </span>
        <span className="px-2 py-0.5">
          {stats.chars} {t('CHARS')}
        </span>
        <span className="px-2 py-0.5">
          {stats.lines} {t('LINES')}
        </span>
        <span className="px-2 py-0.5 uppercase tracking-wide">{viewMode}</span>
      </div>
    </div>
  )
}

export default Summary
