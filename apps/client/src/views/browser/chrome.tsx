import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { clsx } from 'clsx'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useRef, useState } from 'react'

import { ENGINE_STORE_KEY, findEngine } from '@/constants/engine'
import { BrowserBar } from '@/features/browser-bar/bar'
import { findWindowLabel } from '@/features/window/kind'
import { COMMAND } from '@/keyboard/definitions/ids'
import { useCommands, useKeyboard } from '@/keyboard/react'
import { requestAddressFocus } from '@/views/navigation/address-focus'
import {
  canPlace,
  findNodeBounds
} from '@/views/browser/bounds'
import { findHost } from '@/views/browser/label'
import { Omnibox } from '@/views/browser/omnibox'
import { spawnBrowser } from '@/views/browser/open'
import { runBrowserKey } from '@/views/browser/shortcut'
import { BrowserSidebar, type PageLife } from '@/views/browser/sidebar'
import type { BrowserNotice, BrowserPanel, BrowserSurface, DownloadItem } from '@/views/browser/types'
import { findAddressUrl } from '@/views/browser/engine/engine-url'
import { readEngineKey, writeEngineKey } from '@/views/browser/engine/engine-store'
import {
  closePage,
  historyPage,
  reloadPage,
  importExtension,
  navigatePage,
  openDevtools,
  openPage,
  placePage,
  presentPage,
  readExtensions,
  readLivePages,
  removeExtension,
  suspendPages,
  type LivePage,
  type OpenedPage
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

const SEARCH_LIMIT = 20

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

function isMissingPage(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  return text.includes('页面不存在')
}

function BrowserChrome() {
  const contentRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const sideRef = useRef<HTMLDivElement>(null)
  // 会话按窗口 label 分键：多扇浏览窗口各有各的标签，关掉一扇不会带走别家的。
  const sessionKeyRef = useRef(findWindowLabel())
  const tabsRef = useRef<Tab[]>([])
  const activeIdRef = useRef('')
  const engineKeyRef = useRef(readEngineKey())
  const surfaceRef = useRef<BrowserSurface>('blank')
  const focusUrlRef = useRef<(url: string) => void>(function () {})
  const goBlankRef = useRef<() => void>(function () {})
  const placeActiveRef = useRef<(bounds: { x: number; y: number; width: number; height: number }) => void>(
    function () {}
  )
  const liveRef = useRef(new Set<string>())
  const readyRef = useRef(new Set<string>())
  const applyLifeRef = useRef<(id: string, life: PageLife | null) => void>(function () {})
  const adoptLivesRef = useRef<(rows: LivePage[]) => void>(function () {})
  const searchesRef = useRef<string[]>([])
  const persistRef = useRef(function () {
    return Promise.resolve()
  })
  const showPageRef = useRef<(id: string, url: string) => Promise<void>>(async function () {})
  const isMountedRef = useRef(true)
  const pendingPlaceRef = useRef<{
    id: string
    bounds: { x: number; y: number; width: number; height: number }
  } | null>(null)
  const isPlacingRef = useRef(false)
  const pageIdRef = useRef('')

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
  const [surface, setSurface] = useState<BrowserSurface>('blank')
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [notice, setNotice] = useState<BrowserNotice | null>(null)
  const [guest, setGuest] = useState<{ id: string; url: string } | null>(null)
  const [lives, setLives] = useState<Record<string, PageLife>>({})
  const guestRef = useRef<{ id: string; url: string } | null>(null)

  const active = tabs.find(function (tab) {
    return tab.id === activeId
  })
  const pageUrl = guest?.url || active?.url || ''
  const pageId = guest?.id || active?.id || ''
  const showBlank = surface !== 'page' || !pageUrl

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

  async function drainPlace() {
    if (isPlacingRef.current) return
    isPlacingRef.current = true
    try {
      while (pendingPlaceRef.current) {
        const next = pendingPlaceRef.current
        pendingPlaceRef.current = null
        // 期间切走了或回了磁贴，这一帧的摆位已经没有意义。
        if (surfaceRef.current !== 'page' || activeIdRef.current !== next.id) continue
        try {
          await placePage(next.id, next.bounds)
        } catch (error) {
          if (isMissingPage(error)) readyRef.current.delete(next.id)
          console.warn('[browser] 摆放网页失败', error)
        }
      }
    } finally {
      isPlacingRef.current = false
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
    if (!readyRef.current.has(id)) return
    // 拖动窗口时一帧一次：只保留最后一组，避免 IPC 排队把网页拖在后面。
    pendingPlaceRef.current = { id, bounds }
    void drainPlace()
  }

  function goBlank() {
    // 先收起原生子窗口，再画空白页：反过来的话页面会被网页盖住一两帧。
    surfaceRef.current = 'blank'
    const show = function () {
      if (surfaceRef.current === 'blank') setSurface('blank')
    }
    void suspendPages().then(show, function (error: unknown) {
      console.error('[browser] 收起网页失败', error)
      show()
    })
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

  function adoptLives(rows: LivePage[]) {
    rows.forEach(function (row) {
      liveRef.current.add(row.id)
      readyRef.current.add(row.id)
      if (row.ok === true) applyLife(row.id, 'ok')
      else if (row.ok === false) applyLife(row.id, 'fail')
      else applyLife(row.id, 'wait')
    })
  }

  function settleLife(id: string, ok: boolean) {
    const life: PageLife = ok ? 'ok' : 'fail'
    setLives(function (current) {
      const previous = current[id]
      if (previous === 'ok' || previous === 'fail') return current
      return { ...current, [id]: life }
    })
  }

  async function showPage(id: string, url: string) {
    if (!url) return
    const isNew = !liveRef.current.has(id)
    liveRef.current.add(id)
    if (isNew) applyLife(id, 'wait')
    let opened: OpenedPage
    try {
      opened = await openPage(id, url)
    } catch (error) {
      liveRef.current.delete(id)
      readyRef.current.delete(id)
      applyLife(id, 'fail')
      console.error('[browser] 打开页面失败', error)
      return
    }
    if (!liveRef.current.has(id)) return
    readyRef.current.add(id)
    if (typeof opened?.ok === 'boolean') settleLife(id, opened.ok)
    if (!isMountedRef.current || surfaceRef.current !== 'page' || activeIdRef.current !== id) return
    const bounds = findShownBounds()
    if (!canPlace(bounds)) return
    try {
      await presentPage(id, bounds)
    } catch (error) {
      readyRef.current.delete(id)
      if (!isMissingPage(error)) console.error('[browser] 摆放页面失败', error)
      return
    }
    if (!isMountedRef.current) {
      void suspendPages()
      return
    }
  }

  async function reloadLive(next: Tab[], nextActiveId: string) {
    setLives({})
    const ids = [...liveRef.current]
    for (const id of ids) {
      liveRef.current.delete(id)
      readyRef.current.delete(id)
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
      goBlank()
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
    readyRef.current.delete(id)
    await closePage(id)
    applyLife(id, null)
    if (activeIdRef.current !== id) return
    activeIdRef.current = ''
    setAddress('')
    goBlank()
  }

  function selectTab(tab: Tab) {
    guestRef.current = null
    setGuest(null)
    activeIdRef.current = tab.id
    setActiveId(tab.id)
    setAddress(tab.url)
    if (!tab.url) {
      goBlank()
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
    const index = tabsRef.current.findIndex(function (tab) {
      return tab.id === id
    })
    const next = tabsRef.current.filter(function (tab) {
      return tab.id !== id
    })
    tabsRef.current = next
    if (closing?.url) {
      liveRef.current.delete(id)
      readyRef.current.delete(id)
      await closePage(id)
      applyLife(id, null)
    }
    setTabs(next)
    if (activeIdRef.current !== id) return
    // 先落到原位置上的下一个标签，没有就退到前一个。
    const fallback = next[Math.min(Math.max(index, 0), next.length - 1)]
    activeIdRef.current = fallback?.id ?? ''
    setActiveId(fallback?.id ?? '')
    setAddress(fallback?.url ?? '')
    if (wasPage && fallback?.url) {
      surfaceRef.current = 'page'
      setSurface('page')
      await showPage(fallback.id, fallback.url)
      return
    }
    goBlank()
  }

  function createEmpty() {
    const tab = createTab('')
    activeIdRef.current = tab.id
    setTabs(function (current) {
      return [...current, tab]
    })
    setActiveId(tab.id)
    setAddress('')
    goBlank()
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
    // 只改状态：新矩形由布局后的 ResizeObserver 量出来，不在这里用常量推算。
    setIsSidebarOpen(function (current) {
      return !current
    })
  }

  function focusPanel(next: BrowserPanel) {
    if (!isSidebarOpen) {
      setPanel(next)
      setIsSidebarOpen(true)
      return
    }
    setPanel(function (current) {
      return current === next ? 'sites' : next
    })
  }

  useEffect(function () {
    tabsRef.current = tabs
    guestRef.current = guest
    activeIdRef.current = guest ? guest.id : activeId
    engineKeyRef.current = engineKey
    surfaceRef.current = surface
    focusUrlRef.current = focusUrl
    goBlankRef.current = goBlank
    placeActiveRef.current = placeActive
    searchesRef.current = searches
    showPageRef.current = showPage
    applyLifeRef.current = applyLife
    adoptLivesRef.current = adoptLives
    pageIdRef.current = guest ? guest.id : activeId
    persistRef.current = function () {
      return writeBrowser(sessionKeyRef.current, {
        tabs: tabsRef.current,
        // 客页（集合里点开的链接）不在标签列表里，落盘时不算当前标签。
        activeId,
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
    return function () {
      isMountedRef.current = false
      void suspendPages()
    }
  }, [])

  // 侧栏提示：不打断操作，几秒后自己消失（DOM 提示不能飘到网页上方）。
  useEffect(
    function () {
      if (!notice) return
      const timer = window.setTimeout(function () {
        setNotice(null)
      }, 4000)
      return function () {
        window.clearTimeout(timer)
      }
    },
    [notice]
  )

  useEffect(function () {
    // 窗口是隐藏创建的，渲染完再让它出现（避免透明窗口先透出桌面）。
    void invoke('browser:ready').catch(function (error: unknown) {
      console.warn('[browser] 显示窗口失败', error)
    })
  }, [])

  useEffect(function () {
    const stops: Array<() => void> = []
    void listen<{ url: string }>('navigation://open-url', function (event) {
      const url = event.payload?.url ?? ''
      if (url) focusUrlRef.current(url)
    }).then(function (stop) {
      stops.push(stop)
    })
    // 焦点在网页里时壳层收不到按键：注入脚本把浏览快捷键转成这条消息。
    void listen<{ key: string }>('navigation://shortcut', function (event) {
      runBrowserKey(event.payload?.key ?? '')
    }).then(function (stop) {
      stops.push(stop)
    })
    // 窗口刚建好时事件会丢：Rust 先把地址存着，这里取走。
    void invoke<string | null>('browser:take-pending')
      .then(function (url) {
        if (url) focusUrlRef.current(url)
      })
      .catch(function (error: unknown) {
        console.warn('[browser] 读取待打开地址失败', error)
      })
    return function () {
      for (const stop of stops) stop()
    }
  }, [])

  useEffect(function () {
    let stopped = false
    void (async function () {
      const session = await readBrowser(sessionKeyRef.current)
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
        const rows = await readLivePages()
        if (stopped) return
        // 会话里已经没有的页面（上一轮遗留的集合客页 / 已删标签）占着标签，直接关掉。
        const known = new Set(
          next
            .filter(function (tab) {
              return Boolean(tab.url)
            })
            .map(function (tab) {
              return tab.id
            })
        )
        for (const row of rows) {
          if (known.has(row.id)) continue
          void closePage(row.id).catch(function (error: unknown) {
            console.warn('[browser] 清理残留页面失败', error)
          })
        }
        adoptLivesRef.current(
          rows.filter(function (row) {
            return known.has(row.id)
          })
        )
      } catch (error) {
        console.error('[browser] 同步已打开页面失败', error)
      }
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
    return function () {
      for (const stop of unlisten) stop()
    }
  }, [])

  useEffect(
    function () {
      const content = contentRef.current
      const shownId = pageId
      if (!content || showBlank || !shownId || !pageUrl) return
      // 内容槽的尺寸会因侧栏折叠、工具栏变化、窗口缩放而变，位置也会随之变；
      // 三个节点都盯住，统一用布局后的实测矩形重新摆位（子 WebView 不会自己跟着布局走）。
      const observer = new ResizeObserver(function () {
        if (!readyRef.current.has(shownId)) return
        placeActiveRef.current(findShownBounds())
      })
      for (const node of [content, sideRef.current, toolbarRef.current]) {
        if (node) observer.observe(node)
      }
      return function () {
        observer.disconnect()
      }
    },
    [pageId, pageUrl, showBlank]
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

  async function onImportExtension() {
    const picked = await dialogOpen({ directory: true, multiple: false })
    if (typeof picked !== 'string') return
    try {
      const result = await importExtension(picked)
      setExtensions(result.names)
      setIsExtensionSupported(result.supported)
      await reloadLive(tabsRef.current, activeIdRef.current)
      setNotice({ tone: 'ok', text: '扩展已导入，页面已重新打开' })
    } catch (error) {
      console.error('[browser] 导入扩展失败', error)
      setNotice({ tone: 'fail', text: error instanceof Error ? error.message : '导入扩展失败' })
    }
  }

  async function onRemoveExtension(name: string) {
    try {
      const result = await removeExtension(name)
      setExtensions(result.names)
      await reloadLive(tabsRef.current, activeIdRef.current)
    } catch (error) {
      console.error('[browser] 移除扩展失败', error)
      setNotice({ tone: 'fail', text: error instanceof Error ? error.message : '移除扩展失败' })
    }
  }

  // 浏览窗口自己的键位：派发器每个窗口装一份，命令由本视图注册（未挂载就不存在）。
  useKeyboard()
  useCommands([
    { id: COMMAND.BROWSER_TAB_NEW, title: '新建标签', run: createEmpty },
    {
      id: COMMAND.BROWSER_TAB_CLOSE,
      title: '关闭标签',
      when: function () {
        return Boolean(activeIdRef.current)
      },
      run: function () {
        const id = activeIdRef.current
        if (!id) return
        void closeTab(id)
      }
    },
    { id: COMMAND.BROWSER_ADDRESS_FOCUS, title: '聚焦地址栏', run: requestAddressFocus },
    {
      id: COMMAND.BROWSER_WINDOW_NEW,
      title: '新建浏览窗口',
      run: function () {
        void spawnBrowser().catch(function (error: unknown) {
          console.error('[browser] 新建浏览窗口失败', error)
        })
      }
    }
  ])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-transparent text-foreground">
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
          notice={notice}
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
        controlsTooltipSide="left"
        trailing={
          <>
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
          onHome={goBlank}
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
        />
      </BrowserBar>
        <div
          ref={contentRef}
          className="min-h-0 min-w-0 flex-1 bg-transparent">
          {showBlank ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              输入网址或搜索，Enter 打开
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export { BrowserChrome }
