import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { listen } from '@tauri-apps/api/event'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { clsx } from 'clsx'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useRef, useState } from 'react'

import { ENGINE_STORE_KEY, findEngine } from '@/constants/engine'
import Controller from '@/features/controller/controller.tsx'
import { toast } from 'sonner'
import { BrowserBar } from '@/features/browser-bar/bar'
import {
  SIDEBAR_OPEN,
  SIDEBAR_SHUT,
  canPlace,
  findNodeBounds,
  findTargetBounds
} from '@/views/overview/browser/bounds'
import { findHost } from '@/views/overview/browser/label'
import { Omnibox } from '@/views/overview/browser/omnibox'
import { usePageStack } from '@/views/overview/browser/use-page-stack'
import { BrowserSidebar, type PageLife } from '@/views/overview/browser/sidebar'
import type { BrowserPanel, BrowserSurface, DownloadItem } from '@/views/overview/browser/types'
import { findAddressUrl } from '@/views/overview/engine/engine-url'
import { readEngineKey, writeEngineKey } from '@/views/overview/engine/engine-store'
import { CaptionAccount } from '@/views/overview/caption/account'
import { MirrorSwitcher } from '@/views/overview/caption/mirror'
import { CaptionStatus } from '@/views/overview/caption/status'
import styles from '@/views/overview/overview.module.scss'
import {
  activatePage,
  closeBar,
  closePage,
  historyPage,
  reloadPage,
  importExtension,
  navigatePage,
  openDevtools,
  openPage,
  placePage,
  readExtensions,
  removeExtension,
  suspendPages
} from '@/views/navigation/ipc'
import { readBrowser, writeBrowser, type Tab } from '@/views/navigation/session'

interface PageEvent {
  id: string
  url: string
}

interface LoadEvent {
  id: string
  ok: boolean
}

interface TitleEvent {
  id: string
  title: string
}

interface DownloadEvent {
  id: string
  url: string
  name: string
  status: DownloadItem['status']
  path?: string | null
}

interface OpenUrlEvent {
  url: string
}

const OPEN_URL_EVENT = 'navigation://open-url'
const SEARCH_LIMIT = 20

interface BrowserChromeProps {
  onSignIn: () => void
}

function createTab(url: string): Tab {
  return {
    id: crypto.randomUUID(),
    url,
    title: url ? findHost(url) : '新标签'
  }
}

function rememberSearch(current: string[], query: string) {
  return [query, ...current.filter(function (item) {
    return item !== query
  })].slice(0, SEARCH_LIMIT)
}

