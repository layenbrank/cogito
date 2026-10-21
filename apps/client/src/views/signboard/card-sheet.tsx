import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Checkbox } from '@i-thinking/design/components/checkbox'
import { DatePicker } from '@i-thinking/design/components/date-picker'
import { Input } from '@i-thinking/design/components/input'
import { Label } from '@i-thinking/design/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { Sheet, SheetContent, SheetTitle } from '@i-thinking/design/components/sheet'
import { Switch } from '@i-thinking/design/components/switch'
import { Textarea } from '@i-thinking/design/components/textarea'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { debounce } from 'lodash-es'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useReminderStore } from '@/stores/reminder'
import { useSignboardStore, type SignboardEntry } from '@/stores/signboard'
import styles from '@/views/signboard/signboard.module.scss'

interface CardSheetProps {
  card: SignboardEntry | null
  open: boolean
  onUpdateOpen: (open: boolean) => void
}

function parseDayjs(ms: number | null): Dayjs | null {
  if (ms === null) return null
  return dayjs(ms)
}

/** 存盘用本地 09:00，与原先 `YYYY-MM-DD` + T09:00:00 行为一致 */
function parseTimestamp(value: Dayjs | null): number | null {
  if (!value) return null
  return value.hour(9).minute(0).second(0).millisecond(0).valueOf()
}

const PRIORITY_OPTIONS = [
  { value: '0', label: '无' },
  { value: '1', label: '低' },
  { value: '2', label: '中' },
  { value: '3', label: '高' },
  { value: '4', label: '紧急' }
] as const

function CardSheet(props: CardSheetProps) {
  const tags = useSignboardStore(function (state) {
    return state.tags
  })
  const activeBoardID = useSignboardStore(function (state) {
    return state.activeBoardID
  })
  const tagIDsForEntry = useSignboardStore(function (state) {
    return state.tagIDsForEntry
  })
  const checksForEntry = useSignboardStore(function (state) {
    return state.checksForEntry
  })
  const toUpdateEntry = useSignboardStore(function (state) {
    return state.toUpdateEntry
  })
  const toWriteTag = useSignboardStore(function (state) {
    return state.toWriteTag
  })
  const toTagEntry = useSignboardStore(function (state) {
    return state.toTagEntry
  })
  const toUntagEntry = useSignboardStore(function (state) {
    return state.toUntagEntry
  })
  const toWriteCheck = useSignboardStore(function (state) {
    return state.toWriteCheck
  })
  const toUpdateCheck = useSignboardStore(function (state) {
    return state.toUpdateCheck
  })
  const toRemoveCheck = useSignboardStore(function (state) {
    return state.toRemoveCheck
  })
  const toWriteReminder = useReminderStore(function (state) {
    return state.toWriteReminder
  })
  const toUpdateReminder = useReminderStore(function (state) {
    return state.toUpdateReminder
  })

  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [due, setDue] = useState<Dayjs | null>(null)
  const [start, setStart] = useState<Dayjs | null>(null)
  const [priority, setPriority] = useState('0')
  const [remind, setRemind] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const [checklistDraft, setChecklistDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const attached = props.card ? tagIDsForEntry(props.card.id) : []
  const checklist = props.card ? checksForEntry(props.card.id) : []

  useEffect(
    function () {
      if (!props.card) return
      setTitle(props.card.title)
      setNotes(props.card.notes)
      setDue(parseDayjs(props.card.dueAt))
      setStart(parseDayjs(props.card.startAt))
      setPriority(String(props.card.priority ?? 0))
      setRemind(Boolean(props.card.reminderID))
      setTagDraft('')
      setChecklistDraft('')
    },
    [props.card]
  )

  const persistTitle = useMemo(
    function () {
      return debounce(function (entryID: string, next: string, reminderID: string | null) {
        void toUpdateEntry(entryID, { title: next }).then(function (ok) {
          if (!ok) toast.error('标题保存失败')
        })
        if (reminderID) {
          void toUpdateReminder({ key: reminderID, change: { title: next } }).catch(function () {
            toast.error('提醒标题同步失败')
          })
        }
      }, 400)
    },
    [toUpdateEntry, toUpdateReminder]
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

  const entryID = props.card.id
  const reminderID = props.card.reminderID

  async function saveDueAndRemind() {
    setSaving(true)
    try {
      const dueAt = parseTimestamp(due)
      const startAt = parseTimestamp(start)
      const updated = await toUpdateEntry(entryID, {
        dueAt,
        startAt,
        priority: Number(priority) || 0
      })
      if (!updated) {
        toast.error('保存失败')
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
          await toUpdateEntry(entryID, { reminderID: id, dueAt })
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
        await toUpdateEntry(entryID, { reminderID: null, dueAt })
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
    const ok = isOn ? await toUntagEntry(entryID, tagID) : await toTagEntry(entryID, tagID)
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
    await toTagEntry(entryID, id)
    setTagDraft('')
    toast.success('已添加标签')
  }

  async function addChecklistItem() {
    const titleValue = checklistDraft.trim()
    if (!titleValue) return
    const id = await toWriteCheck(entryID, titleValue)
    if (!id) {
      toast.error('添加清单项失败')
      return
    }
    setChecklistDraft('')
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
                persistTitle(entryID, next, reminderID)
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
                void toUpdateEntry(entryID, { notes }).then(function (ok) {
                  if (!ok) toast.error('备注保存失败')
                })
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="signboard-card-start">开始</Label>
              <DatePicker
                id="signboard-card-start"
                value={start}
                onChange={function (date) {
                  setStart(date)
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signboard-card-due">到期</Label>
              <DatePicker
                id="signboard-card-due"
                value={due}
                onChange={function (date) {
                  setDue(date)
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>优先级</Label>
            <Select
              items={PRIORITY_OPTIONS.map(function (row) {
                return { value: row.value, label: row.label }
              })}
              value={priority}
              onValueChange={function (value) {
                if (value === null) return
                setPriority(value)
                void toUpdateEntry(entryID, { priority: Number(value) || 0 }).then(function (ok) {
                  if (!ok) toast.error('优先级保存失败')
                })
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
            <Label>清单</Label>
            <ul className={styles.checklistList}>
              {checklist.map(function (item) {
                return (
                  <li
                    key={item.id}
                    className={styles.checklistItem}>
                    <Checkbox
                      checked={item.done}
                      onCheckedChange={function (checked) {
                        void toUpdateCheck(item.id, { done: Boolean(checked) })
                      }}
                    />
                    <span className={item.done ? styles.checklistDone : undefined}>{item.title}</span>
                    <Button
                      type="button"
                      size="icon-lg"
                      variant="ghost"
                      className="ml-auto size-7"
                      aria-label="删除清单项"
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
            <div className="flex gap-2">
              <Input
                value={checklistDraft}
                placeholder="添加清单项"
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
                size="lg"
                onClick={function () {
                  void createTag()
                }}>
                添加
              </Button>
            </div>
          </div>

          <Button
            type="button"
            size="lg"
            className="mt-1 w-full"
            disabled={saving}
            onClick={function () {
              void saveDueAndRemind()
            }}>
            {saving ? '保存中…' : '保存'}
          </Button>

          <Button
            type="button"
            size="lg"
            variant="ghost"
            className="w-full text-destructive"
            onClick={function () {
              void toUpdateEntry(entryID, { archivedAt: Date.now() }).then(function (ok) {
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
