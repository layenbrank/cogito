import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { invoke } from '@tauri-apps/api/core'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { clsx } from 'clsx'
import { useState, type ReactNode } from 'react'

import { activateTile } from '@/features/magnetic-tile/activate'
import { CHANNELS } from '@/shared/ipc/channels'
import { useMirrorStore } from '@/stores/mirror'
import { SIDEBAR_OPEN, SIDEBAR_SHUT } from '@/views/overview/browser/bounds'
import { findFavicon, findHost } from '@/views/overview/browser/label'
import type { BrowserPanel, DownloadItem } from '@/views/overview/browser/types'
import type { Tab } from '@/views/navigation/session'

interface BrowserSidebarProps {
  isOpen: boolean
  tabs: Tab[]
  activeId: string
  searches: string[]
  downloads: DownloadItem[]
  extensions: string[]
  isExtensionSupported: boolean
  panel: BrowserPanel
  canDevtools: boolean
  onSelectTab: (tab: Tab) => void
  onCloseTab: (id: string) => void
  onMoveTab: (from: number, to: number) => void
  onCreateTab: () => void
  onOpenUrl: (url: string) => void
  onSearch: (query: string) => void
  onImportExtension: () => void
  onRemoveExtension: (name: string) => void
  onDevtools: () => void
}

function matches(query: string, text: string) {
  if (!query) return true
  return text.toLowerCase().includes(query)
}

const ROW =
  'group/row flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-sidebar-foreground outline-none transition-[background-color,color,box-shadow] duration-200 ease-out focus-visible:ring-2 focus-visible:ring-sidebar-ring/40 motion-reduce:transition-none'

const ROW_IDLE = 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'

const ROW_ON =
  'bg-sidebar-primary/25 font-medium text-sidebar-primary hover:bg-sidebar-primary/30'

const HEAD =
  'flex h-8 w-full items-center gap-1 rounded-md px-2 text-xs font-medium text-sidebar-foreground/60 transition-colors duration-200 hover:bg-sidebar-accent/80 hover:text-sidebar-foreground motion-reduce:transition-none'

const ENTER =
  'animate-in fade-in slide-in-from-left-1 fill-mode-both duration-200 motion-reduce:animate-none'

function Fold(props: { isOpen: boolean; children: ReactNode }) {
  return (
    <div
      className={clsx(
        'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
        props.isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      )}>
      <div className="min-h-0 overflow-hidden">{props.children}</div>
    </div>
  )
}

function SectionLabel(props: { isOpen: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={HEAD}
      aria-expanded={props.isOpen}
      onClick={props.onToggle}>
      <Icon
        icon="lucide:chevron-down"
        className={clsx(
          'size-3.5 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none',
          props.isOpen ? 'rotate-0' : '-rotate-90'
        )}
        aria-hidden
      />
      {props.label}
    </button>
  )
}

function SiteMark(props: { url: string; label: string }) {
  const [isFailed, setIsFailed] = useState(false)
  const src = props.url ? findFavicon(props.url) : ''
  if (!src || isFailed) {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-sidebar-accent text-[10px] font-medium uppercase shadow-[inset_0_0_0_1px_var(--sidebar-border)]">
        {(props.label || '?').slice(0, 1)}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      className="size-4 shrink-0 rounded-[4px] bg-background/80 shadow-[inset_0_0_0_1px_oklch(0_0_0/0.08)]"
      onError={function () {
        setIsFailed(true)
      }}
    />
  )
}

interface UrlRowProps {
  tab: Tab
  isOpen: boolean
  isActive: boolean
  label: string
  onSelect: () => void
  onClose: () => void
}

function UrlRow(props: UrlRowProps) {
  const sortable = useSortable({ id: props.tab.id })
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    zIndex: sortable.isDragging ? 2 : undefined
  }

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={clsx(ROW, ENTER, props.isActive ? ROW_ON : ROW_IDLE, sortable.isDragging && 'opacity-40')}>
      <button
        type="button"
        aria-label={props.label}
        aria-selected={props.isActive}
        title={props.label}
        className="flex min-h-9 min-w-0 flex-1 cursor-grab touch-none items-center gap-2 text-left active:cursor-grabbing"
        {...sortable.attributes}
        {...sortable.listeners}
        onClick={props.onSelect}>
        <SiteMark
          url={props.tab.url}
          label={props.label}
        />
        {props.isOpen ? <span className="truncate">{props.label}</span> : null}
      </button>
      {props.isOpen ? (
        <button
          type="button"
          aria-label="关闭标签"
          className={clsx(
            'flex size-5 shrink-0 items-center justify-center rounded-full transition-opacity duration-150',
            props.isActive
              ? 'opacity-70 hover:bg-foreground/10'
              : 'opacity-0 hover:bg-foreground/10 group-hover/row:opacity-100 focus-visible:opacity-100'
          )}
          onPointerDown={function (event) {
            event.stopPropagation()
          }}
          onClick={props.onClose}>
          <Icon
            icon="lucide:x"
            className="size-3.5"
            aria-hidden
          />
        </button>
      ) : null}
    </div>
  )
}