function BrowserChrome(props: BrowserChromeProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const sideRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<Tab[]>([])
  const activeIdRef = useRef('')
  const engineKeyRef = useRef(readEngineKey())
  const surfaceRef = useRef<BrowserSurface>('tiles')
  const focusUrlRef = useRef<(url: string) => void>(function () {})
  const goTilesRef = useRef<() => void>(function () {})
  const placeActiveRef = useRef<(bounds: { x: number; y: number; width: number; height: number }) => void>(
    function () {}
  )
  const liveRef = useRef(new Set<string>())
  const applyLifeRef = useRef<(id: string, life: PageLife | null) => void>(function () {})
  const searchesRef = useRef<string[]>([])
  const persistRef = useRef(function () {
    return Promise.resolve()
  })
  const showPageRef = useRef<(id: string, url: string) => Promise<void>>(async function () {})
  const isBoundsLocked = useRef(false)

  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState('')
  const [address, setAddress] = useState('')
  const [searches, setSearches] = useState<string[]>([])
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [extensions, setExtensions] = useState<string[]>([])
  const [isExtensionSupported, setIsExtensionSupported] = useState(false)
  const [panel, setPanel] = useState<BrowserPanel>('sites')
  const [engineKey, setEngineKey] = useState(readEngineKey)
  const [isReady, setIsReady] = useState(false)
  const [surface, setSurface] = useState<BrowserSurface>('tiles')
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [guest, setGuest] = useState<{ id: string; url: string } | null>(null)
  const [lives, setLives] = useState<Record<string, PageLife>>({})
  const guestRef = useRef<{ id: string; url: string } | null>(null)

  const active = tabs.find(function (tab) {
    return tab.id === activeId
  })
  const pageUrl = guest?.url || active?.url || ''
  const pageId = guest?.id || active?.id || ''
  const showTiles = surface !== 'page' || !pageUrl
  const pageStack = usePageStack(contentRef, !showTiles)

  function findShownBounds() {
    const content = findNodeBounds(contentRef.current)
    const toolbar = toolbarRef.current?.getBoundingClientRect()
    const side = sideRef.current?.getBoundingClientRect()
    const minX = side ? side.right : content.x
    const minY = toolbar ? toolbar.bottom : content.y
    const x = Math.max(content.x, minX)
    const y = Math.max(content.y, minY)
    return {
      x,
      y,
      width: Math.max(0, content.x + content.width - x),
      height: Math.max(0, content.y + content.height - y)
    }
  }

  function placeActive(bounds: { x: number; y: number; width: number; height: number }) {
    const id = activeIdRef.current
    const current = tabsRef.current.find(function (tab) {
      return tab.id === id
    })
    const url = current?.url || (guestRef.current?.id === id ? guestRef.current.url : '')
    if (!url || surfaceRef.current !== 'page') return
    if (!canPlace(bounds)) return
    if (!liveRef.current.has(id)) return
    void placePage(id, bounds).then(function () {
      pageStack.reapply()
    })
  }

  function goTiles() {
    surfaceRef.current = 'tiles'
    setSurface('tiles')
    void suspendPages()
  }

  function applyLife(id: string, life: PageLife | null) {
    setLives(function (current) {
      if (life === null) {
        if (!(id in current)) return current
        const next = { ...current }
        delete next[id]
        return next
      }
      if (current[id] === life) return current
      return { ...current, [id]: life }
    })
  }

  function noteLoad(id: string) {
    if (!liveRef.current.has(id)) return
    applyLife(id, 'wait')
  }

  async function showPage(id: string, url: string) {
    if (!url) return
    const isNew = !liveRef.current.has(id)
    await openPage(id, url)
    liveRef.current.add(id)
    if (isNew) applyLife(id, 'wait')
    if (surfaceRef.current !== 'page' || activeIdRef.current !== id) return
    const bounds = findShownBounds()
    if (!canPlace(bounds)) return
    await activatePage(id, bounds)
    pageStack.reapply()
  }

  async function reloadLive(next: Tab[], nextActiveId: string) {
    setLives({})
    const ids = [...liveRef.current]
    for (const id of ids) {
      liveRef.current.delete(id)
      await closePage(id)
    }
    const current = next.find(function (tab) {
      return tab.id === nextActiveId
    })
    if (surfaceRef.current !== 'page' || !current?.url) return
    await showPage(current.id, current.url)
  }

  function focusUrl(url: string) {
    if (!url) {
      goTiles()
      return
    }
    // 新窗口一律进「网址」标签。集合客页里点开的链接也不再占用客页，避免盖住新标签。
    guestRef.current = null
    setGuest(null)
    surfaceRef.current = 'page'
    setSurface('page')
    const found = tabsRef.current.find(function (tab) {
      return tab.url === url
    })
    if (found) {
      activeIdRef.current = found.id
      setActiveId(found.id)
      setAddress(found.url)
      void showPage(found.id, found.url)
      return
    }
    const tab = createTab(url)
    activeIdRef.current = tab.id
    const next = tabsRef.current.concat([tab])
    tabsRef.current = next
    setTabs(next)
    setActiveId(tab.id)
    setAddress(url)
    void showPage(tab.id, url)
  }

  function openAddress(url: string, query?: string) {
    if (!url) return
    if (query) {
      setSearches(function (current) {
        return rememberSearch(current, query)
      })
    }
    surfaceRef.current = 'page'
    setSurface('page')
    const currentId = activeIdRef.current
    if (guestRef.current && guestRef.current.id === currentId) {
      guestRef.current = { id: currentId, url }
      setGuest(guestRef.current)
      setAddress(url)
      noteLoad(currentId)
      void navigatePage(currentId, url).then(function () {
        return showPage(currentId, url)
      })
      return
    }
    if (!currentId) {
      focusUrl(url)
      return
    }
    const current = tabsRef.current.find(function (tab) {
      return tab.id === currentId
    })
    const next = tabsRef.current.map(function (tab) {
      if (tab.id !== currentId) return tab
      return { ...tab, url, title: tab.title || findHost(url) }
    })
    setTabs(next)
    setAddress(url)
    if (current?.url) {
      noteLoad(currentId)
      void navigatePage(currentId, url).then(function () {
        return showPage(currentId, url)
      })
      return
    }
    void showPage(currentId, url)
  }

  function chooseEngine(key: string) {
    setEngineKey(key)
    writeEngineKey(key)
  }

  function openCollection(tile: MagneticTile) {
    const url = tile.url ?? ''
    if (!url) return
    guestRef.current = { id: tile.id, url }
    setGuest(guestRef.current)
    activeIdRef.current = tile.id
    setActiveId('')
    setAddress(url)
    surfaceRef.current = 'page'
    setSurface('page')
    void showPage(tile.id, url)
  }

  async function closeCollection(id: string) {
    if (guestRef.current?.id !== id) return
    guestRef.current = null
    setGuest(null)
    liveRef.current.delete(id)
    await closePage(id)
    applyLife(id, null)
    if (activeIdRef.current !== id) return
    activeIdRef.current = ''
    setAddress('')
    goTiles()
  }

  function selectTab(tab: Tab) {
    guestRef.current = null
    setGuest(null)
    activeIdRef.current = tab.id
    setActiveId(tab.id)
    setAddress(tab.url)
    if (!tab.url) {
      goTiles()
      return
    }
    surfaceRef.current = 'page'
    setSurface('page')
    void showPage(tab.id, tab.url)
  }

  async function closeTab(id: string) {
    const wasPage = surfaceRef.current === 'page'
    const closing = tabsRef.current.find(function (tab) {
      return tab.id === id
    })
    const next = tabsRef.current.filter(function (tab) {
      return tab.id !== id
    })
    tabsRef.current = next
    if (closing?.url) {
      liveRef.current.delete(id)
      await closePage(id)
      applyLife(id, null)
    }
    setTabs(next)
    if (activeIdRef.current !== id) return
    const fallback = next[next.length - 1]
    activeIdRef.current = fallback?.id ?? ''
    setActiveId(fallback?.id ?? '')
    setAddress(fallback?.url ?? '')
    if (wasPage && fallback?.url) {
      surfaceRef.current = 'page'
      setSurface('page')
      await showPage(fallback.id, fallback.url)
      return
    }
    goTiles()
  }

  function createEmpty() {
    const tab = createTab('')
    activeIdRef.current = tab.id
    setTabs(function (current) {
      return [...current, tab]
    })
    setActiveId(tab.id)
    setAddress('')
    goTiles()
  }

  function moveTab(from: number, to: number) {
    setTabs(function (current) {
      const copy = current.slice()
      const [item] = copy.splice(from, 1)
      if (!item) return current
      copy.splice(to, 0, item)
      return copy
    })
  }

  function toggleSidebar() {
    const nextOpen = !isSidebarOpen
    const pageVisible = surfaceRef.current === 'page'
    if (pageVisible) {
      isBoundsLocked.current = true
      placeActive(
        findTargetBounds(window.innerWidth, window.innerHeight, nextOpen ? SIDEBAR_OPEN : SIDEBAR_SHUT)
      )
    }
    setIsSidebarOpen(nextOpen)
  }

  function focusPanel(next: BrowserPanel) {
    if (!isSidebarOpen) {
      setPanel(next)
      void toggleSidebar()
      return
    }
    setPanel(function (current) {
      return current === next ? 'sites' : next
    })
  }

  useEffect(
    function () {
      if (!isBoundsLocked.current) return
      const frame = window.requestAnimationFrame(function () {
        isBoundsLocked.current = false
      })
      return function () {
        window.cancelAnimationFrame(frame)
      }
    },
    [isSidebarOpen]
  )

  useEffect(function () {
    tabsRef.current = tabs
    guestRef.current = guest
    activeIdRef.current = guest ? guest.id : activeId
    engineKeyRef.current = engineKey
    surfaceRef.current = surface
    focusUrlRef.current = focusUrl
    goTilesRef.current = goTiles
    placeActiveRef.current = placeActive
    searchesRef.current = searches
    showPageRef.current = showPage
    applyLifeRef.current = applyLife
    persistRef.current = function () {
      return writeBrowser({
        tabs: tabsRef.current,
        activeId: activeIdRef.current,
        searches: searchesRef.current
      })
    }
  })

  useEffect(
    function () {
      if (!isReady) return
      const timer = window.setTimeout(function () {
        void persistRef.current()
      }, 300)
      return function () {
        window.clearTimeout(timer)
      }
    },
    [tabs, activeId, searches, isReady]
  )

  useEffect(function () {
    let stopped = false
    void (async function () {
      const session = await readBrowser()
      if (stopped) return
      const next = session.tabs
      const nextActive = session.activeId
      const current = next.find(function (tab) {
        return tab.id === nextActive
      })
      if (current?.url) {
        surfaceRef.current = 'page'
        setSurface('page')
      }
      tabsRef.current = next
      activeIdRef.current = nextActive
      searchesRef.current = session.searches
      setTabs(next)
      setActiveId(nextActive)
      setAddress(current?.url ?? '')
      setSearches(session.searches)
      setIsReady(true)
      try {
        if (stopped) return
        if (surfaceRef.current === 'page' && current?.url) await showPageRef.current(current.id, current.url)
      } catch (error) {
        console.error('[browser] 打开页面失败', error)
      }
      const listed = await readExtensions()
      if (stopped) return
      setExtensions(listed.names)
      setIsExtensionSupported(listed.supported)
    })()
    return function () {
      stopped = true
    }
  }, [])

  useEffect(function () {
    const unlisten: Array<() => void> = []
    void listen<PageEvent>('navigation://view', function (event) {
      const url = event.payload.url
      if (url.startsWith('chrome-error:') || url.startsWith('edge-error:')) {
        if (liveRef.current.has(event.payload.id)) applyLifeRef.current(event.payload.id, 'fail')
        return
      }
      if (!url.startsWith('http://') && !url.startsWith('https://')) return
      setTabs(function (current) {
        return current.map(function (tab) {
          if (tab.id !== event.payload.id) return tab
          return { ...tab, url: event.payload.url }
        })
      })
      if (event.payload.id === activeIdRef.current) setAddress(event.payload.url)
    }).then(function (stop) {
      unlisten.push(stop)
    })
    void listen<LoadEvent>('navigation://load', function (event) {
      if (!liveRef.current.has(event.payload.id)) return
      applyLifeRef.current(event.payload.id, event.payload.ok ? 'ok' : 'fail')
    }).then(function (stop) {
      unlisten.push(stop)
    })
    void listen<TitleEvent>('navigation://title', function (event) {
      setTabs(function (current) {
        return current.map(function (tab) {
          if (tab.id !== event.payload.id || !event.payload.title) return tab
          return { ...tab, title: event.payload.title }
        })
      })
    }).then(function (stop) {
      unlisten.push(stop)
    })
    void listen<DownloadEvent>('navigation://download', function (event) {
      setDownloads(function (current) {
        const next = current.filter(function (item) {
          return item.id !== event.payload.id
        })
        next.unshift({
          id: event.payload.id,
          url: event.payload.url,
          name: event.payload.name,
          status: event.payload.status,
          path: event.payload.path ?? undefined
        })
        return next.slice(0, 30)
      })
    }).then(function (stop) {
      unlisten.push(stop)
    })
    void listen<OpenUrlEvent>(OPEN_URL_EVENT, function (event) {
      if (event.payload?.url) focusUrlRef.current(event.payload.url)
      else goTilesRef.current()
    }).then(function (stop) {
      unlisten.push(stop)
    })
    return function () {
      for (const stop of unlisten) stop()
    }
  }, [])

  useEffect(
    function () {
      const node = contentRef.current
      const shownId = pageId
      if (!node || showTiles || !shownId || !pageUrl) return
      const observer = new ResizeObserver(function () {
        if (isBoundsLocked.current) return
        if (!liveRef.current.has(shownId)) return
        placeActiveRef.current(findShownBounds())
      })
      observer.observe(node)
      return function () {
        observer.disconnect()
      }
    },
    [pageId, pageUrl, showTiles]
  )

  useEffect(function () {
    function onStorage(event: StorageEvent) {
      if (event.key !== ENGINE_STORE_KEY) return
      setEngineKey(readEngineKey())
    }
    window.addEventListener('storage', onStorage)
    return function () {
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  useEffect(function () {
    const win = getCurrentWindow()
    let unlisten = function () {}
    void win
      .onCloseRequested(function (event) {
        event.preventDefault()
        void persistRef.current().finally(function () {
          void win.destroy()
        })
      })
      .then(function (stop) {
        unlisten = stop
      })
    return function () {
      unlisten()
    }
  }, [])

  useEffect(function () {
    void closeBar().catch(function (error: unknown) {
      console.error('[browser] 关闭旧地址栏失败', error)
    })
  }, [])

  async function onImportExtension() {
    const picked = await dialogOpen({ directory: true, multiple: false })
    if (typeof picked !== 'string') return
    try {
      const result = await importExtension(picked)
      setExtensions(result.names)
      setIsExtensionSupported(result.supported)
      await reloadLive(tabsRef.current, activeIdRef.current)
      toast.success('扩展已导入，页面已重新打开')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入扩展失败')
    }
  }

  async function onRemoveExtension(name: string) {
    try {
      const result = await removeExtension(name)
      setExtensions(result.names)
      await reloadLive(tabsRef.current, activeIdRef.current)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '移除扩展失败')
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div
        ref={sideRef}
        className="flex shrink-0 self-stretch">
        <BrowserSidebar
          isOpen={isSidebarOpen}
          tabs={tabs}
          activeId={activeId}
          searches={searches}
          downloads={downloads}
          extensions={extensions}
          isExtensionSupported={isExtensionSupported}
          panel={panel}
          canDevtools={Boolean(active?.url)}
          onSelectTab={selectTab}
          onCloseTab={function (id) {
            void closeTab(id)
          }}
          onMoveTab={moveTab}
          onCreateTab={createEmpty}
          onToggleSidebar={function () {
            void toggleSidebar()
          }}
          onOpenUrl={focusUrl}
          activeMemberId={surface === 'page' ? (guest?.id ?? '') : ''}
          lives={lives}
          onOpenMember={openCollection}
          onCloseMember={function (id) {
            void closeCollection(id)
          }}
          onSearch={function (query) {
            const url = findAddressUrl(query, findEngine(engineKeyRef.current).match)
            openAddress(url, query)
          }}
          onRemoveSearch={function (query) {
            setSearches(function (current) {
              return current.filter(function (item) {
                return item !== query
              })
            })
          }}
          onImportExtension={function () {
            void onImportExtension()
          }}
          onRemoveExtension={function (name) {
            void onRemoveExtension(name)
          }}
          onDevtools={function () {
            if (active?.url) void openDevtools(active.id)
          }}
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <BrowserBar
        onBind={function (node) {
          toolbarRef.current = node
        }}
        trailing={
          <>
            <MirrorSwitcher
              isCompact
              menuSide="bottom"
            />
            <CaptionStatus />
            <Button
              variant="ghost"
              size="icon"
              data-region="false"
              aria-label="下载"
              aria-pressed={panel === 'downloads'}
              className={clsx(
                'size-10 min-w-10 rounded-full [&_svg]:size-4.5',
                panel === 'downloads' && 'bg-primary/12 text-primary'
              )}
              onClick={function () {
                focusPanel('downloads')
              }}>
              <Icon
                icon="lucide:download"
                aria-hidden
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              data-region="false"
              aria-label="扩展"
              aria-pressed={panel === 'extensions'}
              className={clsx(
                'size-10 min-w-10 rounded-full [&_svg]:size-4.5',
                panel === 'extensions' && 'bg-primary/12 text-primary'
              )}
              onClick={function () {
                focusPanel('extensions')
              }}>
              <Icon
                icon="lucide:puzzle"
                aria-hidden
              />
            </Button>
            <CaptionAccount
              isIcon
              onSignIn={props.onSignIn}
            />
          </>
        }>
        <Omnibox
          address={address}
          engineKey={engineKey}
          canBack={Boolean(pageUrl)}
          canForward={Boolean(pageUrl)}
          onAddress={setAddress}
          onSubmit={openAddress}
          onEngine={chooseEngine}
          onHome={goTiles}
          onBack={function () {
            if (!pageUrl) return
            noteLoad(pageId)
            void historyPage(pageId, 'back')
          }}
          onForward={function () {
            if (!pageUrl) return
            noteLoad(pageId)
            void historyPage(pageId, 'forward')
          }}
          onReload={function () {
            if (!pageUrl) return
            noteLoad(pageId)
            void reloadPage(pageId)
          }}
          onCover={pageStack.holdSuggest}
        />
      </BrowserBar>
        <div
          ref={contentRef}
          className="min-h-0 min-w-0 flex-1 bg-transparent">
          {showTiles ? (
            <div className={clsx(styles.overview, styles.core, 'h-full')}>
              <Controller.Mirror>
                <Controller.MagneticTile />
              </Controller.Mirror>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export { BrowserChrome }
