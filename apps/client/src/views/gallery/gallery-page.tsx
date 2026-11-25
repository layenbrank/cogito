import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Splitter, SplitterHandle, SplitterPane } from '@cogito/design/components/splitter'
import { Icon } from '@iconify/react'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { MediaLightbox, type LightboxMedia } from '@/components/media-lightbox'
import { useShellSurface } from '@/features/window-shell/slots'
import {
  DELETE_GALLERY_ALBUM,
  DELETE_GALLERY_SMART_ALBUM,
  GET_GALLERY_DETAILS,
  GET_GALLERY_SEARCH,
  GET_GALLERY_SIMILAR,
  GET_GALLERY_SMART_ALBUMS,
  POST_GALLERY_ALBUM,
  POST_GALLERY_DEDUPE,
  POST_GALLERY_PHASH,
  POST_GALLERY_RESCAN,
  POST_GALLERY_SMART_ALBUM
} from '@/apis/gallery'
import { GET_MEDIA_PICK } from '@/apis/media'
import { DELETE_ALBUMS, GET_ALBUMS, POST_ALBUMS } from '@/apis/album'
import { toLegacyMedias } from '@/views/gallery/data/legacy-media'
import { originalUrlFor } from '@/views/gallery/data/thumb-url'
import type {
  CuratePatch,
  GalleryDetails,
  GalleryRow,
  SmartAlbumRow
} from '@/views/gallery/model/asset'
import {
  findAlbumCounts,
  findDupCounts,
  findFacets,
  findSections,
  findStats,
  findViewRows,
  type GallerySortKey
} from '@/views/gallery/model/derive'
import { parseFilter, serializeFilter, isFilterEmpty, type GalleryFilterState } from '@/views/gallery/model/filter'
import { VIEWS, type GalleryViewID } from '@/views/gallery/model/views'
import type { AlbumModel } from '@/views/gallery/ui/shell/sidebar'
import { ConfirmDialog, PromptDialog } from '@/views/gallery/ui/shell/confirm-dialog'
import { SelectionBar } from '@/views/gallery/ui/shell/selection-bar'
import { CHANNELS } from '@/shared/ipc/channels'
import { useCatalogStore } from '@/views/gallery/store/catalog'
import { useSelectionStore } from '@/views/gallery/store/selection'
import { MAX_COLUMNS, MIN_COLUMNS, useViewStore } from '@/views/gallery/store/view'
import { FilterBar } from '@/views/gallery/ui/shell/filter-bar'
import { Inspector } from '@/views/gallery/ui/shell/inspector'
import { Sidebar } from '@/views/gallery/ui/shell/sidebar'
import { StatusBar } from '@/views/gallery/ui/shell/status-bar'
import { VirtualGrid } from '@/views/gallery/ui/grid/virtual-grid'
import { BatchRenameDialog } from '@/views/gallery/ui/batch-rename-dialog'

/**
 * 图库页：三栏（视图 / 内容 / 检查器）+ 工具条 + 状态栏。
 *
 * 装配层只做三件事：把 store 的派生结果拼给组件、挂键盘总线、托管对话框。
 * 所有筛选/排序/分组逻辑在 `model/derive.ts`（纯函数，可单测），
 * 所有读写走 `store/*`，页面自己不持有 catalog 副本。
 */
const IMPORT_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff',
  'dng', 'cr2', 'cr3', 'nef', 'arw', 'raf', 'orf', 'rw2', 'pef',
  'mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'
]

const SORT_TEXT: Record<GallerySortKey, string> = {
  capturedAt: '拍摄时间',
  name: '文件名',
  size: '体积',
  rating: '星级',
  addedAt: '加入时间'
}

const SORT_OPTIONS = (Object.keys(SORT_TEXT) as GallerySortKey[]).map(function (key) {
  return { value: key, label: SORT_TEXT[key] }
})

const SCOPE_OPTIONS = [
  { value: 'day', label: '按天' },
  { value: 'month', label: '按月' }
]

/** 位置自检每会话只跑一次（模块级：图库页会被反复挂载/卸载） */
let hasRescannedThisSession = false

/** 搜索快捷键提示：Windows/Linux 是 Ctrl，macOS 是 ⌘ */
const SEARCH_HINT = navigator.platform.toLowerCase().includes('mac') ? '⌘K' : 'Ctrl+K'