function BrowserSidebar(props: BrowserSidebarProps) {
  const [filter, setFilter] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    })
  )
  const [isTabsOpen, setIsTabsOpen] = useState(true)
  const [isSearchOpen, setIsSearchOpen] = useState(true)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [members, setMembers] = useState<Record<string, MagneticTile[]>>({})
  const tiles = useMirrorStore(function (state) {
    return state.magneticTiles
  })
  const query = filter.trim().toLowerCase()
  const collections = tiles.filter(function (tile) {
    return tile.component === 'collection'
  })

  async function toggleGroup(id: string) {
    const next = !openGroups[id]
    setOpenGroups(function (current) {
      return { ...current, [id]: next }
    })
    if (!next || members[id]) return
    try {
      const rows = await invoke<MagneticTile[]>(CHANNELS.MAGNETIC_TILE.READ, {
        params: { collectionID: id }
      })
      setMembers(function (current) {
        return {
          ...current,
          [id]: rows.toSorted(function (a, b) {
            return a.index - b.index
          })
        }
      })
    } catch (error) {
      console.error('[browser] 集合成员加载失败', error)
      setMembers(function (current) {
        return { ...current, [id]: [] }
      })
    }
  }

  function onUrlDragStart(event: DragStartEvent) {
    setDraggingId(String(event.active.id))
  }

  function onUrlDragEnd(event: DragEndEvent) {
    setDraggingId(null)
    const overId = event.over?.id
    if (!overId || overId === event.active.id) return
    const from = props.tabs.findIndex(function (tab) {
      return tab.id === event.active.id
    })
    const to = props.tabs.findIndex(function (tab) {
      return tab.id === overId
    })
    if (from < 0 || to < 0 || from === to) return
    props.onMoveTab(from, to)
  }

  function onUrlDragCancel() {
    setDraggingId(null)
  }

  function openMember(tile: MagneticTile) {
    if (tile.component === 'navigation') {
      props.onOpenUrl(tile.url ?? '')
      return
    }
    void activateTile({ component: tile.component, url: tile.url, id: tile.id })
  }

  const visibleTabs = props.tabs.filter(function (tab) {
    return matches(query, tab.title) || matches(query, tab.url)
  })
  const visibleSearches = props.searches.filter(function (item) {
    return matches(query, item)
  })
  const visibleCollections = collections.filter(function (group) {
    if (matches(query, group.title)) return true
    return (members[group.id] ?? []).some(function (member) {
      return matches(query, member.title) || matches(query, member.url ?? '')
    })
  })
  const isEmpty =
    query.length > 0 &&
    visibleTabs.length === 0 &&
    visibleSearches.length === 0 &&
    visibleCollections.length === 0
  const draggingTab = props.tabs.find(function (tab) {
    return tab.id === draggingId
  })
  const draggingLabel = draggingTab ? draggingTab.title || findHost(draggingTab.url) : ''

  return (
    <aside
      data-region="false"
      style={{ width: props.isOpen ? SIDEBAR_OPEN : SIDEBAR_SHUT }}
      className="flex shrink-0 flex-col self-stretch overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground contain-layout">
      <div className="min-h-0 flex-1 overflow-auto">
        {props.panel === 'sites' ? (
          <div className="flex flex-col gap-3 px-2 py-3">
            {props.isOpen ? (
              <Input
                value={filter}
                placeholder="搜索"
                aria-label="搜索侧栏"
                className="border-sidebar-border bg-sidebar-accent/70 shadow-none transition-[background-color,box-shadow] duration-200 focus-visible:bg-background"
                onChange={function (event) {
                  setFilter(event.target.value)
                }}
              />
            ) : null}
            <Button
              variant="outline"
              size={props.isOpen ? 'sm' : 'icon-sm'}
              className={clsx(
                'min-h-9 border-sidebar-border bg-sidebar text-sidebar-foreground shadow-none hover:bg-sidebar-accent',
                props.isOpen && 'justify-start'
              )}
              aria-label="新建标签"
              onClick={props.onCreateTab}>
              <Icon
                icon="lucide:plus"
                aria-hidden
              />
              {props.isOpen ? <span>新建标签</span> : null}
            </Button>
            {isEmpty ? (
              <p className="animate-in fade-in px-1 text-xs text-sidebar-foreground/55 duration-200">
                没有匹配项
              </p>
            ) : null}
            <section>
              {props.isOpen ? (
                <SectionLabel
                  isOpen={isTabsOpen}
                  label="网址"
                  onToggle={function () {
                    setIsTabsOpen(function (current) {
                      return !current
                    })
                  }}
                />
              ) : null}
              <Fold isOpen={!props.isOpen || isTabsOpen}>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                  onDragStart={onUrlDragStart}
                  onDragEnd={onUrlDragEnd}
                  onDragCancel={onUrlDragCancel}>
                  <SortableContext
                    items={visibleTabs.map(function (tab) {
                      return tab.id
                    })}
                    strategy={verticalListSortingStrategy}>
                    {visibleTabs.map(function (tab) {
                      const label = tab.title || findHost(tab.url)
                      return (
                        <UrlRow
                          key={tab.id}
                          tab={tab}
                          isOpen={props.isOpen}
                          isActive={tab.id === props.activeId}
                          label={label}
                          onSelect={function () {
                            props.onSelectTab(tab)
                          }}
                          onClose={function () {
                            props.onCloseTab(tab.id)
                          }}
                        />
                      )
                    })}
                  </SortableContext>
                  <DragOverlay>
                    {draggingTab ? (
                      <div className={clsx(ROW, ROW_ON, 'shadow-md')}>
                        <span className="flex min-h-9 min-w-0 flex-1 items-center gap-2">
                          <SiteMark
                            url={draggingTab.url}
                            label={draggingLabel}
                          />
                          {props.isOpen ? <span className="truncate">{draggingLabel}</span> : null}
                        </span>
                      </div>
                    ) : null}
                  </DragOverlay>
                </DndContext>
              </Fold>
            </section>
            <section>
              {props.isOpen ? (
                <SectionLabel
                  isOpen={isSearchOpen}
                  label="搜索"
                  onToggle={function () {
                    setIsSearchOpen(function (current) {
                      return !current
                    })
                  }}
                />
              ) : null}
              <Fold isOpen={!props.isOpen || isSearchOpen}>
                {visibleSearches.map(function (item) {
                  return (
                    <button
                      key={item}
                      type="button"
                      title={item}
                      aria-label={item}
                      className={clsx(ROW, ROW_IDLE, ENTER)}
                      onClick={function () {
                        props.onSearch(item)
                      }}>
                      <Icon
                        icon="lucide:search"
                        className="size-4 shrink-0 text-sidebar-foreground/45"
                        aria-hidden
                      />
                      {props.isOpen ? <span className="truncate">{item}</span> : null}
                    </button>
                  )
                })}
              </Fold>
            </section>
            {visibleCollections.map(function (group) {
              const isGroupOpen = Boolean(openGroups[group.id])
              const rows = (members[group.id] ?? []).filter(function (member) {
                return matches(query, group.title) || matches(query, member.title) || matches(query, member.url ?? '')
              })
              return (
                <section key={group.id}>
                  <button
                    type="button"
                    title={group.title}
                    aria-label={group.title}
                    aria-expanded={isGroupOpen}
                    className={clsx(ROW, ROW_IDLE, isGroupOpen && 'bg-sidebar-accent/70')}
                    onClick={function () {
                      void toggleGroup(group.id)
                    }}>
                    {props.isOpen ? (
                      <Icon
                        icon="lucide:chevron-down"
                        className={clsx(
                          'size-3.5 shrink-0 text-sidebar-foreground/45 transition-transform duration-200 ease-out motion-reduce:transition-none',
                          isGroupOpen ? 'rotate-0' : '-rotate-90'
                        )}
                        aria-hidden
                      />
                    ) : null}
                    <Icon
                      icon={isGroupOpen ? 'lucide:folder-open' : 'lucide:folder'}
                      className={clsx(
                        'size-4 shrink-0 transition-colors duration-200',
                        isGroupOpen ? 'text-sidebar-primary' : 'text-sidebar-foreground/70'
                      )}
                      aria-hidden
                    />
                    {props.isOpen ? <span className="truncate">{group.title}</span> : null}
                  </button>
                  <Fold isOpen={isGroupOpen}>
                    <div
                      className={clsx(
                        props.isOpen && 'relative ml-3 border-l border-sidebar-border/80 pl-1.5'
                      )}>
                      {rows.map(function (member) {
                        const label = member.title || findHost(member.url ?? '')
                        return (
                          <button
                            key={member.id}
                            type="button"
                            title={label}
                            aria-label={label}
                            className={clsx(ROW, ROW_IDLE, ENTER)}
                            onClick={function () {
                              openMember(member)
                            }}>
                            <SiteMark
                              url={member.url ?? ''}
                              label={label}
                            />
                            {props.isOpen ? <span className="truncate">{label}</span> : null}
                          </button>
                        )
                      })}
                    </div>
                  </Fold>
                </section>
              )
            })}
          </div>
        ) : null}
        {props.panel === 'downloads' ? (
          <div className="flex flex-col gap-1 px-2 py-3 text-sm">
            {props.downloads.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-2 py-10 text-center">
                <span className="flex size-10 items-center justify-center rounded-full bg-sidebar-accent text-sidebar-foreground/55">
                  <Icon
                    icon="lucide:download"
                    className="size-4"
                    aria-hidden
                  />
                </span>
                {props.isOpen ? <p className="text-sm text-sidebar-foreground/60">暂无下载</p> : null}
              </div>
            ) : (
              props.downloads.map(function (item) {
                const status = item.status === 'started' ? '下载中' : item.status === 'done' ? '完成' : '失败'
                return (
                  <div
                    key={item.id}
                    className={clsx(ROW, ROW_IDLE, ENTER, 'cursor-default')}
                    title={item.name}>
                    <Icon
                      icon="lucide:file"
                      className="size-4 shrink-0 text-sidebar-foreground/70"
                      aria-hidden
                    />
                    {props.isOpen ? (
                      <>
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                        <span
                          className={clsx(
                            'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                            item.status === 'done' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
                            item.status === 'started' && 'bg-sidebar-primary/15 text-sidebar-primary',
                            item.status !== 'done' &&
                              item.status !== 'started' &&
                              'bg-destructive/12 text-destructive'
                          )}>
                          {status}
                        </span>
                        {item.path ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={function () {
                              const path = item.path
                              if (path) void revealItemInDir(path)
                            }}>
                            显示
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                )
              })
            )}
          </div>
        ) : null}
        {props.panel === 'extensions' ? (
          <div className="flex flex-col gap-2 px-2 py-3 text-sm">
            {props.isOpen ? (
              <p className="px-2 text-xs leading-5 text-sidebar-foreground/55">
                {props.isExtensionSupported
                  ? '扩展放在应用数据目录 extensions。导入后会重新打开页面。'
                  : '当前系统不能加载 Chrome 扩展。'}
              </p>
            ) : null}
            <Button
              variant="outline"
              size={props.isOpen ? 'sm' : 'icon-sm'}
              className={clsx(
                'min-h-9 border-sidebar-border bg-sidebar text-sidebar-foreground shadow-none hover:bg-sidebar-accent',
                props.isOpen && 'w-full justify-start'
              )}
              aria-label="导入解压扩展"
              disabled={!props.isExtensionSupported}
              onClick={props.onImportExtension}>
              <Icon
                icon="lucide:folder-input"
                aria-hidden
              />
              {props.isOpen ? '导入解压扩展' : null}
            </Button>
            <Button
              variant="ghost"
              size={props.isOpen ? 'sm' : 'icon-sm'}
              className={clsx('min-h-9', props.isOpen && 'w-full justify-start')}
              aria-label="开发者工具"
              disabled={!props.canDevtools}
              onClick={props.onDevtools}>
              <Icon
                icon="lucide:bug"
                aria-hidden
              />
              {props.isOpen ? '开发者工具' : null}
            </Button>
            <ul className="flex flex-col gap-0.5">
              {props.extensions.map(function (name) {
                return (
                  <li
                    key={name}
                    className={clsx(ROW, ROW_IDLE, ENTER)}
                    title={name}>
                    <Icon
                      icon="lucide:puzzle"
                      className="size-4 shrink-0"
                      aria-hidden
                    />
                    {props.isOpen ? (
                      <>
                        <span className="min-w-0 flex-1 truncate">{name}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={function () {
                            props.onRemoveExtension(name)
                          }}>
                          移除
                        </Button>
                      </>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </aside>
  )
}

export { BrowserSidebar }
export type { BrowserSidebarProps }
