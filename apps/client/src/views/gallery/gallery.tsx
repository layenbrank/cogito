import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { cn } from 'cn'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Decorations } from '@/components/decorations/index.ts'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { useGalleryStore } from '@/stores/gallery'
import { Collections } from '@/views/gallery/collections/collections'
import { GALLERY_TABS, MOTION_MS, type GalleryTab } from '@/views/gallery/constraints'
import { useGalleryAssets } from '@/views/gallery/hooks/use-gallery-assets'
import { useGallerySearch } from '@/views/gallery/hooks/use-gallery-search'
import { MAX_FOLDER_FILES } from '@/views/gallery/import-media'
import { Library } from '@/views/gallery/library/library'
import { Lightbox } from '@/views/gallery/lightbox/lightbox'
import type { GalleryMedia } from '@/views/gallery/model/media'
import { UnlockDialog } from '@/views/gallery/vault/unlock-dialog'
import { VaultReveal } from '@/views/gallery/vault/vault-reveal'

type CollectionLeaf = 'root' | 'recents' | 'photos' | 'videos' | 'screenshots' | 'hidden'

/** 精选集各叶子的标题；「图库」标签页不管进到哪一级都叫图库 */
const LEAF_TITLES: Record<CollectionLeaf, string> = {
  root: '图库',
  recents: '最近项目',
  photos: '照片',
  videos: '视频',
  screenshots: '截屏',
  hidden: '已隐藏'
}

/** 精选集为空时的引导文案；图库标签页忽略（那里由 Library 自己兜底） */
const EMPTY_HINTS: Partial<Record<CollectionLeaf, string>> = {
  recents: '还没有媒体',
  photos: '还没有照片',
  videos: '还没有视频',
  screenshots: '还没有截屏',
  hidden: '没有已隐藏的媒体'
}

function findLibraryTitle(tab: GalleryTab, leaf: CollectionLeaf): string {
  if (tab === 'library') return '图库'
  return LEAF_TITLES[leaf]
}

function findEmptyHint(tab: GalleryTab, leaf: CollectionLeaf): string | undefined {
  if (tab !== 'collections') return undefined
  return EMPTY_HINTS[leaf]
}

/** 底部页签 + 搜索按钮 */
function GalleryBottomBar(props: {
  tab: GalleryTab
  canSearch: boolean
  onSwitchTab: (tab: GalleryTab) => void
  onToggleSearch: () => void
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex items-end justify-center gap-2 px-4">
      <div className="pointer-events-auto flex h-10 items-center gap-1 rounded-full border border-border/50 bg-card/90 p-1 shadow-lg backdrop-blur-md">
        {GALLERY_TABS.map(function (item) {
          const isActive = props.tab === item
          const label = item === 'library' ? '图库' : '精选集'
          const icon = item === 'library' ? 'lucide:images' : 'lucide:layers'
          return (
            <button
              key={item}
              type="button"
              className={cn(
                'flex h-full items-center gap-1.5 rounded-full px-3.5 text-sm transition-colors',
                isActive
                  ? 'bg-primary/15 text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={function () {
                props.onSwitchTab(item)
              }}>
              <Icon
                icon={icon}
                className="size-4"
              />
              {label}
            </button>
          )
        })}
      </div>
      <Button
        type="button"
        size="icon"
        className="pointer-events-auto size-10 rounded-full shadow-lg"
        aria-label="搜索"
        disabled={!props.canSearch}
        onClick={props.onToggleSearch}>
        <Icon icon="lucide:search" />
      </Button>
    </div>
  )
}

/**
 * 搜索浮条。
 *
 * 失焦即收：`relatedTarget` 还在面板内就不收；容器内没有按钮可聚焦时（比如点到面板空白）
 * 靠一次微任务延迟再看 `activeElement`，避免点面板内其它元素时误收。
 */
