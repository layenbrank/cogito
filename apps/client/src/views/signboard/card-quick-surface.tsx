import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '@cogito/design/components/popover'
import type { MouseEvent, ReactElement } from 'react'

import type { SignboardCheck, SignboardEntry } from '@/stores/signboard'
import { CardQuickChecksPanel } from '@/views/signboard/card-quick-checks-panel.tsx'
import { CardQuickTagsPanel } from '@/views/signboard/card-quick-tags-panel.tsx'
import { useCardQuickSurface } from '@/views/signboard/use-card-quick-surface.ts'
import styles from '@/views/signboard/signboard.module.scss'

interface CardQuickSurfaceProps {
  card: SignboardEntry
  checklist: SignboardCheck[]
  /** 默认 tags：卡片上的 +；checks：清单快捷入口 */
  focus?: 'tags' | 'checks'
  /** 自定义触发器（如清单徽章） */
  trigger?: ReactElement
}

function stop(event: MouseEvent) {
  event.stopPropagation()
  event.preventDefault()
}

function CardQuickSurface(props: CardQuickSurfaceProps) {
  const focus = props.focus ?? 'tags'
  const surface = useCardQuickSurface(props.card, props.checklist, focus)

  return (
    <Popover
      onOpenChange={function (open) {
        if (open) surface.setTab(focus)
      }}>
      <PopoverTrigger
        render={
          props.trigger ?? (
            <Button
              type="button"
              variant="ghost"
              className={styles.quickTrigger}
              aria-label={focus === 'tags' ? '编辑标签' : '编辑清单'}
              onClick={stop}
              onPointerDown={stop}
            />
          )
        }>
        {props.trigger ? null : (
          <Icon
            icon={focus === 'tags' ? 'lucide:plus' : 'lucide:list-checks'}
            className="size-3"
            aria-hidden
          />
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className={styles.quickPanel}
        onClick={stop}
        onPointerDown={stop}>
        <PopoverHeader className={styles.quickHeader}>
          <PopoverTitle>快捷编辑</PopoverTitle>
          <div className={styles.quickTabs}>
            <Button
              type="button"
              variant="ghost"
              className={surface.tab === 'tags' ? styles.quickTabOn : styles.quickTab}
              onClick={function () {
                surface.setTab('tags')
              }}>
              标签
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={surface.tab === 'checks' ? styles.quickTabOn : styles.quickTab}
              onClick={function () {
                surface.setTab('checks')
              }}>
              清单
            </Button>
          </div>
        </PopoverHeader>

        {surface.tab === 'tags' ? (
          <CardQuickTagsPanel
            boardTags={surface.boardTags}
            attachedSet={surface.attachedSet}
            tagDraft={surface.tagDraft}
            onTagDraftChange={surface.setTagDraft}
            onToggleTag={function (tagID) {
              void surface.toggleTag(tagID)
            }}
            onInsertTag={function () {
              void surface.insertTag()
            }}
          />
        ) : (
          <CardQuickChecksPanel
            checklist={props.checklist}
            checkDraft={surface.checkDraft}
            checkDone={surface.checkDone}
            checkTotal={surface.checkTotal}
            checkPct={surface.checkPct}
            onCheckDraftChange={surface.setCheckDraft}
            onAddCheck={function () {
              void surface.addCheck()
            }}
            onUpdateCheck={function (checkID, done) {
              void surface.toUpdateCheck(checkID, { done })
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

export { CardQuickSurface }
