import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { DatePicker } from '@cogito/design/components/date-picker'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Switch } from '@cogito/design/components/switch'
import { toast } from 'sonner'

import { TAG_COLORS } from '@/stores/signboard'
import { HintTooltip } from '@/views/signboard/hint-tooltip'
import { PRIORITY_OPTIONS } from '@/views/signboard/card-sheet-types.ts'
import styles from '@/views/signboard/signboard.module.scss'
import type { useCardSheet } from '@/views/signboard/use-card-sheet.ts'

type CardSheetDialogAsideProps = Pick<
  ReturnType<typeof useCardSheet>,
  | 'datesRef'
  | 'labelsRef'
  | 'start'
  | 'setStart'
  | 'persistSchedule'
  | 'due'
  | 'setDue'
  | 'priority'
  | 'setPriority'
  | 'remind'
  | 'setRemind'
  | 'saving'
  | 'filteredTags'
  | 'attachedSet'
  | 'toggleTag'
  | 'toUpdateTag'
  | 'tags'
  | 'tagDraft'
  | 'setTagDraft'
  | 'insertTag'
>

function CardSheetDialogAside(props: CardSheetDialogAsideProps) {
  const {
    datesRef,
    labelsRef,
    start,
    setStart,
    persistSchedule,
    due,
    setDue,
    priority,
    setPriority,
    remind,
    setRemind,
    saving,
    filteredTags,
    attachedSet,
    toggleTag,
    toUpdateTag,
    tags,
    tagDraft,
    setTagDraft,
    insertTag
  } = props

  return (
    <aside className={styles.cardDialogSide}>
      <section
        ref={datesRef}
        className={styles.sheetBlock}>
        <div className={styles.dialogSectionHead}>
          <Icon
            icon="lucide:calendar-clock"
            className="size-4"
            aria-hidden
          />
          <h3 className={styles.dialogSectionTitle}>日程</h3>
        </div>
        <div className={styles.sheetField}>
          <Label htmlFor="signboard-card-start">开始</Label>
          <DatePicker
            id="signboard-card-start"
            value={start}
            onChange={function (date) {
              setStart(date)
              void persistSchedule({ start: date })
            }}
          />
        </div>
        <div className={styles.sheetField}>
          <Label htmlFor="signboard-card-due">到期</Label>
          <DatePicker
            id="signboard-card-due"
            value={due}
            onChange={function (date) {
              setDue(date)
              void persistSchedule({ due: date })
            }}
          />
        </div>
        <div className={styles.sheetField}>
          <Label>优先级</Label>
          <Select
            items={PRIORITY_OPTIONS.map(function (row) {
              return { value: row.value, label: row.label }
            })}
            value={priority}
            onValueChange={function (value) {
              if (value === null) return
              setPriority(value)
              void persistSchedule({ priority: value })
            }}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map(function (row) {
                return (
                  <SelectItem
                    key={row.value}
                    value={row.value}>
                    {row.label}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
        <div className={styles.sheetRow}>
          <HintTooltip
            hint="写入本地 Reminder，到点通知"
            htmlFor="signboard-card-remind">
            提醒我
          </HintTooltip>
          <Switch
            id="signboard-card-remind"
            checked={remind}
            onCheckedChange={function (checked) {
              setRemind(checked)
              void persistSchedule({ remind: checked })
            }}
          />
        </div>
        {saving ? (
          <p className="text-xs text-muted-foreground">正在保存日程…</p>
        ) : null}
      </section>

      <section
        ref={labelsRef}
        className={styles.sheetBlock}>
        <div className={styles.dialogSectionHead}>
          <Icon
            icon="lucide:tags"
            className="size-4"
            aria-hidden
          />
          <HintTooltip
            hint="色块用于扫视分类；点选切换挂载，新建时自动配色。"
            className={styles.dialogSectionTitle}>
            标签
          </HintTooltip>
        </div>
        <div className={styles.sheetField}>
          <div className={styles.tagList}>
            {filteredTags.map(function (tag) {
              const active = attachedSet.has(tag.id)
              return (
                <div
                  key={tag.id}
                  className={styles.tagChipWrap}>
                  <Button
                    type="button"
                    variant="ghost"
                    className={
                      active
                        ? `${styles.tagChip} ${styles.tagChipActive}`
                        : styles.tagChip
                    }
                    style={
                      tag.color
                        ? {
                            borderColor: active
                              ? tag.color
                              : `color-mix(in oklab, ${tag.color} 35%, transparent)`,
                            background: active
                              ? `color-mix(in oklab, ${tag.color} 22%, var(--card))`
                              : `color-mix(in oklab, ${tag.color} 10%, var(--card))`,
                            color: active ? tag.color : 'var(--foreground)'
                          }
                        : undefined
                    }
                    onClick={function () {
                      void toggleTag(tag.id)
                    }}>
                    <span
                      className={styles.tagSwatch}
                      style={{
                        background: tag.color ?? 'var(--muted-foreground)'
                      }}
                      aria-hidden
                    />
                    {tag.title}
                  </Button>
                  <div
                    className={styles.tagColorRow}
                    role="group"
                    aria-label={`${tag.title} 颜色`}>
                    {TAG_COLORS.map(function (color) {
                      const isCurrent = tag.color === color
                      return (
                        <Button
                          key={color}
                          type="button"
                          variant="ghost"
                          className={
                            isCurrent
                              ? `${styles.tagColorDot} ${styles.tagColorDotActive}`
                              : styles.tagColorDot
                          }
                          style={{ background: color }}
                          aria-label={`设为 ${color}`}
                          aria-pressed={isCurrent}
                          onClick={function () {
                            void toUpdateTag(tag.id, { color }).then(function (ok) {
                              if (!ok) toast.error('改色失败')
                            })
                          }}
                        />
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          {tags.length > 0 && filteredTags.length === 0 ? (
            <p className="text-xs text-muted-foreground">无匹配标签，回车可新建</p>
          ) : null}
          <div className={styles.sideCompose}>
            <Input
              value={tagDraft}
              placeholder="搜索或新建"
              className="h-9"
              onChange={function (event) {
                setTagDraft(event.target.value)
              }}
              onKeyDown={function (event) {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void insertTag()
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={function () {
                void insertTag()
              }}>
              添加
            </Button>
          </div>
        </div>
      </section>
    </aside>
  )
}

export { CardSheetDialogAside }
