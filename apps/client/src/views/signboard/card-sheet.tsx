import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { Label } from '@i-thinking/design/components/label'
import { Sheet, SheetContent, SheetTitle } from '@i-thinking/design/components/sheet'
import { Textarea } from '@i-thinking/design/components/textarea'
import { debounce } from 'lodash-es'
import { useEffect, useMemo, useState } from 'react'

import { useReminderStore } from '@/stores/reminder'
import { useSignboardStore, type SignboardCard } from '@/stores/signboard'

interface CardSheetProps {
  card: SignboardCard | null
  open: boolean
  onUpdateOpen: (open: boolean) => void
}

function toDateInput(dueAt: number | null) {
  if (dueAt == null) return ''
  const date = new Date(dueAt)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseDateInput(value: string) {
  if (!value) return null
  const date = new Date(`${value}T09:00:00`)
  const ms = date.getTime()
  return Number.isNaN(ms) ? null : ms
}

function CardSheet(props: CardSheetProps) {
  const toUpdateCard = useSignboardStore(function (state) {
    return state.toUpdateCard
  })
  const toWriteReminder = useReminderStore(function (state) {
    return state.toWriteReminder
  })
  const toUpdateReminder = useReminderStore(function (state) {
    return state.toUpdateReminder
  })

  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [due, setDue] = useState('')
  const [remind, setRemind] = useState(false)

  useEffect(
    function () {
      if (!props.card) return
      setTitle(props.card.title)
      setNotes(props.card.notes)
      setDue(toDateInput(props.card.dueAt))
      setRemind(Boolean(props.card.reminderID))
    },
    [props.card]
  )

  const persistTitle = useMemo(
    function () {
      return debounce(function (cardID: string, next: string, reminderID: string | null) {
        void toUpdateCard(cardID, { title: next })
        if (reminderID) {
          void toUpdateReminder({ key: reminderID, change: { title: next } })
        }
      }, 400)
    },
    [toUpdateCard, toUpdateReminder]
  )

  useEffect(
    function () {
      return function () {
        persistTitle.cancel()
      }
    },
    [persistTitle]
  )

  if (!props.card) return null

  const cardID = props.card.id
  const reminderID = props.card.reminderID

  async function saveDueAndRemind() {
    const dueAt = parseDateInput(due)
    await toUpdateCard(cardID, { dueAt })

    if (remind && dueAt != null) {
      if (reminderID) {
        await toUpdateReminder({
          key: reminderID,
          change: { title, dueAt, enabled: true }
        })
      } else {
        const id = await toWriteReminder({
          title: title || props.card!.title,
          dueAt,
          enabled: true
        })
        if (id) await toUpdateCard(cardID, { reminderID: id, dueAt })
      }
      return
    }

    if (!remind && reminderID) {
      await toUpdateReminder({
        key: reminderID,
        change: { enabled: false, archivedAt: Date.now() }
      })
      await toUpdateCard(cardID, { reminderID: null })
    }
  }

  return (
    <Sheet
      open={props.open}
      onOpenChange={props.onUpdateOpen}>
      <SheetContent
        side="right"
        showCloseButton
        overlayClassName="bg-black/20 supports-backdrop-filter:backdrop-blur-xs"
        className="w-[min(380px,94vw)] gap-4 sm:max-w-none">
        <SheetTitle className="text-lg">卡片详情</SheetTitle>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="signboard-card-title">标题</Label>
            <Input
              id="signboard-card-title"
              value={title}
              onChange={function (event) {
                const next = event.target.value
                setTitle(next)
                persistTitle(cardID, next, reminderID)
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="signboard-card-notes">备注</Label>
            <Textarea
              id="signboard-card-notes"
              value={notes}
              placeholder="补充上下文…"
              className="min-h-28"
              onChange={function (event) {
                setNotes(event.target.value)
              }}
              onBlur={function () {
                void toUpdateCard(cardID, { notes })
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="signboard-card-due">到期</Label>
            <Input
              id="signboard-card-due"
              type="date"
              value={due}
              onChange={function (event) {
                setDue(event.target.value)
              }}
            />
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
            <span>提醒我</span>
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={remind}
              onChange={function (event) {
                setRemind(event.target.checked)
              }}
            />
          </label>

          <Button
            type="button"
            className="w-full"
            onClick={function () {
              void saveDueAndRemind().then(function () {
                props.onUpdateOpen(false)
              })
            }}>
            完成
          </Button>

          <Button
            type="button"
            variant="ghost"
            className="w-full text-destructive"
            onClick={function () {
              void toUpdateCard(cardID, { archivedAt: Date.now() }).then(function () {
                props.onUpdateOpen(false)
              })
            }}>
            归档卡片
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export { CardSheet }
