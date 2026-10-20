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
import { getCurrentWindow } from '@tauri-apps/api/window'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { clsx } from 'clsx'
import { useState, type MouseEvent, type ReactNode } from 'react'

import { useCaptionState } from '@/components/caption/caption'
import { CHANNELS } from '@/shared/ipc/channels'
import { useMirrorStore } from '@/stores/mirror'
import { BROWSER_BAR } from '@/features/browser-bar/metrics'
import { SIDEBAR_OPEN, SIDEBAR_SHUT } from '@/views/browser/bounds'
import { findFavicon, findHost } from '@/views/browser/label'
import type { BrowserNotice, BrowserPanel, DownloadItem } from '@/views/browser/types'
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
  onToggleSidebar: () => void
  onOpenUrl: (url: string) => void
  activeMemberId: string
  lives: Record<string, PageLife>
  /** 侧栏内联提示：操作结果就在做事的那个面板里显示，不进内容槽。 */
  notice: BrowserNotice | null
  onOpenMember: (tile: MagneticTile) => void
  onCloseMember: (id: string) => void
  onSearch: (query: string) => void
  onRemoveSearch: (query: string) => void
  onImportExtension: () => void
  onRemoveExtension: (name: string) => void
  onDevtools: () => void
}

function matches(query: string, text: string) {
  if (!query) return true
  return text.toLowerCase().includes(query)
}

const ROW =
  'group/row flex items-center gap-2 rounded-lg text-left text-sm text-sidebar-foreground outline-none transition-[background-color,color,box-shadow] duration-200 ease-out focus-visible:ring-2 focus-visible:ring-sidebar-ring/40 motion-reduce:transition-none'

/** 收缩行与顶栏按钮同为 40×40，避免折叠后图标高低不齐。 */
const SHUT_ROW =
  'mx-auto size-10 max-h-10 max-w-10 shrink-0 justify-center self-center p-0'

/** 折叠后每一枚图标使用同一段间距，组与组之间不再另加空白。 */
const SHUT_STACK = 'flex flex-col items-center gap-2'

/** 展开后行距与组距同一段，和折叠态的 8px 对齐。 */
const OPEN_STACK = 'flex flex-col gap-2'

/** 站点标记固定 16×16，避免收缩行把图标压成非正方形。 */
const MARK_BOX =
  'size-4 aspect-square h-4 w-4 min-h-4 min-w-4 max-h-4 max-w-4 shrink-0 self-center overflow-hidden object-cover'

/** 子 WebView 还在，但这一次导航还没有结果。 */
type PageLife = 'wait' | 'ok' | 'fail'

/** `shut` 表示没有对应的子 WebView。 */
type PageMark = PageLife | 'shut'

const LIFE_LABEL: Record<PageMark, string> = {
  ok: '已打开',
  fail: '加载失败',
  wait: '正在加载',
  shut: '未打开'
}

const LIFE_TONE: Record<PageMark, string> = {
  ok: 'bg-success',
  fail: 'bg-destructive',
  wait: 'animate-pulse bg-muted-foreground/70',
  shut: 'bg-muted-foreground/55'
}

function findPageMark(lives: Record<string, PageLife>, id: string): PageMark {
  return lives[id] ?? 'shut'
}

function lifeLabel(mark: PageMark) {
  return LIFE_LABEL[mark]
}

function rowName(label: string, mark: PageMark | null) {
  if (!mark) return label
  return `${label}，${lifeLabel(mark)}`
}

/** 约 6px。收缩时绝对定位，避免把 36×36 的行撑成横条。 */
function LifeDot(props: { mark: PageMark; isOpen: boolean }) {
  const label = lifeLabel(props.mark)
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={clsx(
        'pointer-events-none size-1.5 shrink-0 rounded-full',
        LIFE_TONE[props.mark],
        props.isOpen ? 'self-center' : 'absolute right-0.5 bottom-0.5'
      )}
    />
  )
}

function rowClass(isOpen: boolean) {
  return clsx(ROW, isOpen ? 'min-h-9 w-full px-2' : SHUT_ROW)
}

function hitClass(isOpen: boolean) {
  if (isOpen) return 'min-h-9 min-w-0 flex-1 gap-2'
  return 'size-full max-h-full max-w-full justify-center p-0'
}

const ROW_IDLE = 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'

const ROW_ON = 'bg-sidebar-primary/25 font-medium text-sidebar-primary hover:bg-sidebar-primary/30'

