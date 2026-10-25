import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Checkbox } from '@cogito/design/components/checkbox'
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { Switch } from '@cogito/design/components/switch'
import { Textarea } from '@cogito/design/components/textarea'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { debounce } from 'lodash-es'
import { cn } from 'cn'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent
} from 'react'
import { toast } from 'sonner'

import {
  MediaLightbox,
  type LightboxMedia
} from '@/components/media-lightbox'
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
  const [lightboxID, setLightboxID] = useState<string | null>(null)
  const [isLightboxOpen, setIsLightboxOpen] = useState(false)
  const [wasSheetOpen, setWasSheetOpen] = useState(props.open)
  // 随弹层关闭复位预览态（渲染期同步，避免 effect 内 setState）
  if (props.open !== wasSheetOpen) {
    setWasSheetOpen(props.open)
    if (!props.open) {
      setIsLightboxOpen(false)
      setLightboxID(null)
    }
  }
  // native TS DOM lib 暂无 HTMLSectionElement，用 HTMLElement 承接 <section>
  const labelsRef = useRef<HTMLElement | null>(null)
  const datesRef = useRef<HTMLElement | null>(null)
  const checksRef = useRef<HTMLElement | null>(null)
  const attachRef = useRef<HTMLElement | null>(null)

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
  const displayPct = checklistPct
  const lightboxMedias = useMemo(
    function (): LightboxMedia[] {
      return previews.map(function (item) {
        return {
          id: item.assetID,
          src: item.src,
          fileName: item.fileName,
          kind: 'image'
        }
      })
    },
    [previews]
  )

  function scrollToSection(ref: { current: HTMLElement | null }) {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function openLightbox(assetID: string) {
    setLightboxID(assetID)
    setIsLightboxOpen(true)
  }

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

  async function persistSchedule(next: {
    due?: Dayjs | null
    start?: Dayjs | null
    priority?: string
    remind?: boolean
  }) {
    const nextDue = next.due !== undefined ? next.due : due
    const nextStart = next.start !== undefined ? next.start : start
    const nextPriority = next.priority !== undefined ? next.priority : priority
    const nextRemind = next.remind !== undefined ? next.remind : remind
    setSaving(true)
    try {
      const dueAt = parseTimestamp(nextDue)
      const startAt = parseTimestamp(nextStart)
      const updated = await toUpdateEntry(entryID, {
        dueAt,
        startAt,
        priority: Number(nextPriority) || 0
      })
      if (!updated) {
        toast.error('日程保存失败')
        return
      }

      if (nextRemind) {
        if (dueAt === null || dueAt === undefined) {
          toast.error('开启提醒需要先设置到期日')
          setRemind(false)
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
            setRemind(false)
            return
          }
          await toUpdateEntry(entryID, { reminderID: id, dueAt })
        }
        return
      }

      if (reminderID) {
        await toUpdateReminder({
          key: reminderID,
          change: { enabled: false, archivedAt: Date.now() }
        })
        await toUpdateEntry(entryID, { reminderID: null, dueAt })
      }
    } catch {
      toast.error('日程保存失败')
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
    <>
    <Dialog
      open={props.open}
      onOpenChange={props.onUpdateOpen}>
      <DialogContent
        side="center"
        showCloseButton
        overlayClassName="bg-black/45 supports-backdrop-filter:backdrop-blur-[2px]"
        className={cn(
          styles.cardDialog,
          // 盖掉 Dialog 默认 sm:max-w-sm 与 max-h 40rem
          'h-[min(88vh,56rem)]! max-h-[min(88vh,56rem)]! w-[min(960px,94vw)]! max-w-[min(960px,94vw)]! sm:max-w-[min(960px,94vw)]!'
        )}
        onPaste={handleAttachPaste}>
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
                id="signboard-card-title"
                value={title}
                className={styles.cardDialogTitleInput}
                placeholder="卡片标题"
                onChange={function (event) {
                  const next = event.target.value
                  setTitle(next)
                  persistTitle(entryID, next, reminderID)
                }}
              />
            </div>
            <div className={styles.cardDialogActions}>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={styles.cardDialogAction}
                onClick={function () {
                  scrollToSection(labelsRef)
                }}>
                <Icon
                  icon="lucide:tags"
                  className="size-3.5"
                />
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
                <Icon
                  icon="lucide:calendar"
                  className="size-3.5"
                />
                日期
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={styles.cardDialogAction}
                onClick={function () {
                  scrollToSection(checksRef)
                }}>
                <Icon
                  icon="lucide:square-check-big"
                  className="size-3.5"
                />
                清单
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={styles.cardDialogAction}
                onClick={function () {
                  scrollToSection(attachRef)
                }}>
                <Icon
                  icon="lucide:paperclip"
                  className="size-3.5"
                />
                附件
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className={styles.cardDialogBody}>
          <div className={styles.cardDialogLayout}>
            <div className={styles.cardDialogMain}>
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
              id="signboard-card-notes"
              value={notes}
              placeholder="补充上下文、验收标准或链接…"
              className={styles.cardDialogNotes}
              onChange={function (event) {
                setNotes(event.target.value)
              }}
              onBlur={function () {
                void toUpdateEntry(entryID, { notes }).then(function (ok) {
                  if (!ok) toast.error('备注保存失败')
                })
              }}
            />
          </section>

          <section
            ref={checksRef}
            className={styles.sheetBlock}>
            <div className={styles.dialogSectionHead}>
              <Icon
                icon="lucide:square-check-big"
                className="size-4"
                aria-hidden
              />
              <HintTooltip
                hint="把这张卡拆成可勾选的步骤；勾选后自动更新进度。"
                className={styles.dialogSectionTitle}>
                清单
              </HintTooltip>
              <span className={`${styles.checklistProgressLabel} ${styles.dialogSectionAside}`}>
                {checklistTotal > 0
                  ? `${checklistDone}/${checklistTotal} · ${displayPct}%`
                  : '暂无步骤'}
              </span>
            </div>
            <div
              className={styles.checklistTrack}
              role="progressbar"
              aria-valuenow={displayPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="清单进度">
              <div
                className={styles.checklistFill}
                style={{ width: `${displayPct}%` }}
              />
            </div>
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
          </section>

          <section
            ref={attachRef}
            className={styles.sheetBlock}
            onDragOver={handleAttachDragOver}
            onDragLeave={handleAttachDragLeave}
            onDrop={handleAttachDrop}>
            <div className={styles.dialogSectionHead}>
              <Icon
                icon="lucide:paperclip"
                className="size-4"
                aria-hidden
              />
              <HintTooltip
                hint="首张为封面；可点选、拖入或 Ctrl+V / ⌘V 粘贴。"
                className={styles.dialogSectionTitle}>
                附件
              </HintTooltip>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={`${styles.cardDialogAction} ${styles.dialogSectionAside}`}
                disabled={importing}
                onClick={function () {
                  void attachImages()
                }}>
                <Icon
                  icon="lucide:image-plus"
                  className="size-3.5"
                />
                {importing ? '导入中…' : '添加'}
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
                      className={
                        item.isCover
                          ? `${styles.attachItem} ${styles.attachItemCover}`
                          : styles.attachItem
                      }>
                      <button
                        type="button"
                        className={styles.attachThumbBtn}
                        aria-label={`预览 ${item.fileName}`}
                        onClick={function () {
                          openLightbox(item.assetID)
                        }}>
                        <img
                          src={item.src}
                          alt=""
                          className={styles.attachThumb}
                          draggable={false}
                        />
                        <span
                          className={styles.attachThumbHint}
                          aria-hidden>
                          <Icon
                            icon="lucide:expand"
                            className="size-3.5"
                          />
                        </span>
                      </button>
                      <div className={styles.attachMeta}>
                        <button
                          type="button"
                          className={styles.attachName}
                          title={item.fileName}
                          onClick={function () {
                            openLightbox(item.assetID)
                          }}>
                          {item.fileName}
                        </button>
                        <div className={styles.attachMetaRow}>
                          {item.isCover ? (
                            <span className={styles.coverBadge}>
                              <Icon
                                icon="lucide:image"
                                className="size-3"
                                aria-hidden
                              />
                              封面
                            </span>
                          ) : (
                            <button
                              type="button"
                              className={styles.attachCoverLink}
                              onClick={function () {
                                void toPromoteCover(entryID, item.assetID).then(
                                  function (ok) {
                                    if (!ok) toast.error('设为封面失败')
                                  }
                                )
                              }}>
                              设为封面
                            </button>
                          )}
                        </div>
                      </div>
                      <div className={styles.attachActions}>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className={styles.attachActionBtn}
                          aria-label={`预览 ${item.fileName}`}
                          onClick={function () {
                            openLightbox(item.assetID)
                          }}>
                          <Icon
                            icon="lucide:eye"
                            className="size-3.5"
                          />
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className={`${styles.attachActionBtn} ${styles.attachActionDanger}`}
                          aria-label="移除附件"
                          onClick={function () {
                            void toDetachAsset(entryID, item.assetID).then(
                              function (ok) {
                                if (!ok) toast.error('移除失败')
                              }
                            )
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
          </section>
            </div>

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
                      const active = attached.includes(tag.id)
                      return (
                        <div
                          key={tag.id}
                          className={styles.tagChipWrap}>
                          <button
                            type="button"
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
                          </button>
                          <div
                            className={styles.tagColorRow}
                            role="group"
                            aria-label={`${tag.title} 颜色`}>
                            {TAG_COLORS.map(function (color) {
                              const isCurrent = tag.color === color
                              return (
                                <button
                                  key={color}
                                  type="button"
                                  className={
                                    isCurrent
                                      ? `${styles.tagColorDot} ${styles.tagColorDotActive}`
                                      : styles.tagColorDot
                                  }
                                  style={{ background: color }}
                                  aria-label={`设为 ${color}`}
                                  aria-pressed={isCurrent}
                                  onClick={function () {
                                    void toUpdateTag(tag.id, { color }).then(
                                      function (ok) {
                                        if (!ok) toast.error('改色失败')
                                      }
                                    )
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
                    <p className="text-xs text-muted-foreground">
                      无匹配标签，回车可新建
                    </p>
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
              </section>
            </aside>
          </div>
        </div>

        <DialogFooter className={styles.cardDialogFooter}>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
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
            归档
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={function () {
              props.onUpdateOpen(false)
            }}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <MediaLightbox
      open={isLightboxOpen}
      medias={lightboxMedias}
      initialId={lightboxID}
      onOpenChange={function (open) {
        setIsLightboxOpen(open)
        if (!open) setLightboxID(null)
      }}
    />
    </>
  )
}

export { CardSheet }
