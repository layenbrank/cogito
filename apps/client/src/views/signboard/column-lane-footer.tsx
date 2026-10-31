import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import type { RefObject } from 'react'

import styles from '@/views/signboard/signboard.module.scss'

interface ColumnLaneFooterProps {
  isAdding: boolean
  draft: string
  inputRef: RefObject<HTMLInputElement | null>
  onDraftChange: (value: string) => void
  onCommit: () => void
  onCancelAdd: () => void
  onStartAdd: () => void
}

function ColumnLaneFooter(props: ColumnLaneFooterProps) {
  return (
    <div className={styles.columnFooter}>
      {props.isAdding ? (
        <Input
          ref={props.inputRef}
          autoFocus
          value={props.draft}
          placeholder="卡片标题，Enter 添加"
          className="h-9"
          onChange={function (event) {
            props.onDraftChange(event.target.value)
          }}
          onKeyDown={function (event) {
            if (event.key === 'Enter') {
              event.preventDefault()
              props.onCommit()
            }
            if (event.key === 'Escape') {
              props.onCancelAdd()
            }
          }}
          onBlur={function () {
            if (!props.draft.trim()) props.onCancelAdd()
          }}
        />
      ) : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={styles.addCard}
          onClick={props.onStartAdd}>
          <Icon
            icon="lucide:plus"
            className="size-4"
          />
          添加一张卡片
        </Button>
      )}
    </div>
  )
}

export { ColumnLaneFooter }
