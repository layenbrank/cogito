import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { invoke } from '@tauri-apps/api/core'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { clsx } from 'clsx'
import { useRef, useState, type PointerEvent } from 'react'

import { activateTile } from '@/features/magnetic-tile/activate'
import { CaptionAccount } from '@/views/overview/caption/account'
import { CHANNELS } from '@/shared/ipc/channels'
import { useMirrorStore } from '@/stores/mirror'
import { SIDEBAR_OPEN, SIDEBAR_SHUT } from '@/views/overview/browser/bounds'
import { findFavicon, findHost } from '@/views/overview/browser/label'
import type { BrowserPanel, DownloadItem } from '@/views/overview/browser/types'
import type { ClosedTab, Tab } from '@/views/navigation/session'

interface BrowserSidebarProps {
  isOpen: boolean
  tabs: Tab[]
  activeId: string
  searches: string[]
  closed: ClosedTab[]
  onReopenClosed: (id: string) => void
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
  onSignIn: () => void
}

function matches(query: string, text: string) {
  if (!query) return true
  return text.toLowerCase().includes(query)
}

function SiteMark(props: { url: string; label: string }) {
  const [isFailed, setIsFailed] = useState(false)
  const src = props.url ? findFavicon(props.url) : ''
  if (!src || isFailed) {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] font-medium uppercase">
        {(props.label || '?').slice(0, 1)}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      className="size-4 shrink-0"
      onError={function () {
        setIsFailed(true)
      }}
    />
  )
}

