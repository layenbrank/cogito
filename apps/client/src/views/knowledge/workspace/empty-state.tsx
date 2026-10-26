import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'

import { useKnowledgeStore } from '@/stores/knowledge'
import { t } from '@/views/knowledge/locale.ts'

interface EmptyStateProps {
  onOpenFile: () => void
  onOpenFolder: () => void
  onNew: () => void
  onOpenRecent: (path: string) => void
}

function EmptyState(props: EmptyStateProps) {
  const recentPaths = useKnowledgeStore(function (state) {
    return state.recentPaths
  })

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-6 bg-background/80 px-8 text-center backdrop-blur-sm">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('EMPTY_TITLE')}
        </h2>
        <p className="max-w-md text-sm text-muted-foreground">{t('EMPTY_DESC')}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          onClick={props.onOpenFile}>
          <Icon
            icon="lucide:file-text"
            className="size-4"
          />
          {t('OPEN_FILE')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={props.onOpenFolder}>
          <Icon
            icon="lucide:folder-open"
            className="size-4"
          />
          {t('OPEN_FOLDER')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={props.onNew}>
          <Icon
            icon="lucide:file-plus-2"
            className="size-4"
          />
          {t('NEW')}
        </Button>
      </div>
      {recentPaths.length > 0 ? (
        <div className="w-full max-w-md space-y-2 text-left">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Icon
              icon="lucide:history"
              className="size-3.5"
            />
            {t('RECENT')}
          </div>
          <ul className="divide-y rounded-md border border-border">
            {recentPaths.slice(0, 8).map(function (path) {
              return (
                <li key={path}>
                  <button
                    type="button"
                    className="w-full truncate px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={function () {
                      props.onOpenRecent(path)
                    }}>
                    {path}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export { EmptyState }
