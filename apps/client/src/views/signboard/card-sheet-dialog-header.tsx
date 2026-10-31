import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { DialogHeader, DialogTitle } from '@cogito/design/components/dialog'

import styles from '@/views/signboard/signboard.module.scss'
import type { useCardSheet } from '@/views/signboard/use-card-sheet.ts'

type CardSheetDialogHeaderProps = Pick<
  ReturnType<typeof useCardSheet>,
  | 'title'
  | 'setTitle'
  | 'persistTitle'
  | 'entryID'
  | 'reminderID'
  | 'scrollToSection'
  | 'labelsRef'
  | 'datesRef'
  | 'checksRef'
  | 'attachRef'
>

function CardSheetDialogHeader(props: CardSheetDialogHeaderProps) {
  const {
    title,
    setTitle,
    persistTitle,
    entryID,
    reminderID,
    scrollToSection,
    labelsRef,
    datesRef,
    checksRef,
    attachRef
  } = props

  return (
    <DialogHeader className={styles.cardDialogHeader}>
      <div className={styles.cardDialogHeaderInner}>
        <DialogTitle className="sr-only">{title.trim() || '卡片详情'}</DialogTitle>
        <div className={styles.cardDialogTitleRow}>
          <span
            className={styles.cardDialogTitleIcon}
            aria-hidden>
            <Icon
              icon="lucide:credit-card"
              className="size-5"
            />
          </span>
          <Input
            value={title}
            placeholder="标题"
            className={styles.cardDialogTitleInput}
            onChange={function (event) {
              setTitle(event.target.value)
            }}
            onBlur={function () {
              persistTitle(entryID, title, reminderID)
            }}
          />
        </div>
        <div className={styles.cardDialogQuickNav}>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={styles.cardDialogAction}
            onClick={function () {
              scrollToSection(labelsRef)
            }}>
            标签
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={styles.cardDialogAction}
            onClick={function () {
              scrollToSection(datesRef)
            }}>
            日程
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={styles.cardDialogAction}
            onClick={function () {
              scrollToSection(checksRef)
            }}>
            子任务
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={styles.cardDialogAction}
            onClick={function () {
              scrollToSection(attachRef)
            }}>
            附件
          </Button>
        </div>
      </div>
    </DialogHeader>
  )
}

export { CardSheetDialogHeader }
