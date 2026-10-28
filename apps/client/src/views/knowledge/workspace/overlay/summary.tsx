import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { toast } from 'sonner'

import { useKnowledgeStore } from '@/stores/knowledge'
import { t } from '@/views/knowledge/locale.ts'

/** 窗口底栏状态（Decorations.section） */
function Summary() {
  const activePath = useKnowledgeStore(function (state) {
    return state.activePath
  })
  const isDirty = useKnowledgeStore(function (state) {
    return state.isDirty
  })
  const stats = useKnowledgeStore(function (state) {
    return state.stats
  })
  const viewMode = useKnowledgeStore(function (state) {
    return state.viewMode
  })
  const isFocusMode = useKnowledgeStore(function (state) {
    return state.isFocusMode
  })
  const rootDir = useKnowledgeStore(function (state) {
    return state.rootDir
  })
  const isSessionReady = useKnowledgeStore(function (state) {
    return state.isSessionReady
  })
  const isDocLoading = useKnowledgeStore(function (state) {
    return state.isLoading
  })

  if (isFocusMode) return null

  const workspaceLabel = rootDir
    ? rootDir.split(/[\\/]/).filter(Boolean).pop()
    : t('WORKSPACE')
  const fileLabel = activePath?.split(/[/\\]/).pop() ?? t('UNTITLED')
  const isBootstrapping = !isSessionReady || isDocLoading

  function onCopyPath() {
    if (!activePath) return
    void navigator.clipboard.writeText(activePath).then(function () {
      toast.success(t('COPY_PATH'))
    })
  }

  return (
    <div
      className={cn(
        'flex h-5.5 w-full min-w-0 items-center justify-between text-xs leading-none text-muted-foreground'
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
        {isBootstrapping ? (
          <span className="px-2 opacity-70">{t('SESSION_BOOTSTRAP')}</span>
        ) : isDirty ? (
          <span className="px-2 text-amber-600 dark:text-amber-400">{t('UNSAVED')}</span>
        ) : (
          <span className="px-2 opacity-70">{t('SAVED')}</span>
        )}
        <button
          type="button"
          className="max-w-56 truncate px-2 py-0.5 hover:bg-foreground/5 hover:text-foreground"
          title={activePath ?? t('UNTITLED')}
          onClick={onCopyPath}>
          {isBootstrapping && !activePath ? '…' : fileLabel}
        </button>
      </div>
      <div className="flex shrink-0 items-center">
        {isBootstrapping ? (
          <span className="px-2 py-0.5 opacity-70">{t('SESSION_BOOTSTRAP')}</span>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  )
}

export default Summary