function GallerySearchPanel(props: {
  query: string
  onChangeQuery: (query: string) => void
  onClose: () => void
  isReducedMotion: boolean | null
  motionSec: number
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  return (
    <m.div
      ref={panelRef}
      className="absolute inset-x-4 bottom-20 z-30 flex items-center gap-2 rounded-2xl border border-border/60 bg-card/95 p-2 shadow-lg backdrop-blur-md"
      initial={props.isReducedMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={props.isReducedMotion ? undefined : { opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: props.motionSec, ease: [0.22, 1, 0.36, 1] }}
      onBlur={function (event) {
        const next = event.relatedTarget as Node | null
        if (panelRef.current?.contains(next)) return
        window.setTimeout(function () {
          if (!panelRef.current?.contains(document.activeElement)) props.onClose()
        }, 0)
      }}>
      <Icon
        icon="lucide:search"
        className="ml-2 size-4 text-muted-foreground"
      />
      <Input
        autoFocus
        value={props.query}
        placeholder="搜索文件名"
        className="border-0 bg-transparent shadow-none focus-visible:ring-0"
        onChange={function (event) {
          props.onChangeQuery(event.target.value)
        }}
        onKeyDown={function (event) {
          if (event.key === 'Escape') props.onClose()
        }}
      />
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="关闭搜索"
        onMouseDown={function (event) {
          event.preventDefault()
        }}
        onClick={props.onClose}>
        <Icon icon="lucide:x" />
      </Button>
    </m.div>
  )
}

function Gallery() {
  const {
    visible,
    photos,
    videos,
    screenshots,
    hidden,
    loaded,
    importing,
    toImportMedias,
    toHideMedias,
    toRemoveMedias
  } = useGalleryAssets()

  const vaultUnlocked = useGalleryStore(function (state) {
    return state.vaultUnlocked
  })
  const hasPin = useGalleryStore(function (state) {
    return state.hasPin
  })
  const toUnlockVault = useGalleryStore(function (state) {
    return state.toUnlockVault
  })
  const toSetupPin = useGalleryStore(function (state) {
    return state.toSetupPin
  })
  const toRefreshVault = useGalleryStore(function (state) {
    return state.toRefreshVault
  })
  const toLockVault = useGalleryStore(function (state) {
    return state.toLockVault
  })

  const [tab, onTab] = useState<GalleryTab>('library')
  const [leaf, onLeaf] = useState<CollectionLeaf>('root')
  const [query, onQuery] = useState('')
  const [isSearchOpen, onSearchOpen] = useState(false)
  const [selecting, onSelecting] = useState(false)
  const [selectedIds, onSelectedIds] = useState<Set<string>>(function () {
    return new Set()
  })
  const [lightboxId, onLightboxId] = useState<string | null>(null)
  const [isLightboxOpen, onLightboxOpen] = useState(false)
  const [isUnlockOpen, onUnlockOpen] = useState(false)
  const [pendingHidden, onPendingHidden] = useState(false)
  const [isVaultReveal, onVaultReveal] = useState(false)
  const revealAfterUnlockRef = useRef(false)
  const isReducedMotion = useReducedMotion()
  const motionSec = MOTION_MS / 1000

  useEffect(
    function () {
      void toRefreshVault()
      return function () {
        toLockVault()
      }
    },
    [toRefreshVault, toLockVault]
  )

  const activeMedias = useMemo(
    function () {
      if (leaf === 'photos' && tab === 'collections') return photos
      if (leaf === 'videos' && tab === 'collections') return videos
      if (leaf === 'screenshots' && tab === 'collections') return screenshots
      if (leaf === 'hidden' && tab === 'collections') return vaultUnlocked ? hidden : []
      return visible
    },
    [tab, leaf, visible, photos, videos, screenshots, hidden, vaultUnlocked]
  )

  const searched = useGallerySearch(activeMedias, isSearchOpen ? query : '')
  const showCollectionsRoot = tab === 'collections' && leaf === 'root'
  const showLibrary = !showCollectionsRoot

  function clearSelection() {
    onSelectedIds(new Set())
  }

  function closeSearch() {
    onSearchOpen(false)
    onQuery('')
  }

  function switchTab(next: GalleryTab) {
    onTab(next)
    onLeaf('root')
    clearSelection()
    onSelecting(false)
  }

  function toggleSelect(media: GalleryMedia) {
    onSelectedIds(function (prev) {
      const next = new Set(prev)
      if (next.has(media.asset.id)) next.delete(media.asset.id)
      else next.add(media.asset.id)
      return next
    })
  }

  function openMedia(media: GalleryMedia) {
    onLightboxId(media.asset.id)
    onLightboxOpen(true)
  }

  async function handleImport(mode: 'files' | 'folders') {
    try {
      const ids = await toImportMedias(mode)
      if (ids.length > 0) {
        toast.success(`已导入 ${ids.length} 项`)
        if (mode === 'folders' && ids.length >= MAX_FOLDER_FILES) {
          toast.message(`已达单次文件夹导入上限（${MAX_FOLDER_FILES}），可分批再导`)
        }
      } else if (mode === 'folders') {
        toast.message('文件夹中未找到图片或视频')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入失败')
    }
  }

  async function handleHideSelected() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    const shouldHide = !(tab === 'collections' && leaf === 'hidden')
    await toHideMedias(ids, shouldHide)
    clearSelection()
    onSelecting(false)
    toast.success(shouldHide ? `已隐藏 ${ids.length} 项` : `已取消隐藏 ${ids.length} 项`)
  }

  async function handleRemoveSelected() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    await toRemoveMedias(ids)
    clearSelection()
    onSelecting(false)
    toast.success(`已删除 ${ids.length} 项`)
  }

  function openHidden() {
    if (vaultUnlocked) {
      onLeaf('hidden')
      return
    }
    onPendingHidden(true)
    onUnlockOpen(true)
  }

  async function handleUnlock(pin: string) {
    const result = hasPin ? await toUnlockVault(pin) : await toSetupPin(pin)
    if (result.ok && pendingHidden) {
      revealAfterUnlockRef.current = true
      onVaultReveal(true)
    }
    return result
  }

  function finishVaultReveal() {
    revealAfterUnlockRef.current = false
    onVaultReveal(false)
    onLeaf('hidden')
    onPendingHidden(false)
  }

  return (
    <Decorations
      summary={findComponentLabel('gallery')}
      scrollable={false}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {!loaded ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            加载中…
          </div>
        ) : showCollectionsRoot ? (
          <Collections
            recents={visible}
            photos={photos}
            videos={videos}
            screenshots={screenshots}
            hidden={hidden}
            vaultUnlocked={vaultUnlocked}
            onOpenRecents={function () {
              onLeaf('recents')
            }}
            onOpenPhotos={function () {
              onLeaf('photos')
            }}
            onOpenVideos={function () {
              onLeaf('videos')
            }}
            onOpenScreenshots={function () {
              onLeaf('screenshots')
            }}
            onOpenHidden={openHidden}
          />
        ) : (
          <Library
            title={findLibraryTitle(tab, leaf)}
            medias={searched}
            selecting={selecting}
            selectedIds={selectedIds}
            importing={importing}
            emptyHint={findEmptyHint(tab, leaf)}
            onSelectingChange={onSelecting}
            onToggleSelect={toggleSelect}
            onClearSelection={clearSelection}
            onOpen={openMedia}
            onImport={function (mode) {
              void handleImport(mode)
            }}
            hideLabel={tab === 'collections' && leaf === 'hidden' ? '取消隐藏' : '隐藏'}
            onHideSelected={function () {
              void handleHideSelected()
            }}
            onRemoveSelected={function () {
              void handleRemoveSelected()
            }}
          />
        )}

        {tab === 'collections' && leaf !== 'root' ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="absolute top-3 left-4 z-20"
            onClick={function () {
              onLeaf('root')
              clearSelection()
              onSelecting(false)
            }}>
            <Icon icon="lucide:chevron-left" />
            精选集
          </Button>
        ) : null}

        <AnimatePresence>
          {isSearchOpen ? (
            <GallerySearchPanel
              query={query}
              onChangeQuery={onQuery}
              onClose={closeSearch}
              isReducedMotion={isReducedMotion}
              motionSec={motionSec}
            />
          ) : null}
        </AnimatePresence>

        <GalleryBottomBar
          tab={tab}
          canSearch={showLibrary}
          onSwitchTab={switchTab}
          onToggleSearch={function () {
            onSearchOpen(function (value) {
              return !value
            })
          }}
        />

        <VaultReveal
          active={isVaultReveal}
          onDone={finishVaultReveal}
        />
      </div>

      <Lightbox
        open={isLightboxOpen}
        medias={searched}
        initialId={lightboxId}
        onOpenChange={onLightboxOpen}
      />
      <UnlockDialog
        open={isUnlockOpen}
        hasPin={hasPin}
        onOpenChange={function (open) {
          onUnlockOpen(open)
          if (!open && !revealAfterUnlockRef.current) onPendingHidden(false)
        }}
        onSubmit={handleUnlock}
      />
    </Decorations>
  )
}

export default Gallery
