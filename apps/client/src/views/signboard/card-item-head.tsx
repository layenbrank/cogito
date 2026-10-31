import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { Icon } from '@iconify/react/offline'
import { toast } from 'sonner'

import { useSignboardStore, type SignboardTag } from '@/stores/signboard'
import styles from '@/views/signboard/signboard.module.scss'

interface CardItemHeadProps {
  cardID: string
  tags: SignboardTag[]
  onOpen: () => void
  onArchive: () => void
}

function CardItemHead(props: CardItemHeadProps) {
  const toUntagEntry = useSignboardStore(function (state) {
    return state.toUntagEntry
  })
  const visibleTags = props.tags.slice(0, 5)
  const hiddenTagCount = Math.max(0, props.tags.length - visibleTags.length)

  async function removeTag(tagID: string) {
    const ok = await toUntagEntry(props.cardID, tagID)
    if (!ok) toast.error('移除标签失败')
  }

  return (
    <div className={styles.cardHead}>
      <div className={styles.cardLabelRow}>
        {visibleTags.map(function (tag) {
          return (
            <Button
              key={tag.id}
              type="button"
              variant="ghost"
              className={styles.cardLabel}
              title={`移除标签「${tag.title}」`}
              style={{
                background: tag.color ?? 'var(--muted-foreground)'
              }}
              onClick={function (event) {
                event.stopPropagation()
                void removeTag(tag.id)
              }}
              onPointerDown={function (event) {
                event.stopPropagation()
              }}>
              <span className={styles.cardLabelText}>{tag.title}</span>
            </Button>
          )
        })}
        {hiddenTagCount > 0 ? (
          <span className={styles.tagMore}>+{hiddenTagCount}</span>
        ) : null}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={styles.menuTrigger}
          aria-label="卡片菜单"
          onClick={function (event) {
            event.stopPropagation()
          }}
          onPointerDown={function (event) {
            event.stopPropagation()
          }}>
          <Icon
            icon="lucide:more-horizontal"
            className="size-4"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="bottom"
          align="end"
          sideOffset={4}
          className="min-w-36">
          <DropdownMenuItem onClick={props.onOpen}>
            <Icon
              icon="lucide:panel-right"
              className="size-4"
            />
            打开详情
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={props.onArchive}>
            <Icon
              icon="lucide:archive"
              className="size-4"
            />
            归档
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export { CardItemHead }
