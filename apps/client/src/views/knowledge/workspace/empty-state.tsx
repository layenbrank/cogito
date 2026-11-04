import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'

import { useKnowledgeStore } from '@/stores/knowledge'
import { t } from '@/views/knowledge/locale.ts'
import { useSurfaceStore } from '@/views/knowledge/surface/store.ts'

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
  const toSetTab = useSurfaceStore(function (state) {
    return state.toSetTab
  })

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-5 bg-[radial-gradient(120%_70%_at_50%_-12%,color-mix(in_oklab,var(--muted)_55%,transparent),transparent_58%),var(--background)] px-8 text-center">
      <div className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-xl">
        <Icon
          icon="lucide:book-open"
          className="size-7"
        />
      </div>
      <div className="max-w-md space-y-1.5">
        <h2 className="text-foreground text-xl font-semibold tracking-tight">打开一篇 Wiki</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          从左侧「文档」点选页面，或导入来源后 Ingest 生成百科。
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          onClick={function () {
            toSetTab('sources')
          }}>
          <Icon
            icon="lucide:folder-input"
            className="size-4"
          />
          去来源导入
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={props.onNew}>
          <Icon
            icon="lucide:file-plus-2"
            className="size-4"
          />
          {t('NEW')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={props.onOpenFile}>
          <Icon
            icon="lucide:file-text"
            className="size-4"
          />
          {t('OPEN_FILE')}
        </Button>
      </div>
      {recentPaths.length > 0 ? (
        <div className="w-full max-w-md space-y-2 text-left">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <Icon
              icon="lucide:history"
              className="size-3.5"
            />
            {t('RECENT')}
          </div>
          <ul className="divide-border/70 divide-y overflow-hidden rounded-xl border border-border/70 bg-card">
            {recentPaths.slice(0, 8).map(function (path) {
              return (
                <li key={path}>
                  <button
                    type="button"
                    className="hover:bg-muted/40 focus-visible:bg-muted/40 w-full truncate px-3 py-2.5 text-left text-sm outline-none transition-colors"
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
