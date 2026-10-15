import { Button } from '@i-thinking/design/components/button'
import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'

import { useClipchampStore } from '@/stores/clipchamp.ts'
import type { MediaPanel } from '@/views/clipchamp/lib/project'

const RAIL_ITEMS: { id: MediaPanel; icon: string; label: string }[] = [
  { id: 'media', icon: 'lucide:folder-open', label: '媒体' },
  { id: 'text', icon: 'lucide:type', label: '文本' },
  { id: 'stickers', icon: 'lucide:sticker', label: '贴纸' },
  { id: 'transitions', icon: 'lucide:blend', label: '转场' },
  { id: 'audio', icon: 'lucide:music', label: '音频' }
]

function MediaRail() {
  const mediaPanel = useClipchampStore(function (s) {
    return s.mediaPanel
  })
  const updateMediaPanel = useClipchampStore(function (s) {
    return s.updateMediaPanel
  })

  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-0.5 border-r border-border/80 bg-muted/25 py-2">
      {RAIL_ITEMS.map(function (item) {
        const isActive = mediaPanel === item.id
        return (
          <Button
            key={item.id}
            type="button"
            variant="ghost"
            size="icon-sm"
            title={item.label}
            className={clsx(
              'size-9 rounded-md text-muted-foreground',
              isActive && 'bg-primary/12 text-primary hover:bg-primary/15 hover:text-primary'
            )}
            onClick={function () {
              updateMediaPanel(item.id)
            }}>
            <Icon
              icon={item.icon}
              className="size-4"
            />
          </Button>
        )
      })}
    </nav>
  )
}

export { MediaRail }