function GalleryPage() {
  useShellSurface(useMemo(function () {
    return { summary: '图库', scrollable: false }
  }, []))

  const catalogRows = useCatalogStore(function (state) {
    return state.rows
  })
  const catalogProbed = useCatalogStore(function (state) {
    return state.probedCount
  })
  const catalogError = useCatalogStore(function (state) {
    return state.error
  })
  const isCatalogLoading = useCatalogStore(function (state) {
    // 只拼首次加载：刷新（导入/去重后）应继续显示旧行，而不是整个网格闪一下骨架
    return !state.loaded
  })
  const toRead = useCatalogStore(function (state) {
    return state.toRead
  })
  const view = useViewStore()
  const selectedIDs = useSelectionStore(function (state) {
    return state.ids
  })
  const isSelectionMode = useSelectionStore(function (state) {
    return state.isMode
  })

  const [albums, setAlbums] = useState<AlbumModel[]>([])
  const [smartAlbums, setSmartAlbums] = useState<SmartAlbumRow[]>([])
  const [details, setDetails] = useState<GalleryDetails | null>(null)
  const [activeID, setActiveID] = useState<string | null>(null)
  const [searchIDs, setSearchIDs] = useState<string[] | null>(null)
  const [isLightboxOpen, setIsLightboxOpen] = useState(false)
  const [lightboxID, setLightboxID] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [isRenameOpen, setIsRenameOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(
    null
  )
  const [isSmartPromptOpen, setIsSmartPromptOpen] = useState(false)
  /** 待确认的危险操作：删除相簿 / 删除智能相簿 / 移入回收站 */
  const [confirmAction, setConfirmAction] = useState<
    { kind: 'trash'; ids: string[] } | { kind: 'album'; id: string; name: string } | { kind: 'smart'; id: string; name: string } | null
  >(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const searchTimer = useRef<number | null>(null)

  const refreshMeta = useCallback(async function () {
    try {
      // 只拉「无法从 catalog 派生」的东西：相簿列表与智能相簿。
      // facet 计数 / 相簿角标全在下面的 useMemo 里由 catalog 现算 ——
      // 旧实现是两份额外命令，各自把整库再读一遍（单连接下串行执行）。
      const [nextAlbums, nextSmart] = await Promise.all([
        GET_ALBUMS<AlbumModel[]>(),
        GET_GALLERY_SMART_ALBUMS()
      ])
      setAlbums(nextAlbums.map(function (album) {
        return { id: album.id, name: album.name }
      }))
      setSmartAlbums(nextSmart)
    } catch (error) {
      console.error('[gallery] 元数据加载失败', error)
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(
    function () {
      void toRead()
      void refreshMeta()
      // 启动时顺手做一次位置校验（**每会话一次**）：盘拔过 / 文件夹挪过的项会被标成 missing，
      // 插回来自动恢复 —— 不必等用户手动点「重扫」。
      // 每会话只跑一次：重扫要逐文件 `stat`，而图库页每次进入都会重新挂载，
      // 不拦一下就是「切回图库就扫全盘」。真实目录监听见决策文档 D16/D18。
      if (!hasRescannedThisSession) {
        hasRescannedThisSession = true
        void POST_GALLERY_RESCAN()
          .then(function (result) {
            if (result.missing > 0 || result.restored > 0) return toRead()
            return undefined
          })
          .catch(function (error) {
            console.warn('[gallery] 启动重扫失败', error)
          })
      }
      // 只在挂载时拉一次；后续变化由写操作自己刷新
    },
    [toRead, refreshMeta]
  )

  // 长任务进度：Rust 侧按节流发事件（导入每 20 个 / 150ms，去重每 20 个）。
  // 没有这层监听时，用户只能看到一个永远转圈的“导入中…”，不知道卡在哪。
  useEffect(
    function () {
      const disposers: (() => void)[] = []
      let cancelled = false
      function onImportProgress(payload: { done: number; total: number; current: string }): void {
        setProgress({
          label: payload.current ? `导入 ${payload.current}` : '导入',
          done: payload.done,
          total: payload.total
        })
      }
      function onDedupeProgress(payload: { done: number; total: number }): void {
        setProgress({ label: '计算内容哈希', done: payload.done, total: payload.total })
      }
      void listen<{ done: number; total: number; current: string }>(
        CHANNELS.GALLERY.IMPORT_PROGRESS,
        function (event) {
          onImportProgress(event.payload)
        }
      ).then(function (unlisten) {
        if (cancelled) unlisten()
        else disposers.push(unlisten)
      })
      void listen<{ done: number; total: number }>(CHANNELS.GALLERY.DEDUPE_PROGRESS, function (event) {
        onDedupeProgress(event.payload)
      }).then(function (unlisten) {
        if (cancelled) unlisten()
        else disposers.push(unlisten)
      })
      return function () {
        cancelled = true
        disposers.forEach(function (dispose) {
          dispose()
        })
      }
    },
    []
  )

  const refreshDetails = useCallback(async function (id: string | null) {
    if (!id) {
      setDetails(null)
      return
    }
    try {
      const rows = await GET_GALLERY_DETAILS([id])
      setDetails(rows[0] ?? null)
    } catch (error) {
      console.warn('[gallery] 详情读取失败', error)
      setDetails(null)
    }
  }, [])

  // 详情：只在聚焦项变化时按需取（catalog 里不带 EXIF）
  useEffect(
    function () {
      void refreshDetails(activeID)
    },
    [activeID, refreshDetails]
  )

  // 文字筛选（含关键词）→ 后端 SQL 算 id 集，防抖 180ms
  const keywordText = view.filter.keywords
    .map(function (value) {
      return value.split(':')[1] ?? ''
    })
    .filter(Boolean)
  const searchText = [view.query.trim(), ...keywordText].filter(Boolean).join(' ')

  useEffect(
    function () {
      if (searchTimer.current !== null) window.clearTimeout(searchTimer.current)
      if (!searchText) {
        setSearchIDs(null)
        return
      }
      searchTimer.current = window.setTimeout(function () {
        void GET_GALLERY_SEARCH(searchText)
          .then(function (ids) {
            setSearchIDs(ids)
          })
          .catch(function () {
            setSearchIDs(null)
          })
      }, 180)
      return function () {
        if (searchTimer.current !== null) window.clearTimeout(searchTimer.current)
      }
    },
    [searchText]
  )

  const dupCounts = useMemo(
    function () {
      return findDupCounts(catalogRows)
    },
    [catalogRows]
  )

  const context = useMemo(
    function () {
      return { dupCounts }
    },
    [dupCounts]
  )

  // 智能相簿：把规则解析出来叠在当前筛选上（解析失败就只按相簿/视图显示，不猜）
  const smartFilter = useMemo<Partial<GalleryFilterState> | null>(function () {
    if (!view.activeSmartAlbumID) return null
    const album = smartAlbums.find(function (row) {
      return row.id === view.activeSmartAlbumID
    })
    if (!album) return null
    return parseFilter(album.query)
  }, [smartAlbums, view.activeSmartAlbumID])

  const effectiveFilter = useMemo<GalleryFilterState>(function () {
    const base: GalleryFilterState = smartFilter
      ? { ...view.filter, ...smartFilter }
      : view.filter
    const withSearch: GalleryFilterState = { ...base, searchIDs }
    if (view.activeAlbumID) {
      return { ...withSearch, albumIDs: [view.activeAlbumID] }
    }
    return withSearch
  }, [view.filter, smartFilter, searchIDs, view.activeAlbumID])

  const visibleRows = useMemo(
    function () {
      return findViewRows(
        catalogRows,
        view.viewID,
        effectiveFilter,
        context,
        view.sortKey,
        view.isStackFolded
      )
    },
    [catalogRows, view.viewID, effectiveFilter, context, view.sortKey, view.isStackFolded]
  )

  // facet 与相簿角标都从 catalog 派生：一次 O(n) 遍历，比再一次 IPC + 全表扫描便宜得多
  const facets = useMemo(
    function () {
      return findFacets(catalogRows)
    },
    [catalogRows]
  )

  const albumCounts = useMemo(
    function () {
      return findAlbumCounts(catalogRows)
    },
    [catalogRows]
  )

  const sections = useMemo(
    function () {
      // 默认排序就是拍摄时间：`findViewRows` 刚排过，这里不再重排
      return findSections(visibleRows, view.sectionScope, view.sortKey === 'capturedAt')
    },
    [visibleRows, view.sectionScope, view.sortKey]
  )

  const stats = useMemo(
    function () {
      return findStats(catalogRows, visibleRows)
    },
    [catalogRows, visibleRows]
  )

  const countByView = useMemo(
    function () {
      const counts: Record<string, number> = {}
      for (const item of VIEWS) {
        let total = 0
        for (const row of catalogRows) {
          if (item.match(row, context)) total += 1
        }
        counts[item.id] = total
      }
      return counts
    },
    [catalogRows, context]
  )

  const orderIDs = useMemo(
    function () {
      return visibleRows.map(function (row) {
        return row.id
      })
    },
    [visibleRows]
  )

  const activeRow = useMemo(
    function () {
      return (
        catalogRows.find(function (row) {
          return row.id === activeID
        }) ?? null
      )
    },
    [catalogRows, activeID]
  )

  const lightboxMedias = useMemo<LightboxMedia[]>(function () {
    // 灯箱关着就不必为整个可见集建对象（几万行时这道开销在每次筛选变化时都付）
    if (!isLightboxOpen) return []
    return visibleRows.map(function (row) {
      return {
        id: row.id,
        src: originalUrlFor(row),
        fileName: row.name,
        kind: row.kind === 'video' ? 'video' : 'image',
        durationMs: row.durationMs ?? undefined
      }
    })
  }, [visibleRows, isLightboxOpen])

  const renameMedias = useMemo(
    function () {
      if (!isRenameOpen) return []
      return toLegacyMedias(
        catalogRows.filter(function (row) {
          return selectedIDs.has(row.id)
        })
      )
    },
    [catalogRows, selectedIDs, isRenameOpen]
  )

  const onActivate = useCallback(
    function (row: GalleryRow, options: { additive: boolean; range: boolean }) {
      useSelectionStore.getState().toClick(row.id, { ...options, order: orderIDs })
      setActiveID(row.id)
    },
    [orderIDs]
  )

  const onOpen = useCallback(function (row: GalleryRow) {
    setLightboxID(row.id)
    setIsLightboxOpen(true)
  }, [])

  const POST_GALLERY_CURATE = useCallback(
    async function (ids: string[], patch: CuratePatch) {
      try {
        await useCatalogStore.getState().toCurate(ids, patch)
        // 关键词 / 隐藏这类不进 catalog 乐观更新的字段：写成功后重读一次
        if (patch.keywords) {
          await useCatalogStore.getState().toRead()
          await refreshDetails(activeID)
        }
      } catch (error) {
        console.error('[gallery] 策展写入失败', error)
        toast.error(error instanceof Error ? error.message : String(error))
      }
    },
    [activeID, refreshDetails]
  )

  /** 真正执行移入回收站（由确认对话框调用）。 */
  const trash = useCallback(
    async function (ids: string[]) {
      if (ids.length === 0) return
      try {
        const result = await useCatalogStore.getState().toTrash(ids)
        if (result.failed.length > 0) {
          toast.warning(`${result.failed.length} 项移动失败`)
        } else {
          toast.success(`已移入回收站 ${result.trashed} 项`)
        }
        useSelectionStore.getState().toClear()
        await refreshMeta()
      } catch (error) {
        console.error('[gallery] 移入回收站失败', error)
        toast.error(error instanceof Error ? error.message : String(error))
      }
    },
    [refreshMeta]
  )

  const runImport = useCallback(
    async function (mode: 'folders' | 'files') {
      if (isImporting) return
      try {
        const paths = await GET_MEDIA_PICK(mode, IMPORT_EXTENSIONS)
        if (paths.length === 0) return
        setIsImporting(true)
        setMessage(null)
        const result = await useCatalogStore.getState().toImportPaths(paths)
        if (result.imported === 0 && result.skipped === 0 && result.failed === 0) {
          toast.info('所选位置里没有可导入的媒体文件')
        } else if (result.failed > 0) {
          toast.warning(
            `导入 ${result.imported} 项，跳过 ${result.skipped} 项，失败 ${result.failed} 项`,
            { description: result.reasons.join('；') }
          )
        } else {
          toast.success(`导入 ${result.imported} 项，跳过 ${result.skipped} 项`)
        }
        await refreshMeta()
      } catch (error) {
        console.error('[gallery] 导入失败', error)
        toast.error(error instanceof Error ? error.message : String(error))
      } finally {
        setIsImporting(false)
        setProgress(null)
      }
    },
    [isImporting, refreshMeta]
  )

  const onImport = useCallback(
    function () {
      void runImport('folders')
    },
    [runImport]
  )

  const onImportFiles = useCallback(
    function () {
      void runImport('files')
    },
    [runImport]
  )

  const onCreateAlbum = useCallback(
    async function (name: string) {
      try {
        const ids = await POST_ALBUMS(name)
        if (ids[0]) useViewStore.getState().toSetAlbum(ids[0])
        await refreshMeta()
      } catch (error) {
        console.error('[gallery] 新建相簿失败', error)
        setMessage(error instanceof Error ? error.message : String(error))
      }
    },
    [refreshMeta]
  )

  const onRemoveAlbum = useCallback(
    async function (albumID: string) {
      try {
        await DELETE_ALBUMS(albumID)
        if (useViewStore.getState().activeAlbumID === albumID) {
          useViewStore.getState().toSetView('all')
        }
        await refreshMeta()
        toast.success('相簿已删除（照片未动）')
      } catch (error) {
        console.error('[gallery] 删除相簿失败', error)
        toast.error(error instanceof Error ? error.message : String(error))
      }
    },
    [refreshMeta]
  )

  const onRemoveSmartAlbum = useCallback(
    async function (smartAlbumID: string) {
      try {
        await DELETE_GALLERY_SMART_ALBUM(smartAlbumID)
        if (useViewStore.getState().activeSmartAlbumID === smartAlbumID) {
          useViewStore.getState().toSetView('all')
        }
        await refreshMeta()
        toast.success('智能相簿已删除')
      } catch (error) {
        console.error('[gallery] 删除智能相簿失败', error)
        toast.error(error instanceof Error ? error.message : String(error))
      }
    },
    [refreshMeta]
  )

  const onAddToAlbum = useCallback(
    async function (ids: string[], albumID: string) {
      try {
        await POST_GALLERY_ALBUM(ids, albumID)
        await useCatalogStore.getState().toRead()
        await refreshMeta()
        toast.success(`已加入相簿（${ids.length} 项）`)
      } catch (error) {
        console.error('[gallery] 加入相簿失败', error)
        toast.error(error instanceof Error ? error.message : String(error))
      }
    },
    [refreshMeta]
  )

  const onDetachFromAlbum = useCallback(
    async function (ids: string[], albumID: string) {
      if (ids.length === 0) return
      try {
        const removed = await DELETE_GALLERY_ALBUM(ids, albumID)
        await useCatalogStore.getState().toRead()
        await refreshMeta()
        toast.success(`已从相簿移出 ${removed} 项`)
      } catch (error) {
        console.error('[gallery] 移出相簿失败', error)
        toast.error(error instanceof Error ? error.message : String(error))
      }
    },
    [refreshMeta]
  )

  const onSaveSmart = useCallback(
    async function (name: string) {
      try {
        await POST_GALLERY_SMART_ALBUM({
          name,
          query: serializeFilter({ ...view.filter, searchIDs: null }),
          index: smartAlbums.length
        })
        await refreshMeta()
        toast.success(`已保存智能相簿「${name}」`)
      } catch (error) {
        console.error('[gallery] 保存智能相簿失败', error)
        toast.error(error instanceof Error ? error.message : String(error))
      }
    },
    [refreshMeta, smartAlbums.length, view.filter]
  )

  /** 字节级去重：按 size 分组合哈希，写入 dupGroup；「重复项」视图据此过滤。 */
  const runDedupe = useCallback(
    async function () {
      try {
        setProgress({ label: '扫描重复', done: 0, total: 1 })
        const result = await POST_GALLERY_DEDUPE()
        await toRead()
        await refreshMeta()
        toast.success(
          result.groups > 0
            ? `去重完成：${result.groups} 组 / ${result.duplicated} 个重复文件`
            : '没有发现字节级重复'
        )
      } catch (error) {
        console.warn('[gallery] 去重失败', error)
        toast.error(error instanceof Error ? error.message : String(error))
      } finally {
        setProgress(null)
      }
    },
    [toRead, refreshMeta]
  )

  const runPhash = useCallback(
    async function () {
      try {
        const written = await POST_GALLERY_PHASH()
        toast.success(`已计算 ${written} 张相似指纹`)
      } catch (error) {
        console.warn('[gallery] 相似指纹计算失败', error)
        toast.error(error instanceof Error ? error.message : String(error))
      }
    },
    []
  )

  const runRescan = useCallback(
    async function () {
      try {
        const result = await POST_GALLERY_RESCAN()
        await toRead()
        toast.success(`重扫完成：${result.missing} 项新增失效，${result.restored} 项已恢复`)
      } catch (error) {
        console.warn('[gallery] 重扫失败', error)
        toast.error(error instanceof Error ? error.message : String(error))
      }
    },
    [toRead]
  )

  /** 相似图：直接复用选择集展示结果，不另建视图（够用且不增加状态）。 */
  const onFindSimilar = useCallback(async function (id: string) {
    try {
      const rows = await GET_GALLERY_SIMILAR(id)
      const ids = rows.map(function (row) {
        return row.id
      })
      if (ids.length === 0) {
        toast.info('没有找到相似照片（先运行「相似指纹」）')
        return
      }
      useSelectionStore.getState().toSelectOnly(ids)
      toast.success(`找到 ${ids.length} 张相似照片（已选中）`)
    } catch (error) {
      console.warn('[gallery] 相似检索失败', error)
    }
  }, [])

  // 键盘总线：输入态与对话框内不生效
  useEffect(function () {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (document.querySelector('[role="dialog"]')) return
      // 灯箱/批量重命名开着时，图库快捷键让位（否则 Enter/Esc 会同时作用到两层）
      if (isLightboxOpen || isRenameOpen) return

      const selectionState = useSelectionStore.getState()
      const selectedIDs = [...selectionState.ids]

      // Ctrl/⌘ + K：聚焦搜索框（侧栏里提示的那个）
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if (event.key === 'Escape') {
        // 有选择就先退出选择模式，否则才清空焦点
        if (selectionState.isMode) selectionState.toToggleMode()
        else selectionState.toClear()
        return
      }
      if (event.key === 'Enter') {
        selectionState.toToggleMode()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        selectionState.toSelectAll(orderIDs)
        return
      }
      if (selectedIDs.length === 0) return

      if (event.key === 'Delete') {
        event.preventDefault()
        setConfirmAction({ kind: 'trash', ids: selectedIDs })
        return
      }

      if (/^[0-5]$/.test(event.key)) {
        void POST_GALLERY_CURATE(selectedIDs, { rating: Number(event.key) })
        return
      }
      if (event.key === '.') {
        const current = activeRow?.rating ?? 0
        void POST_GALLERY_CURATE(selectedIDs, { rating: Math.min(5, current + 1) })
        return
      }
      if (event.key === ',') {
        const current = activeRow?.rating ?? 0
        void POST_GALLERY_CURATE(selectedIDs, { rating: Math.max(0, current - 1) })
        return
      }
      if (event.key.toLowerCase() === 'x') {
        void POST_GALLERY_CURATE(selectedIDs, { flag: 'rejected' })
        return
      }
      if (event.key.toLowerCase() === 'p') {
        void POST_GALLERY_CURATE(selectedIDs, { flag: 'picked' })
        return
      }
      const colorMap: Record<string, 'red' | 'yellow' | 'green' | 'blue'> = {
        '6': 'red',
        '7': 'yellow',
        '8': 'green',
        '9': 'blue'
      }
      const color = colorMap[event.key]
      if (color) {
        void POST_GALLERY_CURATE(selectedIDs, { label: color })
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return function () {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [POST_GALLERY_CURATE, orderIDs, activeRow, isLightboxOpen, isRenameOpen])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
        <div className="relative w-56">
          <Icon
            icon="lucide:search"
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={searchRef}
            value={view.query}
            placeholder="搜索文件名 / 拼音 / 关键词"
            className="h-7 pl-7 text-xs"
            onChange={function (event) {
              view.toSetQuery(event.target.value)
            }}
          />
        </div>

        <Button
          size="sm"
          variant={isSelectionMode ? 'secondary' : 'ghost'}
          title="多选（Enter 切换，Esc 退出）"
          onClick={function () {
            useSelectionStore.getState().toToggleMode()
          }}
        >
          <Icon icon="lucide:check-square" className="size-3.5" />
          {isSelectionMode
            ? selectedIDs.size > 0
              ? `选择中 ${selectedIDs.size}`
              : '选择中'
            : '选择'}
        </Button>

        <div className="ml-auto flex items-center gap-1.5">
          <Select
            size="sm"
            value={view.sortKey}
            items={SORT_OPTIONS}
            onValueChange={function (value) {
              if (typeof value === 'string') view.toSetSort(value)
            }}
          >
            <SelectTrigger className="w-28" aria-label="排序">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map(function (option) {
                return (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <Select
            size="sm"
            value={view.sectionScope}
            items={SCOPE_OPTIONS}
            onValueChange={function (value) {
              if (value === 'month' || value === 'day') view.toSetSection(value)
            }}
          >
            <SelectTrigger className="w-24" aria-label="分组粒度">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCOPE_OPTIONS.map(function (option) {
                return (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              disabled={view.columnCount <= MIN_COLUMNS}
              onClick={function () {
                view.toSetColumns(view.columnCount - 1)
              }}
              title="减少列数"
            >
              <Icon icon="lucide:minus" className="size-3.5" />
            </Button>
            <span className="w-4 text-center text-xs tabular-nums text-muted-foreground">
              {view.columnCount}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              disabled={view.columnCount >= MAX_COLUMNS}
              onClick={function () {
                view.toSetColumns(view.columnCount + 1)
              }}
              title="增加列数"
            >
              <Icon icon="lucide:plus" className="size-3.5" />
            </Button>
          </div>

          <Button
            size="sm"
            variant={view.isStackFolded ? 'secondary' : 'ghost'}
            onClick={function () {
              view.toToggleStacks()
            }}
            title="RAW+JPEG / Live Photo 折叠成组"
          >
            <Icon icon="lucide:layers" className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant={view.isInspectorOpen ? 'secondary' : 'ghost'}
            onClick={function () {
              view.toToggleInspector()
            }}
            title="检查器"
          >
            <Icon icon="lucide:panel-right" className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={runDedupe}
            title="扫描重复（内容哈希）"
          >
            <Icon icon="lucide:copy-check" className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={runPhash}
            title="计算相似指纹（aHash）"
          >
            <Icon icon="lucide:fingerprint" className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={runRescan}
            title="重扫位置（标记失效 / 恢复）"
          >
            <Icon icon="lucide:refresh-ccw" className="size-3.5" />
          </Button>
          {selectedIDs.size > 0 ? (
            <Button size="sm" variant="outline" onClick={function () { setIsRenameOpen(true) }}>
              <Icon icon="lucide:text-cursor-input" className="size-3.5" />
              重命名
            </Button>
          ) : null}
          <Button size="sm" onClick={onImport} disabled={isImporting} title="导入文件夹（递归收集）">
            <Icon icon="lucide:folder-up" className="size-3.5" />
            导入
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={onImportFiles}
            disabled={isImporting}
            title="导入文件"
          >
            <Icon icon="lucide:file-plus-2" className="size-3.5" />
          </Button>
        </div>
      </div>

      <Splitter id="gallery-shell" orientation="horizontal" className="min-h-0 flex-1">
        {view.isSidebarOpen ? (
          <>
            <SplitterPane
              id="gallery-sidebar"
              defaultSize="18%"
              min="14%"
              max="30%"
              collapsible
              className="border-r border-border"
            >
              <Sidebar
                activeViewID={view.viewID}
                activeAlbumID={view.activeAlbumID}
                activeSmartAlbumID={view.activeSmartAlbumID}
                albums={albums}
                albumCounts={albumCounts}
                smartAlbums={smartAlbums}
                countByView={countByView}
                searchHint={SEARCH_HINT}
                onSelectView={function (viewID: GalleryViewID) {
                  view.toSetView(viewID)
                }}
                onSelectAlbum={function (albumID) {
                  view.toSetAlbum(albumID)
                }}
                onSelectSmartAlbum={function (smartAlbumID) {
                  view.toSetSmartAlbum(smartAlbumID)
                }}
                onCreateAlbum={onCreateAlbum}
                onRemoveAlbum={function (albumID) {
                  const album = albums.find(function (item) {
                    return item.id === albumID
                  })
                  setConfirmAction({ kind: 'album', id: albumID, name: album?.name ?? '' })
                }}
                onRemoveSmartAlbum={function (smartAlbumID) {
                  const album = smartAlbums.find(function (item) {
                    return item.id === smartAlbumID
                  })
                  setConfirmAction({ kind: 'smart', id: smartAlbumID, name: album?.name ?? '' })
                }}
              />
            </SplitterPane>
            <SplitterHandle withHandle />
          </>
        ) : null}

        <SplitterPane id="gallery-main" min={320}>
          <div className="flex h-full min-h-0 flex-col">
            <FilterBar
              facets={facets}
              filter={effectiveFilter}
              visibleCount={visibleRows.length}
              onPatch={function (patch) {
                view.toPatchFilter(patch)
              }}
              onReset={function () {
                view.toResetFilter()
              }}
              onSaveSmart={function () {
                setIsSmartPromptOpen(true)
              }}
            />

            {/* 批量操作：只在“选择模式且有选中”时出现，不与全局工具条抢位置 */}
            {isSelectionMode && selectedIDs.size > 0 ? (
              <SelectionBar
                count={selectedIDs.size}
                albums={albums}
                onRate={function (rating) {
                  void POST_GALLERY_CURATE([...selectedIDs], { rating })
                }}
                onLabel={function (label) {
                  void POST_GALLERY_CURATE([...selectedIDs], { label })
                }}
                onReject={function () {
                  void POST_GALLERY_CURATE([...selectedIDs], { flag: 'rejected' })
                }}
                onAddToAlbum={function (albumID) {
                  void onAddToAlbum([...selectedIDs], albumID)
                }}
                albumID={view.activeAlbumID}
                onDetachFromAlbum={function () {
                  if (view.activeAlbumID) void onDetachFromAlbum([...selectedIDs], view.activeAlbumID)
                }}
                onRename={function () {
                  setIsRenameOpen(true)
                }}
                onTrash={function () {
                  setConfirmAction({ kind: 'trash', ids: [...selectedIDs] })
                }}
                onSelectAll={function () {
                  useSelectionStore.getState().toSelectAll(orderIDs)
                }}
                onClear={function () {
                  useSelectionStore.getState().toToggleMode()
                }}
              />
            ) : null}

            <VirtualGrid
              sections={sections}
              columns={view.columnCount}
              selectedIDs={selectedIDs}
              activeID={activeID}
              isSelecting={isSelectionMode}
              isLoading={isCatalogLoading}
              emptyHint={
                VIEWS.find(function (item) {
                  return item.id === view.viewID
                })?.emptyHint ?? '没有内容'
              }
              emptyAction={
                catalogRows.length === 0 ? (
                  <Button
                    size="sm"
                    onClick={onImport}
                    disabled={isImporting}
                  >
                    <Icon icon="lucide:folder-up" className="size-3.5" />
                    导入文件夹
                  </Button>
                ) : !isFilterEmpty(effectiveFilter) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={function () {
                      view.toResetFilter()
                    }}
                  >
                    <Icon icon="lucide:filter-x" className="size-3.5" />
                    清除筛选
                  </Button>
                ) : undefined
              }
              onActivate={onActivate}
              onOpen={onOpen}
            />
            <StatusBar
              total={stats.total}
              visible={stats.visible}
              selected={selectedIDs.size}
              unrated={stats.unrated}
              probed={catalogProbed}
              isImporting={isImporting}
              progress={progress}
              message={message ?? catalogError}
            />
          </div>
        </SplitterPane>

        {view.isInspectorOpen ? (
          <>
            <SplitterHandle withHandle />
            <SplitterPane
              id="gallery-inspector"
              defaultSize="22%"
              min="18%"
              max="38%"
              collapsible
              className="border-l border-border"
            >
              <Inspector
                row={activeRow}
                details={details}
                albums={albums}
                selectedCount={selectedIDs.size}
                selectedIDs={[...selectedIDs]}
                onCurate={POST_GALLERY_CURATE}
                onAddToAlbum={onAddToAlbum}
                albumID={view.activeAlbumID}
                onDetachFromAlbum={onDetachFromAlbum}
                onTrash={function (ids) {
                  setConfirmAction({ kind: 'trash', ids })
                }}
                onFindSimilar={onFindSimilar}
                onOpen={onOpen}
              />
            </SplitterPane>
          </>
        ) : null}
      </Splitter>

      <MediaLightbox
        open={isLightboxOpen}
        medias={lightboxMedias}
        initialId={lightboxID}
        onOpenChange={function (open) {
          setIsLightboxOpen(open)
          if (!open) setLightboxID(null)
        }}
      />

      <BatchRenameDialog
        open={isRenameOpen}
        medias={renameMedias}
        onOpenChange={setIsRenameOpen}
        onApplied={function () {
          void toRead()
          void refreshMeta()
        }}
      />

      <PromptDialog
        open={isSmartPromptOpen}
        title="保存为智能相簿"
        description="把当前筛选条件存成一条规则，以后点一下就能回到这个视图。"
        placeholder="例如：2026 京都 · 4★"
        onOpenChange={setIsSmartPromptOpen}
        onSubmit={function (name) {
          void onSaveSmart(name)
        }}
      />

      <ConfirmDialog
        open={confirmAction !== null}
        title={
          confirmAction?.kind === 'trash'
            ? `移入回收站（${confirmAction.ids.length} 项）`
            : confirmAction?.kind === 'album'
              ? `删除相簿「${confirmAction.name}」`
              : `删除智能相簿「${confirmAction?.name ?? ''}」`
        }
        description={
          confirmAction?.kind === 'trash'
            ? '文件会离开原目录，可在应用的回收站目录里恢复；策展数据（星级/标签）一并移除。'
            : '只删除这条组织关系，照片本身不会被删除。'
        }
        confirmText={confirmAction?.kind === 'trash' ? '移入回收站' : '删除'}
        isDestructive
        onOpenChange={function (open) {
          if (!open) setConfirmAction(null)
        }}
        onConfirm={function () {
          if (!confirmAction) return
          if (confirmAction.kind === 'trash') void trash(confirmAction.ids)
          else if (confirmAction.kind === 'album') void onRemoveAlbum(confirmAction.id)
          else void onRemoveSmartAlbum(confirmAction.id)
        }}
      />
    </div>
  )
}

export { GalleryPage }
export default GalleryPage
