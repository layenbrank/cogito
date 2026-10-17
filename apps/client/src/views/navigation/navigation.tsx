import { clsx } from 'clsx'
import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { emitTo, listen } from '@tauri-apps/api/event'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { toast } from 'sonner'

import { Decorations } from '@/components/decorations/index.ts'
import { Glide } from '@/components/glide/glide'
import { ENGINE_STORE_KEY, ENGINES } from '@/constants/engine'
import { readEngineKey, writeEngineKey } from '@/views/overview/engine/engine-store'
import {
  BAR_ACTION,
  BAR_FRAME,
  BAR_LABEL,
  BAR_READY,
  BAR_STATE,
  activatePage,
  closePage,
  historyPage,
  importExtension,
  navigatePage,
  openBar,
  openDevtools,
  openPage,
  placeBar,
  placePage,
  readExtensions,
  removeExtension,
  type BarAction,
  type BarPlace,
  type BarState,
  type Bounds
} from '@/views/navigation/ipc'
import { readSession, writeSession, type Tab } from '@/views/navigation/session'

interface DownloadItem {
  id: string
  url: string
  name: string
  status: 'started' | 'done' | 'failed'
  path?: string
}

interface PageEvent {
  id: string
  url: string
}

interface TitleEvent {
  id: string
  title: string
}

