import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Checkbox } from '@cogito/design/components/checkbox'
import { Input } from '@cogito/design/components/input'
import { Textarea } from '@cogito/design/components/textarea'
import { toast } from 'sonner'

import { HintTooltip } from '@/views/signboard/hint-tooltip'
import styles from '@/views/signboard/signboard.module.scss'
import type { useCardSheet } from '@/views/signboard/use-card-sheet.ts'

type CardSheetDialogNotesChecksProps = Pick<
  ReturnType<typeof useCardSheet>,
  | 'notes'
  | 'setNotes'
  | 'toUpdateEntry'
  | 'entryID'
  | 'checksRef'
  | 'checklistTotal'
  | 'checklistDone'
  | 'displayPct'
  | 'checklist'
  | 'editingCheckID'
  | 'toUpdateCheck'
  | 'editingCheckTitle'
  | 'setEditingCheckTitle'
  | 'commitCheckEdit'
  | 'setEditingCheckID'
  | 'toRemoveCheck'
  | 'checklistDraft'
  | 'setChecklistDraft'
  | 'addChecklistItem'
>

function CardSheetDialogNotesChecks(props: CardSheetDialogNotesChecksProps) {
  const {
    notes,
    setNotes,
    toUpdateEntry,
    entryID,
    checksRef,
    checklistTotal,
    checklistDone,
    displayPct,
    checklist,
    editingCheckID,
    toUpdateCheck,
    editingCheckTitle,
    setEditingCheckTitle,
    commitCheckEdit,
    setEditingCheckID,
    toRemoveCheck,
    checklistDraft,
    setChecklistDraft,
    addChecklistItem
  } = props

  return (
    <>
      <section className={styles.sheetBlock}>
        <div className={styles.dialogSectionHead}>
          <Icon
            icon="lucide:align-left"
            className="size-4"
            aria-hidden
          />
          <h3 className={styles.dialogSectionTitle}>描述</h3>
        </div>
        <Textarea
          value={notes}
          placeholder="补充说明…"
          className={styles.cardNotes}
          onChange={function (event) {
            setNotes(event.target.value)
          }}
          onBlur={function () {
            void toUpdateEntry(entryID, { notes }).then(function (ok: boolean) {
              if (!ok) toast.error('描述保存失败')
            })
          }}
        />
      </section>

      <section
        ref={checksRef}
        className={styles.sheetBlock}>
        <div className={styles.dialogSectionHead}>
          <Icon
            icon="lucide:list-checks"
            className="size-4"
            aria-hidden
          />
          <HintTooltip
            hint="勾选即完成；双击标题可改文案。"
            className={styles.dialogSectionTitle}>
            子任务
          </HintTooltip>
          {checklistTotal > 0 ? (
            <span className={styles.dialogSectionAside}>
              {checklistDone}/{checklistTotal} · {displayPct}%
            </span>
          ) : null}
        </div>
        {checklistTotal > 0 ? (
          <div
            className={styles.checkProgress}
            role="progressbar"
            aria-valuenow={displayPct}
            aria-valuemin={0}
            aria-valuemax={100}>
            <div
              className={styles.checkProgressFill}
              style={{ width: `${displayPct}%` }}
            />
          </div>
        ) : null}
        <ul className={styles.checkList}>
          {checklist.map(function (item) {
            const isEditing = editingCheckID === item.id
            return (
              <li
                key={item.id}
                className={styles.checkRow}>
                <Checkbox
                  checked={item.done}
                  onCheckedChange={function (checked) {
                    void toUpdateCheck(item.id, { done: Boolean(checked) })
                  }}
                />
                {isEditing ? (
                  <Input
                    autoFocus
                    value={editingCheckTitle}
                    className={styles.checkEditInput}
                    onChange={function (event) {
                      setEditingCheckTitle(event.target.value)
                    }}
                    onBlur={function () {
                      void commitCheckEdit(item.id)
                    }}
                    onKeyDown={function (event) {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void commitCheckEdit(item.id)
                      }
                      if (event.key === 'Escape') {
                        setEditingCheckID(null)
                      }
                    }}
                  />
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    className={
                      item.done
                        ? `${styles.checkTitle} ${styles.checkTitleDone}`
                        : styles.checkTitle
                    }
                    onDoubleClick={function () {
                      setEditingCheckID(item.id)
                      setEditingCheckTitle(item.title)
                    }}>
                    {item.title}
                  </Button>
                )}
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className={styles.checkRemove}
                  aria-label="删除子任务"
                  onClick={function () {
                    void toRemoveCheck(item.id)
                  }}>
                  <Icon
                    icon="lucide:x"
                    className="size-3.5"
                  />
                </Button>
              </li>
            )
          })}
        </ul>
        <div className={styles.sideCompose}>
          <Input
            value={checklistDraft}
            placeholder="添加子任务"
            className="h-9"
            onChange={function (event) {
              setChecklistDraft(event.target.value)
            }}
            onKeyDown={function (event) {
              if (event.key === 'Enter') {
                event.preventDefault()
                void addChecklistItem()
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={function () {
              void addChecklistItem()
            }}>
            添加
          </Button>
        </div>
      </section>
    </>
  )
}

export { CardSheetDialogNotesChecks }
