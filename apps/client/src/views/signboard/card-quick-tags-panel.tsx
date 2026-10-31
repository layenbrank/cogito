import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'

import type { SignboardTag } from '@/stores/signboard'
import styles from '@/views/signboard/signboard.module.scss'

interface CardQuickTagsPanelProps {
  boardTags: SignboardTag[]
  attachedSet: Set<string>
  tagDraft: string
  onTagDraftChange: (value: string) => void
  onToggleTag: (tagID: string) => void
  onInsertTag: () => void
}

function CardQuickTagsPanel(props: CardQuickTagsPanelProps) {
  return (
    <div className={styles.quickSection}>
      {props.boardTags.length === 0 ? (
        <p className={styles.tagManagerEmpty}>还没有标签，输入名称即可新建并挂上</p>
      ) : (
        <div className={styles.quickTagList}>
          {props.boardTags.map(function (tag) {
            const isOn = props.attachedSet.has(tag.id)
            return (
              <Button
                key={tag.id}
                type="button"
                variant="ghost"
                className={isOn ? styles.quickTagOn : styles.quickTag}
                style={
                  tag.color
                    ? {
                        background: isOn
                          ? `color-mix(in oklab, ${tag.color} 22%, var(--card))`
                          : undefined,
                        color: tag.color ?? undefined,
                        borderColor: isOn
                          ? tag.color
                          : `color-mix(in oklab, ${tag.color} 30%, transparent)`
                      }
                    : undefined
                }
                onClick={function () {
                  props.onToggleTag(tag.id)
                }}>
                <span
                  className={styles.filterSwatch}
                  style={{
                    background: tag.color ?? 'var(--muted-foreground)'
                  }}
                  aria-hidden
                />
                {tag.title}
                {isOn ? (
                  <Icon
                    icon="lucide:check"
                    className="size-3 opacity-80"
                  />
                ) : null}
              </Button>
            )
          })}
        </div>
      )}
      <div className={styles.quickRow}>
        <Input
          value={props.tagDraft}
          placeholder="搜索或新建标签"
          className="h-8 flex-1"
          onChange={function (event) {
            props.onTagDraftChange(event.target.value)
          }}
          onKeyDown={function (event) {
            if (event.key === 'Enter') {
              event.preventDefault()
              props.onInsertTag()
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          className="h-8"
          disabled={!props.tagDraft.trim()}
          onClick={props.onInsertTag}>
          添加
        </Button>
      </div>
    </div>
  )
}

export { CardQuickTagsPanel }