const HEAD =
  'flex h-8 w-full items-center gap-1 rounded-md px-2 text-xs font-medium text-sidebar-foreground/60 transition-colors duration-200 hover:bg-sidebar-accent/80 hover:text-sidebar-foreground motion-reduce:transition-none'

const ENTER =
  'animate-in fade-in slide-in-from-left-1 fill-mode-both duration-200 motion-reduce:animate-none'

const RAIL =
  'size-10 min-w-10 rounded-full text-sidebar-foreground hover:bg-sidebar-accent [&_svg]:size-4.5'

function SidebarHead(props: { isOpen: boolean; onToggle: () => void; onCreate: () => void }) {
  const { state, refresh } = useCaptionState()

  function onDoubleClick(event: MouseEvent<HTMLElement>) {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest('[data-region="false"]')) return
    if (!state.isMaximizable && !state.isFullscreen) return
    const win = getCurrentWindow()
    if (state.isFullscreen) {
      void win.setFullscreen(false).then(refresh)
      return
    }
    void win.toggleMaximize().then(refresh)
  }

  return (
    <header
      data-region="true"
      data-focused={state.isFocused ? 'true' : 'false'}
      onDoubleClick={onDoubleClick}
      className={clsx(
        'flex shrink-0 border-b border-sidebar-border select-none',
        !state.isFocused && 'opacity-80',
        props.isOpen ? 'items-center gap-0.5 px-1.5' : 'items-center justify-center'
      )}
      style={{ height: BROWSER_BAR, minHeight: BROWSER_BAR }}>
      <Button
        variant="ghost"
        size="icon"
        data-region="false"
        className={RAIL}
        aria-label={props.isOpen ? '收起侧栏' : '展开侧栏'}
        onClick={props.onToggle}>
        <Icon
          icon="lucide:panel-left"
          aria-hidden
        />
      </Button>
      {props.isOpen ? (
        <Button
          variant="ghost"
          size="icon"
          data-region="false"
          className={RAIL}
          aria-label="新建标签"
          onClick={props.onCreate}>
          <Icon
            icon="lucide:plus"
            aria-hidden
          />
        </Button>
      ) : null}
    </header>
  )
}

function Fold(props: { isOpen: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
        props.isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      )}>
      <div className={clsx('min-h-0 overflow-hidden', props.className)}>{props.children}</div>
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
      <span
        className={clsx(
          MARK_BOX,
          'flex items-center justify-center rounded-[4px] bg-sidebar-accent text-[10px] font-medium uppercase leading-none shadow-[inset_0_0_0_1px_var(--sidebar-border)]'
        )}>
        {(props.label || '?').slice(0, 1)}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      width={16}
      height={16}
      className={clsx(
        MARK_BOX,
        'rounded-[4px] bg-background/80 shadow-[inset_0_0_0_1px_oklch(0_0_0/0.08)]'
      )}
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
  lives: Record<string, PageLife>
  label: string
  onSelect: () => void
  onClose: () => void
}

