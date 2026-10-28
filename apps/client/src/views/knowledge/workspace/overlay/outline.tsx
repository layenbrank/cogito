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

  return (
    <div className="flex h-full min-h-0 flex-col bg-background/65 backdrop-blur-md">
      <ul className="min-h-0 flex-1 list-none overflow-y-auto p-1 text-sm">
        {outline.length === 0 ? (
          <li className="px-2 py-3 text-xs text-muted-foreground">{t('NO_OUTLINE')}</li>
        ) : (
          outline.map(function (item) {
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={cn(
                    'w-full truncate rounded-sm px-2 py-1 text-left hover:bg-muted',
                    item.level === 1 && 'font-medium',
                    item.level > 1 && 'text-muted-foreground'
                  )}
                  style={{ paddingLeft: `${(item.level - 1) * 10 + 8}px` }}
                  onClick={function () {
                    props.onJump(item.pos)
                  }}>
                  {item.text}
                </button>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}

export default Outline
