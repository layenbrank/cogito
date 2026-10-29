import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '@cogito/design/components/popover'
import { useState } from 'react'

import type { SignboardTag } from '@/stores/signboard'
import { TagManager } from '@/views/signboard/tag-manager'
import styles from '@/views/signboard/signboard.module.scss'

interface TagFilterProps {
  tags: SignboardTag[]
  selectedIDs: string[]
  boardID: string | null
  onChange: (tagIDs: string[]) => void
}

function TagFilter(props: TagFilterProps) {
  const [mode, setMode] = useState<'filter' | 'manage'>('filter')
  const selectedCount = props.selectedIDs.length
  const isActive = selectedCount > 0

  function toggleTag(tagID: string) {
    if (props.selectedIDs.includes(tagID)) {
      props.onChange(
        props.selectedIDs.filter(function (id) {
          return id !== tagID
        })
      )
      return
    }
    props.onChange([...props.selectedIDs, tagID])
  }

  return (
    <Popover
      onOpenChange={function (open) {
        if (!open) setMode('filter')
      }}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="sm"
            className={isActive ? styles.filterChipOn : styles.filterChip}
            variant={isActive ? 'secondary' : 'ghost'}
            aria-pressed={isActive}
          />
        }>
        <Icon
          icon="lucide:tags"
          className="size-3.5"
        />
        {isActive ? `标签 · ${selectedCount}` : '标签'}
        <Icon
          icon="lucide:chevron-down"
          className="size-3 opacity-60"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className={styles.tagFilterPanel}>
        <PopoverHeader className={styles.tagFilterHeader}>
          <PopoverTitle>{mode === 'filter' ? '按标签筛选' : '管理标签'}</PopoverTitle>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={function () {
              setMode(function (prev) {
                return prev === 'filter' ? 'manage' : 'filter'
              })
            }}>
            {mode === 'filter' ? (
              <>
                <Icon
                  icon="lucide:settings-2"
                  className="size-3.5"
                />
                管理
              </>
            ) : (
              <>
                <Icon
                  icon="lucide:filter"
                  className="size-3.5"
                />
                筛选
              </>
            )}
          </Button>
        </PopoverHeader>

        {mode === 'manage' ? (
          <TagManager
            tags={props.tags}
            boardID={props.boardID}
            compact
          />
        ) : (
          <div className={styles.tagFilterBody}>
            {props.tags.length === 0 ? (
              <p className={styles.tagManagerEmpty}>
                还没有标签。点右上角「管理」新建。
              </p>
            ) : (
              <ul className={styles.tagFilterList}>
                {props.tags.map(function (tag) {
                  const isOn = props.selectedIDs.includes(tag.id)
                  return (
                    <li key={tag.id}>
                      <Button
                        type="button"
                        variant="ghost"
                        className={
                          isOn ? styles.tagFilterItemOn : styles.tagFilterItem
                        }
                        aria-pressed={isOn}
                        onClick={function () {
                          toggleTag(tag.id)
                        }}>
                        <span
                          className={styles.filterSwatch}
                          style={{
                            background: tag.color ?? 'var(--muted-foreground)'
                          }}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate text-left">
                          {tag.title}
                        </span>
                        {isOn ? (
                          <Icon
                            icon="lucide:check"
                            className="size-3.5 shrink-0"
                          />
                        ) : null}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
            {selectedCount > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="mt-1 h-8 w-full justify-center"
                onClick={function () {
                  props.onChange([])
                }}>
                清除筛选
              </Button>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export { TagFilter }
