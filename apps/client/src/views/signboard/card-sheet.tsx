import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { Label } from '@i-thinking/design/components/label'
import { Sheet, SheetContent, SheetTitle } from '@i-thinking/design/components/sheet'
import { Switch } from '@i-thinking/design/components/switch'
import { Textarea } from '@i-thinking/design/components/textarea'
import { debounce } from 'lodash-es'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useReminderStore } from '@/stores/reminder'
import { useSignboardStore, type SignboardCard } from '@/stores/signboard'
import styles from '@/views/signboard/signboard.module.scss'

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
  const tags = useSignboardStore(function (state) {
    return state.tags
  })
  const activeBoardID = useSignboardStore(function (state) {
    return state.activeBoardID
  })
  const tagIDsForCard = useSignboardStore(function (state) {
    return state.tagIDsForCard
  })
  const toUpdateCard = useSignboardStore(function (state) {
    return state.toUpdateCard
  })
  const toWriteTag = useSignboardStore(function (state) {
    return state.toWriteTag
  })
  const toAttachTag = useSignboardStore(function (state) {
    return state.toAttachTag
  })
  const toDetachTag = useSignboardStore(function (state) {
    return state.toDetachTag
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
  const [tagDraft, setTagDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const attached = props.card ? tagIDsForCard(props.card.id) : []

  useEffect(
    function () {
      if (!props.card) return
      setTitle(props.card.title)
      setNotes(props.card.notes)
      setDue(toDateInput(props.card.dueAt))
      setRemind(Boolean(props.card.reminderID))
      setTagDraft('')
    },
    [props.card]
  )

  const persistTitle = useMemo(
    function () {
      return debounce(function (cardID: string, next: string, reminderID: string | null) {
        void toUpdateCard(cardID, { title: next }).then(function (ok) {
          if (!ok) toast.error('标题保存失败')
        })
        if (reminderID) {
          void toUpdateReminder({ key: reminderID, change: { title: next } }).catch(function () {
            toast.error('提醒标题同步失败')
          })
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
    setSaving(true)
    try {
      const dueAt = parseDateInput(due)
      const updated = await toUpdateCard(cardID, { dueAt })
      if (!updated) {
        toast.error('到期日保存失败')
        return
      }

      if (remind) {
        if (dueAt == null) {
          toast.error('开启提醒需要先设置到期日')
          return
        }
        if (reminderID) {
          await toUpdateReminder({
            key: reminderID,
            change: { title, dueAt, enabled: true, archivedAt: null }
          })
        } else {
          const id = await toWriteReminder({
            title: title || props.card!.title,
            dueAt,
            enabled: true
          })
          if (!id) {
            toast.error('创建提醒失败')
            return
          }
          await toUpdateCard(cardID, { reminderID: id, dueAt })
        }
        toast.success('已保存并开启提醒')
        props.onUpdateOpen(false)
        return
      }

      if (reminderID) {
        await toUpdateReminder({
          key: reminderID,
          change: { enabled: false, archivedAt: Date.now() }
        })
        await toUpdateCard(cardID, { reminderID: null, dueAt })
      }
      toast.success('已保存')
      props.onUpdateOpen(false)
    } catch {
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function toggleTag(tagID: string) {
    const isOn = attached.includes(tagID)
    const ok = isOn ? await toDetachTag(cardID, tagID) : await toAttachTag(cardID, tagID)
    if (!ok) toast.error(isOn ? '移除标签失败' : '添加标签失败')
  }

  async function createTag() {
    const titleValue = tagDraft.trim()
    if (!titleValue || !activeBoardID) return
    const existing = tags.find(function (tag) {
      return tag.title === titleValue
    })
    if (existing) {
      await toggleTag(existing.id)
      setTagDraft('')
      return
    }
    const id = await toWriteTag(activeBoardID, titleValue)
    if (!id) {
      toast.error('创建标签失败')
      return
    }
    await toAttachTag(cardID, id)
    setTagDraft('')
    toast.success('已添加标签')
  }

  return (
    <Sheet
      open={props.open}
      onOpenChange={props.onUpdateOpen}>
      <SheetContent
        side="right"
        showCloseButton
        overlayClassName="bg-black/20 supports-backdrop-filter:backdrop-blur-xs"
        className="w-[min(400px,94vw)] gap-0 overflow-y-auto sm:max-w-none">
        <SheetTitle className="mb-4 text-lg">卡片详情</SheetTitle>

        <div className={styles.sheetSection}>
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
              placeholder="补充上下文、验收标准或链接…"
              className="min-h-28"
              onChange={function (event) {
                setNotes(event.target.value)
              }}
              onBlur={function () {
                void toUpdateCard(cardID, { notes }).then(function (ok) {
                  if (!ok) toast.error('备注保存失败')
                })
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

          <div className={styles.sheetRow}>
            <div className="space-y-0.5">
              <Label htmlFor="signboard-card-remind">提醒我</Label>
              <p className="text-xs text-muted-foreground">写入本地 Reminder，到点通知</p>
            </div>
            <Switch
              id="signboard-card-remind"
              checked={remind}
              onCheckedChange={function (checked) {
                setRemind(checked)
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>标签</Label>
            <div className={styles.tagList}>
              {tags.map(function (tag) {
                const active = attached.includes(tag.id)
                return (
                  <button
                    key={tag.id}
                    type="button"
                    className={clsxTag(active)}
                    onClick={function () {
                      void toggleTag(tag.id)
                    }}>
                    {tag.title}
                  </button>
                )
              })}
            </div>
            <div className="flex gap-2">
              <Input
                value={tagDraft}
                placeholder="新建或搜索标签"
                className="h-9"
                onChange={function (event) {
                  setTagDraft(event.target.value)
                }}
                onKeyDown={function (event) {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void createTag()
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={function () {
                  void createTag()
                }}>
                添加
              </Button>
            </div>
          </div>

          <Button
            type="button"
            className="w-full"
            disabled={saving}
            onClick={function () {
              void saveDueAndRemind()
            }}>
            {saving ? '保存中…' : '保存'}
          </Button>

          <Button
            type="button"
            variant="ghost"
            className="w-full text-destructive"
            onClick={function () {
              void toUpdateCard(cardID, { archivedAt: Date.now() }).then(function (ok) {
                if (!ok) {
                  toast.error('归档失败')
                  return
                }
                toast.success('已归档')
                props.onUpdateOpen(false)
              })
            }}>
            <Icon
              icon="lucide:archive"
              className="size-4"
            />
            归档卡片
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function clsxTag(active: boolean) {
  return active ? `${styles.tagChip} ${styles.tagChipActive}` : styles.tagChip
}

export { CardSheet }