function UrlRow(props: UrlRowProps) {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: props.tab.id
  })
  const mark = props.tab.url ? findPageMark(props.lives, props.tab.id) : null
  const name = rowName(props.label, mark)
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2 : undefined
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        rowClass(props.isOpen),
        ENTER,
        props.isActive ? ROW_ON : ROW_IDLE,
        isDragging && 'opacity-40'
      )}>
      <button
        type="button"
        aria-label={name}
        aria-selected={props.isActive}
        title={name}
        className={clsx(
          'flex cursor-grab touch-none items-center text-left active:cursor-grabbing',
          hitClass(props.isOpen),
          !props.isOpen && mark && 'relative'
        )}
        {...attributes}
        {...listeners}
        onClick={props.onSelect}>
        <SiteMark
          url={props.tab.url}
          label={props.label}
        />
        {mark ? (
          <LifeDot
            mark={mark}
            isOpen={props.isOpen}
          />
        ) : null}
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

  const visibleTabs = props.tabs.filter(function (tab) {
    return matches(query, tab.title) || matches(query, tab.url)
  })
  const visibleSearches = props.searches.filter(function (item) {
    return matches(query, item)
  })
  const visibleCollections = collections.filter(function (group) {
    if (matches(query, group.title)) return true
    return (members[group.id] ?? []).some(function (member) {
      return Boolean(member.url) && (matches(query, member.title) || matches(query, member.url ?? ''))
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
      style={{ width: props.isOpen ? SIDEBAR_OPEN : SIDEBAR_SHUT }}
      className="flex shrink-0 flex-col self-stretch overflow-hidden border-r border-border bg-background text-foreground contain-layout">
      <SidebarHead
        isOpen={props.isOpen}
        onToggle={props.onToggleSidebar}
        onCreate={props.onCreateTab}
      />
      <div
        data-region="false"
        className="min-h-0 flex-1 overflow-auto">
        {props.panel === 'sites' ? (
          <div
            className={clsx(
              'flex flex-col',
              props.isOpen ? clsx(OPEN_STACK, 'px-2 py-2') : clsx(SHUT_STACK, 'px-1 py-2')
            )}>
            {props.isOpen ? null : (
              <Button
                variant="ghost"
                size="icon"
                className={RAIL}
                aria-label="新建标签"
                onClick={props.onCreateTab}>
                <Icon
                  icon="lucide:plus"
                  aria-hidden
                />
              </Button>
            )}
            {props.isOpen ? (
              <Input
                value={filter}
                placeholder="搜索"
                aria-label="搜索侧栏"
                className="h-8 border-sidebar-border bg-sidebar-accent/70 px-2.5 text-sm shadow-none transition-[background-color,box-shadow] duration-200 focus-visible:bg-background"
                onChange={function (event) {
                  setFilter(event.target.value)
                }}
              />
            ) : null}
            {isEmpty ? (
              <p className="animate-in fade-in px-1 text-xs text-sidebar-foreground/55 duration-200">
                没有匹配项
              </p>
            ) : null}
            <section className={props.isOpen ? OPEN_STACK : undefined}>
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
              <Fold
                isOpen={!props.isOpen || isTabsOpen}
                className={props.isOpen ? OPEN_STACK : SHUT_STACK}>
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
                          lives={props.lives}
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
                      <div className={clsx(rowClass(props.isOpen), ROW_ON, 'shadow-md')}>
                        <span className={clsx('flex items-center', hitClass(props.isOpen))}>
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
                {visibleSearches.map(function (item) {
                  return (
                    <div
                      key={item}
                      className={clsx(rowClass(props.isOpen), ROW_IDLE, ENTER)}>
                      <button
                        type="button"
                        title={item}
                        aria-label={item}
                        className={clsx('flex items-center text-left', hitClass(props.isOpen))}
                        onClick={function () {
                          props.onSearch(item)
                        }}>
                        <Icon
                          icon="lucide:search"
                          className={clsx(MARK_BOX, 'text-sidebar-foreground/45')}
                          aria-hidden
                        />
                        {props.isOpen ? <span className="truncate">{item}</span> : null}
                      </button>
                      {props.isOpen ? (
                        <button
                          type="button"
                          aria-label="删除"
                          className="flex size-5 shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity duration-150 hover:bg-foreground/10 group-hover/row:opacity-100 focus-visible:opacity-100"
                          onClick={function () {
                            props.onRemoveSearch(item)
                          }}>
                          <Icon
                            icon="lucide:x"
                            className="size-3.5"
                            aria-hidden
                          />
                        </button>
                      ) : null}
                    </div>
                  )
                })}
              </Fold>
            </section>
            {visibleCollections.map(function (group) {
              const isGroupOpen = Boolean(openGroups[group.id])
              // 浏览器窗口只负责浏览：没有网址的成员属于工作台，不在这里出现。
              const rows = (members[group.id] ?? []).filter(function (member) {
                if (!member.url) return false
                return (
                  matches(query, group.title) ||
                  matches(query, member.title) ||
                  matches(query, member.url)
                )
              })
              return (
                <section
                  key={group.id}
                  className={props.isOpen ? OPEN_STACK : undefined}>
                  <button
                    type="button"
                    title={group.title}
                    aria-label={group.title}
                    aria-expanded={isGroupOpen}
                    className={clsx(
                      rowClass(props.isOpen),
                      ROW_IDLE,
                      isGroupOpen && 'bg-sidebar-accent/70'
                    )}
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
                        MARK_BOX,
                        'transition-colors duration-200',
                        isGroupOpen ? 'text-sidebar-primary' : 'text-sidebar-foreground/70'
                      )}
                      aria-hidden
                    />
                    {props.isOpen ? <span className="truncate">{group.title}</span> : null}
                  </button>
                  <Fold isOpen={isGroupOpen}>
                    <div
                      className={clsx(
                        props.isOpen
                          ? 'relative ml-3 flex flex-col gap-2 border-l border-sidebar-border/80 pl-1.5'
                          : SHUT_STACK
                      )}>
                      {rows.map(function (member) {
                        const label = member.title || findHost(member.url ?? '')
                        const isOn = member.id === props.activeMemberId
                        const url = member.url ?? ''
                        const mark = url ? findPageMark(props.lives, member.id) : null
                        const name = rowName(label, mark)
                        return (
                          <div
                            key={member.id}
                            className={clsx(
                              rowClass(props.isOpen),
                              ENTER,
                              isOn ? ROW_ON : ROW_IDLE
                            )}>
                            <button
                              type="button"
                              title={name}
                              aria-label={name}
                              aria-selected={isOn}
                              className={clsx(
                                'flex items-center text-left',
                                hitClass(props.isOpen),
                                !props.isOpen && mark && 'relative'
                              )}
                              onClick={function () {
                                props.onOpenMember(member)
                              }}>
                              <SiteMark
                                url={url}
                                label={label}
                              />
                              {mark ? (
                                <LifeDot
                                  mark={mark}
                                  isOpen={props.isOpen}
                                />
                              ) : null}
                              {props.isOpen ? <span className="truncate">{label}</span> : null}
                            </button>
                            {props.isOpen && isOn && member.url ? (
                              <button
                                type="button"
                                aria-label="关闭"
                                className="flex size-5 shrink-0 items-center justify-center rounded-full opacity-70 hover:bg-foreground/10"
                                onClick={function () {
                                  props.onCloseMember(member.id)
                                }}>
                                <Icon
                                  icon="lucide:x"
                                  className="size-3.5"
                                  aria-hidden
                                />
                              </button>
                            ) : null}
                          </div>
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
          <div
            className={clsx(
              'flex flex-col text-sm',
              props.isOpen ? clsx(OPEN_STACK, 'px-2 py-2') : clsx(SHUT_STACK, 'px-1 py-2')
            )}>
            {props.downloads.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-2 py-10 text-center">
                <span className="flex size-10 items-center justify-center rounded-full bg-sidebar-accent text-sidebar-foreground/55">
                  <Icon
                    icon="lucide:download"
                    className="size-4"
                    aria-hidden
                  />
                </span>
                {props.isOpen ? (
                  <p className="text-sm text-sidebar-foreground/60">暂无下载</p>
                ) : null}
              </div>
            ) : (
              props.downloads.map(function (item) {
                const status =
                  item.status === 'started' ? '下载中' : item.status === 'done' ? '完成' : '失败'
                return (
                  <div
                    key={item.id}
                    className={clsx(rowClass(props.isOpen), ROW_IDLE, ENTER, 'cursor-default')}
                    title={item.name}>
                    <Icon
                      icon="lucide:file"
                      className={clsx(MARK_BOX, 'text-sidebar-foreground/70')}
                      aria-hidden
                    />
                    {props.isOpen ? (
                      <>
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                        <span
                          className={clsx(
                            'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                            item.status === 'done' &&
                              'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
                            item.status === 'started' &&
                              'bg-sidebar-primary/15 text-sidebar-primary',
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
          <div
            className={clsx(
              'flex flex-col text-sm',
              props.isOpen ? clsx(OPEN_STACK, 'px-2 py-2') : clsx(SHUT_STACK, 'px-1 py-2')
            )}>
            {props.isOpen ? (
              <p className="px-2 text-xs leading-5 text-sidebar-foreground/55">
                {props.isExtensionSupported
                  ? '扩展放在应用数据目录 extensions。导入后会重新打开页面。'
                  : '当前系统不能加载 Chrome 扩展。'}
              </p>
            ) : null}
            {props.notice ? (
              <p
                role="status"
                className={clsx(
                  'rounded-md px-2 py-1.5 text-xs leading-5',
                  props.notice.tone === 'ok'
                    ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                    : 'bg-destructive/12 text-destructive'
                )}>
                {props.notice.text}
              </p>
            ) : null}
            <Button
              variant="outline"
              size={props.isOpen ? 'sm' : 'icon-sm'}
              className={clsx(
                'min-h-9 border-border bg-background text-foreground shadow-none hover:bg-sidebar-accent',
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
                    className={clsx(rowClass(props.isOpen), ROW_IDLE, ENTER)}
                    title={name}>
                    <Icon
                      icon="lucide:puzzle"
                      className={MARK_BOX}
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

export { BrowserSidebar, findPageMark, lifeLabel }
export type { BrowserSidebarProps, PageLife, PageMark }
