import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import type { Dayjs } from 'dayjs'
import { debounce } from 'lodash-es'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent
} from 'react'
import { toast } from 'sonner'

import type { LightboxMedia } from '@/components/media-lightbox'
import { CHANNELS } from '@/shared/ipc/channels'
import { useReminderStore } from '@/stores/reminder'
import { useSignboardStore } from '@/stores/signboard'
import {
  parseDayjs,
  parseTimestamp,
  type AttachmentPreview,
  type CardSheetProps
} from '@/views/signboard/card-sheet-types.ts'
import {
  findImageFiles,
  importImageFiles,
  pickAndImportImages
} from '@/views/signboard/import-attachment'
import type { GalleryAsset } from '@/views/gallery/model/media'


function useCardSheet(props: CardSheetProps) {
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
  const attachedSet = new Set(attached)
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
      async function fetchPreviews() {
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
          console.warn('fetchPreviews failed', error)
          if (!cancelled) setPreviews([])
        }
      }
      void fetchPreviews()
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

  const entryID = props.card?.id ?? ''
  const reminderID = props.card?.reminderID ?? null

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

  async function insertTag() {
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
    const results = await Promise.allSettled(
      ids.map(function (assetID) {
        return toAttachAsset(entryID, assetID)
      })
    )
    let failed = 0
    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn('[signboard] attach asset failed', result.reason)
        failed += 1
        continue
      }
      if (!result.value) failed += 1
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

  return {
    open: props.open,
    onUpdateOpen: props.onUpdateOpen,
    card: props.card,
    title,
    setTitle,
    notes,
    setNotes,
    due,
    setDue,
    start,
    setStart,
    priority,
    setPriority,
    remind,
    setRemind,
    tagDraft,
    setTagDraft,
    checklistDraft,
    setChecklistDraft,
    editingCheckID,
    setEditingCheckID,
    editingCheckTitle,
    setEditingCheckTitle,
    saving,
    importing,
    isAttachDragOver,
    setIsAttachDragOver,
    previews,
    lightboxID,
    setLightboxID,
    isLightboxOpen,
    setIsLightboxOpen,
    labelsRef,
    datesRef,
    checksRef,
    attachRef,
    attached,
    attachedSet,
    checklist,
    links,
    checklistDone,
    checklistTotal,
    checklistPct,
    displayPct,
    lightboxMedias,
    filteredTags,
    persistTitle,
    entryID,
    reminderID,
    scrollToSection,
    openLightbox,
    persistSchedule,
    toggleTag,
    insertTag,
    addChecklistItem,
    commitCheckEdit,
    attachImages,
    handleAttachPaste,
    handleAttachDragOver,
    handleAttachDragLeave,
    handleAttachDrop,
    tags,
    activeBoardID,
    toUpdateEntry,
    toUpdateCheck,
    toRemoveCheck,
    toDetachAsset,
    toPromoteCover,
    toUpdateTag
  }
}

export { useCardSheet }