interface PopupEvent {
  url: string
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

function findHost(url: string) {
  if (!url) return '新标签'
  try {
    return new URL(url).hostname || url
  } catch (error) {
    console.error('[navigation] 网址无法解析', error)
    return url
  }
}

function findBounds(node: HTMLElement | null): Bounds {
  if (!node) return { x: 0, y: 0, width: 1, height: 1 }
  const rect = node.getBoundingClientRect()
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

function createTab(url: string): Tab {
  return {
    id: crypto.randomUUID(),
    url,
    title: url ? findHost(url) : '新标签'
  }
}

export default function Navigation() {
  const contentRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const listRef = useRef({ extra: 0, x: 0, y: 0, width: 0, height: 0 })
  const placeBarRef = useRef(async function () {})
  const dragIndex = useRef(-1)
  const tabsRef = useRef<Tab[]>([])
  const activeIdRef = useRef('')
  const focusUrlRef = useRef<(url: string) => void>(function () {})
  const liveRef = useRef(new Set<string>())
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState('')
  const [address, setAddress] = useState('')
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [extensions, setExtensions] = useState<string[]>([])
  const [isExtensionSupported, setIsExtensionSupported] = useState(false)
  const [panel, setPanel] = useState<'downloads' | 'extensions' | ''>('')
  const [engineKey, setEngineKey] = useState(readEngineKey)
  const [engineMenu, setEngineMenu] = useState<{ x: number; y: number } | null>(null)
  const [isReady, setIsReady] = useState(false)
  const addressRef = useRef(address)
  const engineKeyRef = useRef(engineKey)
  const openAddressRef = useRef<(url: string) => void>(function () {})
  const chooseEngineRef = useRef<(key: string) => void>(function () {})

  const active = tabs.find(function (tab) {
    return tab.id === activeId
  })

  async function showPage(id: string, url: string) {
    if (!url) return
    const bounds = findBounds(contentRef.current)
    await openPage(id, url)
    liveRef.current.add(id)
    await activatePage(id, bounds)
  }

  async function reopenPages(next: Tab[], nextActiveId: string) {
    for (const tab of next) {
      if (!tab.url) continue
      liveRef.current.delete(tab.id)
      await closePage(tab.id)
    }
    for (const tab of next) {
      if (tab.url) {
        await openPage(tab.id, tab.url)
        liveRef.current.add(tab.id)
      }
    }
    const current = next.find(function (tab) {
      return tab.id === nextActiveId
    })
    if (current?.url) await activatePage(current.id, findBounds(contentRef.current))
  }

  function focusUrl(url: string) {
    const found = tabsRef.current.find(function (tab) {
      return tab.url === url
    })
    if (found) {
      setActiveId(found.id)
      setAddress(found.url)
      void showPage(found.id, found.url)
      return
    }
    const tab = createTab(url)
    setTabs(function (current) {
      return [...current, tab]
    })
    setActiveId(tab.id)
    setAddress(url)
    void showPage(tab.id, url)
  }

  useEffect(function () {
    tabsRef.current = tabs
    activeIdRef.current = activeId
    addressRef.current = address
    engineKeyRef.current = engineKey
    openAddressRef.current = openAddress
    chooseEngineRef.current = chooseEngine
    focusUrlRef.current = focusUrl
  })

  useEffect(
    function () {
      if (!isReady) return
      const timer = window.setTimeout(function () {
        void writeSession({ tabs, activeId })
      }, 300)
      return function () {
        window.clearTimeout(timer)
      }
    },
    [tabs, activeId, isReady]
  )

  useEffect(function () {
    let stopped = false
    void (async function () {
      const session = await readSession()
      const incoming = new URLSearchParams(location.search).get('url') ?? ''
      let next = session.tabs
      let nextActive = session.activeId
      if (incoming) {
        const found = next.find(function (tab) {
          return tab.url === incoming
        })
        if (found) nextActive = found.id
        else {
          const tab = createTab(incoming)
          next = [...next, tab]
          nextActive = tab.id
        }
      }
      if (stopped) return
      setTabs(next)
      setActiveId(nextActive)
      const current = next.find(function (tab) {
        return tab.id === nextActive
      })
      setAddress(current?.url ?? '')
      setIsReady(true)
      try {
        for (const tab of next) {
          if (!tab.url) continue
          await openPage(tab.id, tab.url)
          liveRef.current.add(tab.id)
        }
        if (current?.url) await activatePage(current.id, findBounds(contentRef.current))
      } catch (error) {
        console.error('[navigation] 打开页面失败', error)
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
    void listen<PopupEvent>('navigation://popup', function (event) {
      focusUrlRef.current(event.payload.url)
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
      if (event.payload.url) focusUrlRef.current(event.payload.url)
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
      if (!node || !active?.url) return
      const pageId = active.id
      const observer = new ResizeObserver(function () {
        if (!liveRef.current.has(pageId)) return
        void placePage(pageId, findBounds(node))
      })
      observer.observe(node)
      return function () {
        observer.disconnect()
      }
    },
    [active?.id, active?.url]
  )

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
    setTabs(function (current) {
      const copy = current.slice()
      const [item] = copy.splice(dragIndex.current, 1)
      if (!item) return current
      copy.splice(next, 0, item)
      return copy
    })
    dragIndex.current = next
  }

  function onTabPointerUp() {
    dragIndex.current = -1
  }

  function selectTab(tab: Tab) {
    setActiveId(tab.id)
    setAddress(tab.url)
    void showPage(tab.id, tab.url)
  }

  async function closeTab(id: string) {
    const next = tabsRef.current.filter(function (tab) {
      return tab.id !== id
    })
    const closing = tabsRef.current.find(function (tab) {
      return tab.id === id
    })
    if (closing?.url) {
      liveRef.current.delete(id)
      await closePage(id)
    }
    setTabs(next)
    if (activeIdRef.current !== id) return
    const fallback = next[next.length - 1]
    setActiveId(fallback?.id ?? '')
    setAddress(fallback?.url ?? '')
    if (fallback?.url) await showPage(fallback.id, fallback.url)
  }

  function openAddress(url: string) {
    if (!url) return
    if (!active) {
      focusUrl(url)
      return
    }
    const next = tabsRef.current.map(function (tab) {
      if (tab.id !== active.id) return tab
      return { ...tab, url, title: tab.title || findHost(url) }
    })
    setTabs(next)
    setAddress(url)
    if (active.url) void navigatePage(active.id, url)
    else void showPage(active.id, url)
  }

  function chooseEngine(key: string) {
    setEngineKey(key)
    writeEngineKey(key)
    setEngineMenu(null)
  }

  function publishBar() {
    const current = tabsRef.current.find(function (tab) {
      return tab.id === activeIdRef.current
    })
    const payload: BarState = {
      address: addressRef.current,
      canBack: Boolean(current?.url),
      canForward: Boolean(current?.url),
      engineKey: engineKeyRef.current
    }
    void emitTo(BAR_LABEL, BAR_STATE, payload)
  }

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

  useEffect(
    function () {
      void emitTo(BAR_LABEL, BAR_STATE, {
        address,
        canBack: Boolean(active?.url),
        canForward: Boolean(active?.url),
        engineKey
      } satisfies BarState)
    },
    [address, active?.url, engineKey]
  )

  useEffect(function () {
    const stops: Array<() => void> = []
    void listen(BAR_READY, function () {
      publishBar()
    }).then(function (stop) {
      stops.push(stop)
    })
    void listen<BarAction>(BAR_ACTION, function (event) {
      const action = event.payload
      const current = tabsRef.current.find(function (tab) {
        return tab.id === activeIdRef.current
      })
      if (action.kind === 'submit' && action.url) {
        setEngineMenu(null)
        openAddressRef.current(action.url)
        return
      }
      if (action.kind === 'back' && current?.url) {
        void historyPage(current.id, 'back')
        return
      }
      if (action.kind === 'forward' && current?.url) {
        void historyPage(current.id, 'forward')
        return
      }
      if (action.kind === 'engine' && action.key) {
        chooseEngineRef.current(action.key)
        return
      }
      if (action.kind === 'menu') {
        if (!action.open) {
          setEngineMenu(null)
          return
        }
        const slot = barRef.current?.getBoundingClientRect()
        if (!slot) return
        setEngineMenu({ x: slot.x + (action.x ?? 0), y: slot.y })
        return
      }
      if (action.kind === 'suggest') {
        if (!action.open || !action.height) {
          listRef.current = { extra: 0, x: 0, y: 0, width: 0, height: 0 }
        } else {
          const top = action.y ?? 0
          listRef.current = {
            extra: Math.max(0, top + action.height - (barRef.current?.getBoundingClientRect().height ?? top)),
            x: action.x ?? 0,
            y: top,
            width: action.width ?? 0,
            height: action.height
          }
        }
        void placeBarRef.current().catch(function (error: unknown) {
          console.error('[navigation] 候选列表失败', error)
        })
      }
    }).then(function (stop) {
      stops.push(stop)
    })
    return function () {
      for (const stop of stops) stop()
    }
  }, [])

  useEffect(function () {
    const node = barRef.current
    if (!node) return
    let chain = Promise.resolve()
    let opened = false
    function sync() {
      chain = chain
        .then(async function () {
          const rect = node.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) return
          if (!opened) {
            await openBar()
            opened = true
          }
          const list = listRef.current
          const body: BarPlace = {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height + list.extra,
            toolbar: rect.height,
            listX: list.x,
            listY: list.y,
            listWidth: list.width,
            listHeight: list.height
          }
          await placeBar(body)
          void emitTo(BAR_LABEL, BAR_FRAME, { shown: list.extra > 0 })
        })
        .catch(function (error: unknown) {
          console.error('[navigation] 地址栏嵌入失败', error)
        })
    }
    placeBarRef.current = function () {
      sync()
      return chain
    }
    const observer = new ResizeObserver(function () {
      sync()
    })
    observer.observe(node)
    sync()
    return function () {
      observer.disconnect()
    }
  }, [])

  async function onImportExtension() {
    const picked = await dialogOpen({ directory: true, multiple: false })
    if (typeof picked !== 'string') return
    try {
      const result = await importExtension(picked)
      setExtensions(result.names)
      setIsExtensionSupported(result.supported)
      await reopenPages(tabsRef.current, activeIdRef.current)
      toast.success('扩展已导入，页面已重新打开')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入扩展失败')
    }
  }

  async function onRemoveExtension(name: string) {
    try {
      const result = await removeExtension(name)
      setExtensions(result.names)
      await reopenPages(tabsRef.current, activeIdRef.current)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '移除扩展失败')
    }
  }

  return (
    <Decorations
      scrollable={false}
      final={
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="下载"
            onClick={function () {
              setPanel(function (current) {
                return current === 'downloads' ? '' : 'downloads'
              })
            }}>
            <Icon
              icon="lucide:download"
              aria-hidden
            />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="扩展"
            onClick={function () {
              setPanel(function (current) {
                return current === 'extensions' ? '' : 'extensions'
              })
            }}>
            <Icon
              icon="lucide:puzzle"
              aria-hidden
            />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="开发者工具"
            disabled={!active?.url}
            onClick={function () {
              if (active?.url) void openDevtools(active.id)
            }}>
            <Icon
              icon="lucide:bug"
              aria-hidden
            />
          </Button>
        </div>
      }>
      <div className="flex h-11 shrink-0 items-center gap-1 bg-muted/40 px-2">
        <Glide.X className="h-8 min-w-0 flex-1">
          {tabs.map(function (tab, index) {
            const isActive = tab.id === activeId
            return (
              <div
                key={tab.id}
                className={clsx(
                  'flex h-8 max-w-56 min-w-28 items-center rounded-lg',
                  isActive
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-background/80 hover:text-foreground'
                )}>
                <button
                  type="button"
                  data-tab-index={index}
                  aria-selected={isActive}
                  className="min-w-0 flex-1 truncate px-3 text-left text-sm"
                  onPointerDown={function (event) {
                    onTabPointerDown(event, index)
                  }}
                  onPointerMove={onTabPointerMove}
                  onPointerUp={onTabPointerUp}
                  onClick={function () {
                    selectTab(tab)
                  }}>
                  {tab.title || findHost(tab.url)}
                </button>
                <button
                  type="button"
                  aria-label="关闭标签"
                  className="mr-1 flex size-5 shrink-0 items-center justify-center rounded-full text-sm hover:bg-foreground/10"
                  onPointerDown={function (event) {
                    event.stopPropagation()
                  }}
                  onClick={function () {
                    void closeTab(tab.id)
                  }}>
                  ×
                </button>
              </div>
            )
          })}
        </Glide.X>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="新建标签"
          onClick={function () {
            const tab = createTab('')
            setTabs(function (current) {
              return [...current, tab]
            })
            setActiveId(tab.id)
            setAddress('')
          }}>
          <Icon
            icon="lucide:plus"
            aria-hidden
          />
        </Button>
      </div>
      <div
        ref={barRef}
        className="flex h-[72px] shrink-0 items-center px-2">
        <div className="h-9 w-full" />
      </div>
      {engineMenu ? (
        <div
          className="fixed z-20 w-36 -translate-y-[calc(100%+4px)] overflow-hidden rounded-lg border border-border/70 bg-popover py-1 shadow-md"
          style={{ left: engineMenu.x, top: engineMenu.y }}>
          {ENGINES.map(function (item) {
            const isSelected = item.key === engineKey
            return (
              <button
                key={item.key}
                type="button"
                className={clsx(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                  isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
                )}
                onClick={function () {
                  chooseEngine(item.key)
                }}>
                <Icon
                  icon={item.icon}
                  aria-hidden
                />
                {item.label}
              </button>
            )
          })}
        </div>
      ) : null}
      {panel === 'downloads' ? (
        <div className="max-h-40 shrink-0 overflow-auto border-b border-border/50 px-3 py-2 text-sm">
          {downloads.length === 0 ? (
            <p className="text-muted-foreground">暂无下载</p>
          ) : (
            downloads.map(function (item) {
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 py-1">
                  <span className="truncate">{item.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {item.status === 'started' ? '下载中' : item.status === 'done' ? '完成' : '失败'}
                  </span>
                  {item.path ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={function () {
                        const path = item.path
                        if (path) void revealItemInDir(path)
                      }}>
                      在文件夹中显示
                    </Button>
                  ) : null}
                </div>
              )
            })
          )}
        </div>
      ) : null}
      {panel === 'extensions' ? (
        <div className="max-h-48 shrink-0 overflow-auto border-b border-border/50 px-3 py-2 text-sm">
          <p className="mb-2 text-muted-foreground">
            {isExtensionSupported
              ? '扩展放在应用数据目录 extensions。导入后会重新打开页面。'
              : '当前系统不能加载 Chrome 扩展。'}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={!isExtensionSupported}
            onClick={function () {
              void onImportExtension()
            }}>
            导入解压扩展
          </Button>
          <ul className="mt-2 space-y-1">
            {extensions.map(function (name) {
              return (
                <li
                  key={name}
                  className="flex items-center justify-between gap-3">
                  <span className="truncate">{name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={function () {
                      void onRemoveExtension(name)
                    }}>
                    移除
                  </Button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
      <div
        ref={contentRef}
        className="min-h-0 flex-1">
        {active?.url ? null : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {tabs.length === 0 ? '未打开网址' : '输入网址后打开'}
          </div>
        )}
      </div>
    </Decorations>
  )
}
