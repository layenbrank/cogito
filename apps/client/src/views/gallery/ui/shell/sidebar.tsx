import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Icon } from '@iconify/react'
import { useState, type ReactNode } from 'react'

import type { AlbumCountRow, GalleryRow, SmartAlbumRow } from '@/views/gallery/model/asset'
import { VIEWS, type GalleryViewID } from '@/views/gallery/model/views'

/**
 * 左侧栏：视图定义 + 相簿 + 智能相簿 + 系统分组。
 *
 * 视图是**纯数据**（`model/views.ts`），这里只负责渲染 —— 新增视图不改 UI 代码。
 */
interface AlbumModel {
  id: string
  name: string
}

interface SidebarProps {
  activeViewID: GalleryViewID
  activeAlbumID: string | null
  activeSmartAlbumID: string | null
  albums: AlbumModel[]
  albumCounts: AlbumCountRow[]
  smartAlbums: SmartAlbumRow[]
  countByView: Record<string, number>
  onSelectView: (viewID: GalleryViewID) => void
  onSelectAlbum: (albumID: string) => void
  onSelectSmartAlbum: (smartAlbumID: string) => void
  onCreateAlbum: (name: string) => void
  onRemoveAlbum: (albumID: string) => void
  onRemoveSmartAlbum: (smartAlbumID: string) => void
  /** 搜索快捷键文案（平台相关：⌘K / Ctrl+K） */
  searchHint: string
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {props.title}
      </div>
      {props.children}
    </div>
  )
}

function Row(props: {
  icon: string
  label: string
  count?: number
  active: boolean
  onClick: () => void
  onRemove?: () => void
}) {
  return (
    <div className="group flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className={[
          'h-7 min-w-0 flex-1 justify-start gap-2 px-2 text-sm font-normal',
          props.active ? 'bg-accent text-accent-foreground hover:bg-accent' : ''
        ].join(' ')}
        onClick={props.onClick}
      >
        <Icon icon={props.icon} className="size-4 shrink-0 opacity-70" />
        <span className="truncate">{props.label}</span>
        {props.count !== undefined ? (
          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
            {props.count}
          </span>
        ) : null}
      </Button>
      {props.onRemove ? (
        <Button
          variant="ghost"
          size="icon"
          title="删除相簿（照片不会被删除）"
          className="size-6 opacity-0 transition-opacity group-hover:opacity-70 hover:opacity-100"
          onClick={props.onRemove}
        >
          <Icon icon="lucide:x" className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )
}

function Sidebar(props: SidebarProps) {
  const [draft, setDraft] = useState('')
  const countsByAlbum = new Map<string, number>(
    props.albumCounts.map(function (row) {
      return [row.albumID, row.count]
    })
  )

  function submitAlbum(): void {
    const name = draft.trim()
    if (!name) return
    props.onCreateAlbum(name)
    setDraft('')
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-2 pt-2">
        <span className="text-sm font-semibold">图库</span>
        <span className="text-[11px] text-muted-foreground">{props.searchHint} 搜索</span>
      </div>

      <div className="mt-1 min-h-0 flex-1 overflow-y-auto pb-4">
        <Section title="浏览">
          {VIEWS.filter(function (view) {
            return view.group === 'library'
          }).map(function (view) {
            return (
              <Row
                key={view.id}
                icon={view.icon}
                label={view.label}
                count={props.countByView[view.id] ?? 0}
                active={props.activeViewID === view.id && !props.activeAlbumID && !props.activeSmartAlbumID}
                onClick={function () {
                  props.onSelectView(view.id)
                }}
              />
            )
          })}
        </Section>

        <Section title="智能">
          {VIEWS.filter(function (view) {
            return view.group === 'smart'
          }).map(function (view) {
            return (
              <Row
                key={view.id}
                icon={view.icon}
                label={view.label}
                count={props.countByView[view.id] ?? 0}
                active={props.activeViewID === view.id && !props.activeAlbumID && !props.activeSmartAlbumID}
                onClick={function () {
                  props.onSelectView(view.id)
                }}
              />
            )
          })}
          {props.smartAlbums.map(function (album) {
            return (
              <Row
                key={album.id}
                icon="lucide:sparkles"
                label={album.name}
                active={props.activeSmartAlbumID === album.id}
                onClick={function () {
                  props.onSelectSmartAlbum(album.id)
                }}
                onRemove={function () {
                  props.onRemoveSmartAlbum(album.id)
                }}
              />
            )
          })}
          {props.smartAlbums.length === 0 ? (
            <p className="px-2 py-1 text-[11px] leading-relaxed text-muted-foreground/70">
              在筛选条里点「保存为智能相簿」即可存下当前筛选
            </p>
          ) : null}
        </Section>

        <Section title="相簿">
          {props.albums.map(function (album) {
            return (
              <Row
                key={album.id}
                icon="lucide:folder"
                label={album.name}
                count={countsByAlbum.get(album.id) ?? 0}
                active={props.activeAlbumID === album.id}
                onClick={function () {
                  props.onSelectAlbum(album.id)
                }}
                onRemove={function () {
                  props.onRemoveAlbum(album.id)
                }}
              />
            )
          })}
          <div className="mt-1 flex items-center gap-1 px-1">
            <Input
              value={draft}
              placeholder="新建相簿"
              className="h-7 text-xs"
              onChange={function (event) {
                setDraft(event.target.value)
              }}
              onKeyDown={function (event) {
                if (event.key === 'Enter') submitAlbum()
              }}
            />
            <Button size="icon" variant="ghost" className="size-7" onClick={submitAlbum} title="新建相簿">
              <Icon icon="lucide:plus" className="size-4" />
            </Button>
          </div>
        </Section>

        <Section title="系统">
          {VIEWS.filter(function (view) {
            return view.group === 'system'
          }).map(function (view) {
            return (
              <Row
                key={view.id}
                icon={view.icon}
                label={view.label}
                count={props.countByView[view.id] ?? 0}
                active={props.activeViewID === view.id && !props.activeAlbumID && !props.activeSmartAlbumID}
                onClick={function () {
                  props.onSelectView(view.id)
                }}
              />
            )
          })}
        </Section>
      </div>
    </div>
  )
}

/** 侧栏用到的行类型（避免与 catalog 的 `GalleryRow` 混淆）。 */
type SidebarRow = GalleryRow

export { Sidebar }
export type { AlbumModel, SidebarProps, SidebarRow }