function BrowserSidebar(props: BrowserSidebarProps) {
  const dragIndex = useRef(-1)
  const [filter, setFilter] = useState('')
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

  function onTabPointerDown(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (event.button !== 0) return
    dragIndex.current = index
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onTabPointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (dragIndex.current < 0) return
    const hit = document.elementFromPoint(event.clientX, event.clientY)
    const tab = hit?.closest<HTMLElement>('[data-tab-index]')
    const next = Number(tab?.dataset.tabIndex)
    if (!Number.isInteger(next) || next === dragIndex.current) return
    props.onMoveTab(dragIndex.current, next)
    dragIndex.current = next
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

  return (
    <aside
      data-region="false"
      style={{ width: props.isOpen ? SIDEBAR_OPEN : SIDEBAR_SHUT }}
      className="flex shrink-0 flex-col self-stretch overflow-hidden border-r border-border/60 bg-background contain-layout">
      <div className="min-h-0 flex-1 overflow-auto">
        {props.panel === 'sites' ? (
          <div className="flex flex-col gap-2 p-2">
            {props.isOpen ? (
              <Input
                value={filter}
                placeholder="搜索"
                aria-label="搜索侧栏"
                className="shadow-none"
                onChange={function (event) {
                  setFilter(event.target.value)
                }}
              />
            ) : null}
            <Button
              variant="ghost"
              size={props.isOpen ? 'sm' : 'icon-sm'}
              className={clsx('min-h-8', props.isOpen && 'justify-start')}
              aria-label="新建标签"
              onClick={props.onCreateTab}>
              <Icon
                icon="lucide:plus"
                aria-hidden
              />
              {props.isOpen ? <span>新建标签</span> : null}
            </Button>
            {isEmpty ? <p className="px-1 text-xs text-muted-foreground">没有匹配项</p> : null}
            <section>
              {props.isOpen ? (
                <button
                  type="button"
                  className="flex h-8 w-full items-center gap-1 px-1 text-xs text-muted-foreground"
                  onClick={function () {
                    setIsTabsOpen(function (current) {
                      return !current
                    })
                  }}>
                  <Icon
                    icon={isTabsOpen ? 'lucide:chevron-down' : 'lucide:chevron-right'}
                    className="size-3.5"
                    aria-hidden
                  />
                  标签
                </button>
              ) : null}
              {props.isOpen && !isTabsOpen
                ? null
                : visibleTabs.map(function (tab) {
                    const index = props.tabs.findIndex(function (item) {
                      return item.id === tab.id
                    })
                    const label = tab.title || findHost(tab.url)
                    const isActive = tab.id === props.activeId
                    return (
                      <div
                        key={tab.id}
                        className={clsx(
                          'flex min-h-8 items-center rounded-md',
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-background/70'
                        )}>
                        <button
                          type="button"
                          data-tab-index={index}
                          aria-label={label}
                          aria-selected={isActive}
                          title={label}
                          className="flex min-h-8 min-w-0 flex-1 items-center gap-2 px-1.5 text-left text-sm"
                          onPointerDown={function (event) {
                            onTabPointerDown(event, index)
                          }}
                          onPointerMove={onTabPointerMove}
                          onPointerUp={function () {
                            dragIndex.current = -1
                          }}
                          onClick={function () {
                            props.onSelectTab(tab)
                          }}>
                          <SiteMark
                            url={tab.url}
                            label={label}
                          />
                          {props.isOpen ? <span className="truncate">{label}</span> : null}
                        </button>
                        {props.isOpen ? (
                          <button
                            type="button"
                            aria-label="关闭标签"
                            className={clsx(
                              'mr-1 flex size-5 shrink-0 items-center justify-center rounded-full text-sm',
                              isActive ? 'hover:bg-primary-foreground/20' : 'hover:bg-foreground/10'
                            )}
                            onPointerDown={function (event) {
                              event.stopPropagation()
                            }}
                            onClick={function () {
                              props.onCloseTab(tab.id)
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
            </section>
            {props.isOpen && props.closed.length > 0 ? (
              <section>
                <p className="flex h-8 items-center px-1 text-xs text-muted-foreground">最近关闭</p>
                {props.closed.map(function (item) {
                  const label = item.title || findHost(item.url)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      title={label}
                      aria-label={`重新打开 ${label}`}
                      className="flex min-h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-sm hover:bg-background/70"
                      onClick={function () {
                        props.onReopenClosed(item.id)
                      }}>
                      <SiteMark
                        url={item.url}
                        label={label}
                      />
                      <span className="truncate">{label}</span>
                    </button>
                  )
                })}
              </section>
            ) : null}
            <section>
              {props.isOpen ? (
                <button
                  type="button"
                  className="flex h-8 w-full items-center gap-1 px-1 text-xs text-muted-foreground"
                  onClick={function () {
                    setIsSearchOpen(function (current) {
                      return !current
                    })
                  }}>
                  <Icon
                    icon={isSearchOpen ? 'lucide:chevron-down' : 'lucide:chevron-right'}
                    className="size-3.5"
                    aria-hidden
                  />
                  搜索
                </button>
              ) : null}
              {props.isOpen && !isSearchOpen
                ? null
                : visibleSearches.map(function (item) {
                    return (
                      <button
                        key={item}
                        type="button"
                        title={item}
                        aria-label={item}
                        className="flex min-h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-sm hover:bg-background/70"
                        onClick={function () {
                          props.onSearch(item)
                        }}>
                        <Icon
                          icon="lucide:search"
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        {props.isOpen ? <span className="truncate">{item}</span> : null}
                      </button>
                    )
                  })}
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
                    className="flex min-h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-sm"
                    onClick={function () {
                      void toggleGroup(group.id)
                    }}>
                    <Icon
                      icon={isGroupOpen ? 'lucide:folder-open' : 'lucide:folder'}
                      className="size-4 shrink-0"
                      aria-hidden
                    />
                    {props.isOpen ? <span className="truncate">{group.title}</span> : null}
                  </button>
                  {isGroupOpen
                    ? rows.map(function (member) {
                        const label = member.title || findHost(member.url ?? '')
                        return (
                          <button
                            key={member.id}
                            type="button"
                            title={label}
                            aria-label={label}
                            className="flex min-h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-sm hover:bg-background/70"
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
                      })
                    : null}
                </section>
              )
            })}
          </div>
        ) : null}
        {props.panel === 'downloads' ? (
          <div className="space-y-2 p-2 text-sm">
            {props.downloads.length === 0 ? (
              <p className="text-muted-foreground">{props.isOpen ? '暂无下载' : ''}</p>
            ) : (
              props.downloads.map(function (item) {
                const status = item.status === 'started' ? '下载中' : item.status === 'done' ? '完成' : '失败'
                return (
                  <div
                    key={item.id}
                    className="flex min-h-8 items-center gap-2"
                    title={item.name}>
                    <Icon
                      icon="lucide:file"
                      className="size-4 shrink-0"
                      aria-hidden
                    />
                    {props.isOpen ? (
                      <>
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{status}</span>
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
          <div className="space-y-2 p-2 text-sm">
            {props.isOpen ? (
              <p className="text-muted-foreground">
                {props.isExtensionSupported
                  ? '扩展放在应用数据目录 extensions。导入后会重新打开页面。'
                  : '当前系统不能加载 Chrome 扩展。'}
              </p>
            ) : null}
            <Button
              variant="outline"
              size={props.isOpen ? 'sm' : 'icon-sm'}
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
              aria-label="开发者工具"
              disabled={!props.canDevtools}
              onClick={props.onDevtools}>
              <Icon
                icon="lucide:bug"
                aria-hidden
              />
              {props.isOpen ? '开发者工具' : null}
            </Button>
            <ul className="space-y-1">
              {props.extensions.map(function (name) {
                return (
                  <li
                    key={name}
                    className="flex min-h-8 items-center gap-2"
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
      <div className={clsx('shrink-0 border-t border-border/50 p-1', props.isOpen && 'px-2')}>
        <CaptionAccount
          isIcon={!props.isOpen}
          isWide={props.isOpen}
          onSignIn={props.onSignIn}
        />
      </div>
    </aside>
  )
}

export { BrowserSidebar }
export type { BrowserSidebarProps }
