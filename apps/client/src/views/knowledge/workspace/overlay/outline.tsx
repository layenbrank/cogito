import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'

import { useKnowledgeStore } from '@/stores/knowledge'
import { t } from '@/views/knowledge/locale.ts'

interface OutlineProps {
  onJump(pos: number): void
}

/** 大纲列表（标题由右栏 tabs 提供，这里只渲染条目） */
function Outline(props: OutlineProps) {
  const outline = useKnowledgeStore(function (state) {
    return state.outline
  })
  const isSessionReady = useKnowledgeStore(function (state) {
    return state.isSessionReady
  })
  const isDocLoading = useKnowledgeStore(function (state) {
    return state.isLoading
  })
  const isBootstrapping = !isSessionReady || isDocLoading

  return (
    <div className="flex h-full min-h-0 flex-col bg-background/65 backdrop-blur-md">
      <ul className="min-h-0 flex-1 list-none overflow-y-auto p-1 text-sm">
        {isBootstrapping ? (
          <li className="space-y-2 px-2 py-3" aria-hidden>
            {[0, 1, 2, 3].map(function (index) {
              return (
                <div
                  key={index}
                  className="h-3 animate-pulse rounded bg-muted"
                  style={{ width: `${78 - index * 10}%`, marginLeft: index > 1 ? 10 : 0 }}
                />
              )
            })}
          </li>
        ) : outline.length === 0 ? (
          <li className="px-2 py-3 text-xs text-muted-foreground">{t('NO_OUTLINE')}</li>
        ) : (
          outline.map(function (item) {
            return (
              <li key={item.id}>
                <Button
                  variant="ghost"
                  type="button"
                  className={cn(
                    'h-auto w-full truncate rounded-sm px-2 py-1 text-left hover:bg-muted',
                    item.level === 1 && 'font-medium',
                    item.level > 1 && 'text-muted-foreground'
                  )}
                  style={{ paddingLeft: `${(item.level - 1) * 10 + 8}px` }}
                  onClick={function () {
                    props.onJump(item.pos)
                  }}>
                  {item.text}
                </Button>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}

export default Outline
