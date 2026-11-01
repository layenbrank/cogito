import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { cn } from 'cn'
import { useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { useShellSurface } from '@/features/window-shell/slots'
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

const SEARCH_CLOSED_W = '2.5rem'
const SEARCH_OPEN_W = 'min(20rem, calc(100vw - 6rem))'
const SEARCH_EASE = [0.22, 1, 0.36, 1] as const

/**
 * 底栏搜索：收起为圆钮，展开时同层横向拉宽（overflow 裁切），不另起浮条。
 * 失焦即收：`relatedTarget` 仍在 surface 内则不收；点到空白后再看 `activeElement`。
 */
function GallerySearchControl(props: {
  canSearch: boolean
  isOpen: boolean
  query: string
  onOpen: () => void
  onChangeQuery: (query: string) => void
  onClose: () => void
  isReducedMotion: boolean | null
  motionSec: number
}) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  /** 收起时先缩宽再卸字段，避免内容瞬间消失 */
  const [showsField, onShowsField] = useState(props.isOpen)

  useEffect(
    function () {
      if (props.isOpen) {
        onShowsField(true)
        return
      }
      if (props.isReducedMotion) {
        onShowsField(false)
        return
      }
      const timer = window.setTimeout(
        function () {
          onShowsField(false)
        },
        Math.round(props.motionSec * 1000)
      )
      return function () {
        window.clearTimeout(timer)
      }
    },
    [props.isOpen, props.isReducedMotion, props.motionSec]
  )

  return (
    <m.div
      ref={surfaceRef}
      className={cn(
        'pointer-events-auto flex h-10 items-center overflow-hidden rounded-full shadow-lg transition-colors',
        showsField
          ? 'border border-border/50 bg-card/90 text-foreground backdrop-blur-md'
          : 'bg-primary text-primary-foreground'
      )}
      initial={false}
      animate={{ width: props.isOpen ? SEARCH_OPEN_W : SEARCH_CLOSED_W }}
      transition={{
        duration: props.isReducedMotion ? 0 : props.motionSec,
        ease: SEARCH_EASE
      }}
      onBlur={function (event) {
        if (!props.isOpen) return
        const next = event.relatedTarget as Node | null
        if (surfaceRef.current?.contains(next)) return
        window.setTimeout(function () {
          if (!surfaceRef.current?.contains(document.activeElement)) props.onClose()
        }, 0)
      }}>
      {showsField ? (
        <div
          className={cn(
            'flex h-full shrink-0 items-center transition-opacity ease-out',
            props.isOpen ? 'opacity-100' : 'opacity-0'
          )}
          style={{
            width: SEARCH_OPEN_W,
            transitionDuration: props.isReducedMotion
              ? '0ms'
              : `${Math.round(props.motionSec * 600)}ms`
          }}>
          <Icon
            icon="lucide:search"
            className="ml-3 size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <Input
            autoFocus
            value={props.query}
            placeholder="搜索文件名"
            aria-label="搜索文件名"
            className="h-full min-w-0 flex-1 border-0 bg-transparent px-2 shadow-none focus-visible:ring-0"
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
            className="mr-1 shrink-0"
            aria-label="关闭搜索"
            onMouseDown={function (event) {
              event.preventDefault()
            }}
            onClick={props.onClose}>
            <Icon icon="lucide:x" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="icon"
          className="size-10 rounded-full bg-transparent text-primary-foreground shadow-none hover:bg-primary/90"
          aria-label="搜索"
          disabled={!props.canSearch}
          onClick={props.onOpen}>
          <Icon icon="lucide:search" />
        </Button>
      )}
    </m.div>
  )
}

/** 底部页签 + 可横向展开的搜索 */
function GalleryBottomBar(props: {
  tab: GalleryTab
  canSearch: boolean
  isSearchOpen: boolean
  query: string
  onSwitchTab: (tab: GalleryTab) => void
  onOpenSearch: () => void
  onChangeQuery: (query: string) => void
  onCloseSearch: () => void
  isReducedMotion: boolean | null
  motionSec: number
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex items-end justify-center gap-2 px-4">
      <div className="pointer-events-auto flex h-10 items-center gap-1 rounded-full border border-border/50 bg-card/90 p-1 shadow-lg backdrop-blur-md">
        {GALLERY_TABS.map(function (item) {
          const isActive = props.tab === item
          const label = item === 'library' ? '图库' : '精选集'
          const icon = item === 'library' ? 'lucide:images' : 'lucide:layers'
          return (
            <Button
              key={item}
              type="button"
              variant="ghost"
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
            </Button>
          )
        })}
      </div>
      <GallerySearchControl
        canSearch={props.canSearch}
        isOpen={props.isSearchOpen}
        query={props.query}
        onOpen={props.onOpenSearch}
        onChangeQuery={props.onChangeQuery}
        onClose={props.onCloseSearch}
        isReducedMotion={props.isReducedMotion}
        motionSec={props.motionSec}
      />
    </div>
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

  useShellSurface({
    summary: findComponentLabel('gallery'),
    scrollable: false
  })

  return (
    <>
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

        <GalleryBottomBar
          tab={tab}
          canSearch={showLibrary}
          isSearchOpen={isSearchOpen}
          query={query}
          onSwitchTab={switchTab}
          onOpenSearch={function () {
            onSearchOpen(true)
          }}
          onChangeQuery={onQuery}
          onCloseSearch={closeSearch}
          isReducedMotion={isReducedMotion}
          motionSec={motionSec}
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
    </>
  )
}

export default Gallery
