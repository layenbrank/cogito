import { convertFileSrc, invoke } from '@tauri-apps/api/core'
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
import {
  useEffect,
  useMemo,
  useState,
  type ClipboardEvent,
  type DragEvent
} from 'react'
import { toast } from 'sonner'

import { CHANNELS } from '@/shared/ipc/channels'
import { useReminderStore } from '@/stores/reminder'
import {
  TAG_COLORS,
  useSignboardStore,
  type SignboardEntry
} from '@/stores/signboard'
import { HintTooltip } from '@/views/signboard/hint-tooltip'
import {
  findImageFiles,
  importImageFiles,
  pickAndImportImages
} from '@/views/signboard/import-attachment'
import styles from '@/views/signboard/signboard.module.scss'
import type { GalleryAsset } from '@/views/gallery/model/media'

interface CardSheetProps {
  card: SignboardEntry | null
  open: boolean
  onUpdateOpen: (open: boolean) => void
}

interface AttachmentPreview {
  assetID: string
  fileName: string
  src: string
  isCover: boolean
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
  const assetsForEntry = useSignboardStore(function (state) {
    return state.assetsForEntry
  })
  const coverAssetID = useSignboardStore(function (state) {
    return state.coverAssetID
  })
  const toUpdateEntry = useSignboardStore(function (state) {
    return state.toUpdateEntry
  })
  const toWriteTag = useSignboardStore(function (state) {
    return state.toWriteTag
  })
  const toUpdateTag = useSignboardStore(function (state) {
    return state.toUpdateTag
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
  const toAttachAsset = useSignboardStore(function (state) {
    return state.toAttachAsset
  })
  const toDetachAsset = useSignboardStore(function (state) {
    return state.toDetachAsset
  })
  const toPromoteCover = useSignboardStore(function (state) {
    return state.toPromoteCover
  })
  const toWriteReminder = useReminderStore(function (state) {
    return state.toWriteReminder
  })
  const toUpdateReminder = useReminderStore(function (state) {
    return state.toUpdateReminder
  })

  const [title, setTitle] = useState(function () {
    return props.card?.title ?? ''
  })
  const [notes, setNotes] = useState(function () {
    return props.card?.notes ?? ''
  })
  const [due, setDue] = useState<Dayjs | null>(function () {
    return parseDayjs(props.card?.dueAt ?? null)
  })
  const [start, setStart] = useState<Dayjs | null>(function () {
    return parseDayjs(props.card?.startAt ?? null)
  })
  const [priority, setPriority] = useState(function () {
    return String(props.card?.priority ?? 0)
  })
  const [remind, setRemind] = useState(function () {
    return Boolean(props.card?.reminderID)
  })
  const [tagDraft, setTagDraft] = useState('')
  const [checklistDraft, setChecklistDraft] = useState('')
  const [editingCheckID, setEditingCheckID] = useState<string | null>(null)
  const [editingCheckTitle, setEditingCheckTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [isAttachDragOver, setIsAttachDragOver] = useState(false)
  const [previews, setPreviews] = useState<AttachmentPreview[]>([])
  const [colorPickerTagID, setColorPickerTagID] = useState<string | null>(null)

  const attached = props.card ? tagIDsForEntry(props.card.id) : []
  const checklist = props.card ? checksForEntry(props.card.id) : []
  const links = props.card ? assetsForEntry(props.card.id) : []
  const linkKey = links
    .map(function (row) {
      return `${row.assetID}:${row.index}`
    })
    .join('|')
  const checklistDone = checklist.filter(function (item) {
    return item.done
  }).length
  const checklistTotal = checklist.length
  const checklistPct =
    checklistTotal === 0 ? 0 : Math.round((checklistDone / checklistTotal) * 100)

  const filteredTags = useMemo(
    function () {
      const q = tagDraft.trim().toLowerCase()
      if (!q) return tags
      return tags.filter(function (tag) {
        return tag.title.toLowerCase().includes(q)
      })
    },
    [tags, tagDraft]
  )

  useEffect(
    function () {
      let cancelled = false
      async function loadPreviews() {
        if (!props.card || linkKey.length === 0) {
          setPreviews([])
          return
        }
        const rows = assetsForEntry(props.card.id)
        try {
          const assets = await invoke<GalleryAsset[]>(CHANNELS.ASSET.READ, {
            params: rows.map(function (row) {
              return { id: row.assetID }
            })
          })
          const byID = new Map(
            assets.map(function (asset) {
              return [asset.id, asset]
            })
          )
          if (cancelled) return
          const cover = coverAssetID(props.card.id)
          setPreviews(
            rows
              .map(function (row) {
                const asset = byID.get(row.assetID)
                if (!asset) return null
                return {
                  assetID: row.assetID,
                  fileName: asset.fileName,
                  src: convertFileSrc(asset.filePath),
                  isCover: row.assetID === cover
                }
              })
              .filter(function (row): row is AttachmentPreview {
                return Boolean(row)
              })
          )
        } catch (error) {
          console.warn('loadPreviews failed', error)
          if (!cancelled) setPreviews([])
        }
      }
      void loadPreviews()
      return function () {
        cancelled = true
      }
    },
    [props.card, linkKey, assetsForEntry, coverAssetID]
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
        if (dueAt === null || dueAt === undefined) {
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
      toast.error('添加子任务失败')
      return
    }
    setChecklistDraft('')
  }

  async function commitCheckEdit(checkID: string) {
    const next = editingCheckTitle.trim()
    setEditingCheckID(null)
    if (!next) return
    const ok = await toUpdateCheck(checkID, { title: next })
    if (!ok) toast.error('子任务保存失败')
  }

  async function attachAssetIDs(ids: string[]) {
    if (ids.length === 0) return
    let failed = 0
    for (const assetID of ids) {
      const ok = await toAttachAsset(entryID, assetID)
      if (!ok) failed += 1
    }
    if (failed > 0) toast.error(`${failed} 张图片附加失败`)
    else toast.success(ids.length === 1 ? '已添加图片' : `已添加 ${ids.length} 张图片`)
  }

  async function attachImages() {
    setImporting(true)
    try {
      const ids = await pickAndImportImages()
      await attachAssetIDs(ids)
    } catch {
      toast.error('导入图片失败')
    } finally {
      setImporting(false)
    }
  }

  async function attachFromFiles(files: File[]) {
    if (files.length === 0 || importing) return
    setImporting(true)
    try {
      const ids = await importImageFiles(files)
      await attachAssetIDs(ids)
    } catch (error) {
      const message = error instanceof Error ? error.message : '导入图片失败'
      toast.error(message)
    } finally {
      setImporting(false)
    }
  }

  function handleAttachPaste(event: ClipboardEvent) {
    const files = findImageFiles(event.clipboardData)
    if (files.length === 0) return
    event.preventDefault()
    void attachFromFiles(files)
  }

  function handleAttachDragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsAttachDragOver(true)
  }

  function handleAttachDragLeave(event: DragEvent) {
    const next = event.relatedTarget as Node | null
    if (next && event.currentTarget.contains(next)) return
    setIsAttachDragOver(false)
  }

  function handleAttachDrop(event: DragEvent) {
    event.preventDefault()
    setIsAttachDragOver(false)
    const files = findImageFiles(event.dataTransfer)
    void attachFromFiles(files)
  }

  return (
    <Sheet
      open={props.open}
      onOpenChange={props.onUpdateOpen}>
      <SheetContent
        side="right"
        showCloseButton
        overlayClassName="bg-black/20 supports-backdrop-filter:backdrop-blur-xs"
        className="w-[min(400px,94vw)] gap-0 overflow-y-auto sm:max-w-none"
        onPaste={handleAttachPaste}>
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
            <div className="inline-flex items-center gap-1">
              <Label htmlFor="signboard-card-remind">提醒我</Label>
              <HintTooltip
                hint="写入本地 Reminder，到点通知"
                label="提醒我 说明"
              />
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
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1">
                <Label>子任务</Label>
                <HintTooltip
                  hint="把这张卡拆成可勾选的步骤；进度会显示在卡片上。"
                  label="子任务 说明"
                />
              </div>
              {checklistTotal > 0 ? (
                <span className={styles.checklistProgressLabel}>
                  {checklistDone}/{checklistTotal}
                </span>
              ) : null}
            </div>
            {checklistTotal > 0 ? (
              <div
                className={styles.checklistTrack}
                role="progressbar"
                aria-valuenow={checklistPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="子任务进度">
                <div
                  className={styles.checklistFill}
                  style={{ width: `${checklistPct}%` }}
                />
              </div>
            ) : null}
            <ul className={styles.checklistList}>
              {checklist.map(function (item) {
                const isEditing = editingCheckID === item.id
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
                    {isEditing ? (
                      <Input
                        autoFocus
                        value={editingCheckTitle}
                        className="h-8 flex-1"
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
                      <button
                        type="button"
                        className={
                          item.done
                            ? `${styles.checklistTitle} ${styles.checklistDone}`
                            : styles.checklistTitle
                        }
                        onClick={function () {
                          setEditingCheckID(item.id)
                          setEditingCheckTitle(item.title)
                        }}>
                        {item.title}
                      </button>
                    )}
                    <Button
                      type="button"
                      size="icon-lg"
                      variant="ghost"
                      className="ml-auto size-7"
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
            <div className="flex gap-2">
              <Input
                value={checklistDraft}
                placeholder="添加一步，例如：写验收标准"
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
            <div className="inline-flex items-center gap-1">
              <Label>标签</Label>
              <HintTooltip
                hint="色块用于扫视分类；点选切换挂载，新建时自动配色。"
                label="标签 说明"
              />
            </div>
            <div className={styles.tagList}>
              {filteredTags.map(function (tag) {
                const active = attached.includes(tag.id)
                const picking = colorPickerTagID === tag.id
                return (
                  <div
                    key={tag.id}
                    className={styles.tagChipWrap}>
                    <button
                      type="button"
                      className={active ? `${styles.tagChip} ${styles.tagChipActive}` : styles.tagChip}
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
                        style={{ background: tag.color ?? 'var(--muted-foreground)' }}
                        aria-hidden
                      />
                      {tag.title}
                    </button>
                    <button
                      type="button"
                      className={styles.tagColorToggle}
                      aria-label={`调整 ${tag.title} 颜色`}
                      aria-expanded={picking}
                      onClick={function () {
                        setColorPickerTagID(function (prev) {
                          return prev === tag.id ? null : tag.id
                        })
                      }}>
                      <Icon
                        icon="lucide:palette"
                        className="size-3.5"
                      />
                    </button>
                    {picking ? (
                      <div
                        className={styles.tagColorRow}
                        role="group"
                        aria-label={`${tag.title} 颜色`}>
                        {TAG_COLORS.map(function (color) {
                          return (
                            <button
                              key={color}
                              type="button"
                              className={styles.tagColorDot}
                              style={{ background: color }}
                              aria-label={`设为 ${color}`}
                              onClick={function () {
                                void toUpdateTag(tag.id, { color }).then(function (ok) {
                                  if (!ok) toast.error('改色失败')
                                  else setColorPickerTagID(null)
                                })
                              }}
                            />
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
            {tags.length > 0 && filteredTags.length === 0 ? (
              <p className="text-xs text-muted-foreground">无匹配标签，回车可新建</p>
            ) : null}
            <div className="flex gap-2">
              <Input
                value={tagDraft}
                placeholder="搜索或新建标签"
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

          <div
            className="space-y-2"
            onDragOver={handleAttachDragOver}
            onDragLeave={handleAttachDragLeave}
            onDrop={handleAttachDrop}>
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1">
                <Label>附件图片</Label>
                <HintTooltip
                  hint="首张为封面；可点选、拖入或 Ctrl+V / ⌘V 粘贴。"
                  label="附件图片 说明"
                />
              </div>
              <Button
                type="button"
                size="lg"
                variant="outline"
                disabled={importing}
                onClick={function () {
                  void attachImages()
                }}>
                <Icon
                  icon="lucide:image-plus"
                  className="size-4"
                />
                {importing ? '导入中…' : '添加图片'}
              </Button>
            </div>
            {previews.length === 0 ? (
              <button
                type="button"
                className={
                  isAttachDragOver
                    ? `${styles.attachEmpty} ${styles.attachEmptyActive}`
                    : styles.attachEmpty
                }
                disabled={importing}
                onClick={function () {
                  void attachImages()
                }}>
                <Icon
                  icon="lucide:image"
                  className="size-5 opacity-60"
                />
                <span>
                  {isAttachDragOver
                    ? '松开以添加图片'
                    : '点选本机图片，或拖入 / 粘贴截图'}
                </span>
              </button>
            ) : (
              <ul
                className={
                  isAttachDragOver
                    ? `${styles.attachGrid} ${styles.attachGridActive}`
                    : styles.attachGrid
                }>
                {previews.map(function (item) {
                  return (
                    <li
                      key={item.assetID}
                      className={styles.attachItem}>
                      <img
                        src={item.src}
                        alt={item.fileName}
                        className={styles.attachThumb}
                      />
                      <div className={styles.attachActions}>
                        {item.isCover ? (
                          <span className={styles.coverBadge}>封面</span>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={function () {
                              void toPromoteCover(entryID, item.assetID).then(function (ok) {
                                if (!ok) toast.error('设为封面失败')
                              })
                            }}>
                            设为封面
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="icon-lg"
                          variant="ghost"
                          className="size-7"
                          aria-label="移除附件"
                          onClick={function () {
                            void toDetachAsset(entryID, item.assetID).then(function (ok) {
                              if (!ok) toast.error('移除失败')
                            })
                          }}>
                          <Icon
                            icon="lucide:trash-2"
                            className="size-3.5"
                          />
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
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

export { CardSheet }
