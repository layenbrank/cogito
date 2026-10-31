import { Button } from '@cogito/design/components/button'
import { Checkbox } from '@cogito/design/components/checkbox'
import { Input } from '@cogito/design/components/input'

import type { SignboardCheck } from '@/stores/signboard'
import styles from '@/views/signboard/signboard.module.scss'

interface CardQuickChecksPanelProps {
  checklist: SignboardCheck[]
  checkDraft: string
  checkDone: number
  checkTotal: number
  checkPct: number
  onCheckDraftChange: (value: string) => void
  onAddCheck: () => void
  onUpdateCheck: (checkID: string, done: boolean) => void
}

function CardQuickChecksPanel(props: CardQuickChecksPanelProps) {
  return (
    <div className={styles.quickSection}>
      <div className={styles.quickProgress}>
        <span>
          {props.checkTotal > 0
            ? `${props.checkDone}/${props.checkTotal} · ${props.checkPct}%`
            : '暂无步骤'}
        </span>
        <div
          className={styles.quickProgressTrack}
          role="progressbar"
          aria-valuenow={props.checkPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="清单进度">
          <div
            className={styles.quickProgressFill}
            style={{ width: `${props.checkPct}%` }}
          />
        </div>
      </div>
      <ul className={styles.quickCheckList}>
        {props.checklist.length === 0 ? (
          <li className={styles.tagManagerEmpty}>暂无清单项</li>
        ) : (
          props.checklist.map(function (item) {
            return (
              <li
                key={item.id}
                className={styles.quickCheckItem}>
                <Checkbox
                  checked={item.done}
                  onCheckedChange={function (checked) {
                    props.onUpdateCheck(item.id, Boolean(checked))
                  }}
                />
                <span className={item.done ? styles.quickCheckDone : undefined}>
                  {item.title}
                </span>
              </li>
            )
          })
        )}
      </ul>
      <div className={styles.quickRow}>
        <Input
          value={props.checkDraft}
          placeholder="添加一步"
          className="h-8 flex-1"
          onChange={function (event) {
            props.onCheckDraftChange(event.target.value)
          }}
          onKeyDown={function (event) {
            if (event.key === 'Enter') {
              event.preventDefault()
              props.onAddCheck()
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          className="h-8"
          disabled={!props.checkDraft.trim()}
          onClick={props.onAddCheck}>
          添加
        </Button>
      </div>
    </div>
  )
}

export { CardQuickChecksPanel }
