import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { emitTo, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useClickOutside } from '@reactuses/core'
import { clsx } from 'clsx'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { ENGINES, findEngine } from '@/constants/engine'
import { findPopupLabel } from '@/features/window/kind'
import { findAddressUrl, findItemUrl, parseSuggestionLabel } from '@/views/browser/engine/engine-url'
import { onAddressFocus } from '@/views/navigation/address-focus'
import {
  closePopup,
  completeAddress,
  openPopup,
  SUGGEST_BORDER,
  SUGGEST_DISMISS,
  SUGGEST_FRAME,
  SUGGEST_ITEM_GAP,
  SUGGEST_PAD,
  SUGGEST_PICK,
  SUGGEST_READY,
  SUGGEST_ROW,
  SUGGEST_SHADOW,
  type Bounds,
  type SuggestRow
} from '@/views/navigation/ipc'

interface AddressBarProps {
  value: string
  engineKey: string
  onValue: (value: string) => void
  onSubmit: (url: string) => void
  onEngine: (key: string) => void
}

function EngineStrip(props: { engineKey: string; isOpen: boolean; onPick: (key: string) => void }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(function () {
    const track = trackRef.current
    if (!track) return
    function measure() {
      const element = trackRef.current
      if (!element) return
      setWidth(element.scrollWidth)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    return function () {
      observer.disconnect()
    }
  }, [])

  return (
    <div
      aria-hidden={!props.isOpen}
      className={clsx(
        'overflow-hidden transition-[width,opacity] duration-200 ease-[ease] motion-reduce:transition-none',
        props.isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
      )}
      style={{ width: props.isOpen ? width : 0 }}>
      <div
        ref={trackRef}
        role="listbox"
        aria-label="搜索引擎"
        className="flex w-max items-center gap-0.5">
        {ENGINES.map(function (item) {
          const isSelected = item.key === props.engineKey
          return (
            <button
              key={item.key}
              type="button"
              data-region="false"
              role="option"
              aria-selected={isSelected}
              tabIndex={props.isOpen ? 0 : -1}
              className={clsx(
                'flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs',
                isSelected ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'
              )}
              onMouseDown={function (event) {
                event.preventDefault()
              }}
              onClick={function () {
                props.onPick(item.key)
              }}>
              <Icon
                icon={item.icon}
                className="size-3.5"
                aria-hidden
              />
              {item.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function AddressBar(props: AddressBarProps) {
  const { value, engineKey, onValue, onSubmit, onEngine } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const typedRef = useRef(value)
  const pendingRef = useRef('')
  const seqRef = useRef(0)
  const didOpenRef = useRef(false)
  const rowsRef = useRef<SuggestRow[]>([])
  const activeRef = useRef(0)
  const geometryRef = useRef<Bounds | null>(null)
  const focusedRef = useRef(false)
  const submitUrlRef = useRef<(url: string) => void>(function () {})
  const clearListRef = useRef(function () {})
  const sendFrameRef = useRef(function () {})
  const [isEngineOpen, setIsEngineOpen] = useState(false)
  const [rows, setRows] = useState<SuggestRow[]>([])
  const [active, setActive] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const engine = findEngine(engineKey)

  useClickOutside(rootRef, function () {
    setIsEngineOpen(false)
    setIsOpen(false)
  })

  // 浮层是独立的 owned 窗口，位置按屏幕坐标算好；窗口一动就对不上。
  useEffect(function () {
    function close() {
      setIsOpen(false)
    }
    window.addEventListener('resize', close)
    let stop: (() => void) | undefined
    void getCurrentWindow()
      .onMoved(close)
      .then(function (off) {
        stop = off
      })
      .catch(function (error: unknown) {
        console.warn('[navigation] 监听窗口移动失败', error)
      })
    return function () {
      window.removeEventListener('resize', close)
      stop?.()
    }
  }, [])

  function hideList() {
    setIsOpen(false)
  }

  function clearList() {
    seqRef.current += 1
    rowsRef.current = []
    setRows([])
    setActive(0)
    setIsOpen(false)
  }

  function applyRows(next: SuggestRow[]) {
    rowsRef.current = next
    setRows(next)
    setActive(0)
    setIsOpen(next.length > 0 && focusedRef.current)
  }

  function reopenList() {
    if (rowsRef.current.length === 0) return
    setIsOpen(true)
  }

  function submitUrl(url: string) {
    if (!url) return
    clearList()
    setIsEngineOpen(false)
    onSubmit(url)
  }

  function submit() {
    const row = rows[active]
    submitUrl(row?.url || findAddressUrl(value, engine.match))
  }

  useEffect(
    function () {
      if (value === typedRef.current) return
      typedRef.current = value
      pendingRef.current = ''
      clearList()
    },
    [value]
  )

  useEffect(
    function () {
      const keyword = value.trim()
      if (!keyword || value !== pendingRef.current) return
      const seq = seqRef.current + 1
      seqRef.current = seq
      const timer = window.setTimeout(function () {
        const typed = findAddressUrl(keyword, engine.match)
        void completeAddress(keyword)
          .then(function (result) {
            if (seq !== seqRef.current) return
            const next: SuggestRow[] = []
            if (typed) next.push({ label: keyword, url: typed })
            for (const item of result.s) {
              const label = parseSuggestionLabel(item.q).trim()
              if (!label) continue
              const url = item.u ? findItemUrl(engine, item) : findAddressUrl(label, engine.match)
              if (!url || url === typed) continue
              next.push({ label, url })
            }
            applyRows(next)
          })
          .catch(function (error: unknown) {
            if (seq !== seqRef.current) return
            console.error('[navigation] 搜索建议失败', error)
            if (!typed) {
              clearList()
              return
            }
            applyRows([{ label: keyword, url: typed }])
          })
      }, 300)
      return function () {
        window.clearTimeout(timer)
      }
    },
    [value, engine]
  )

  function sendFrame() {
    const geometry = geometryRef.current
    if (!geometry || rowsRef.current.length === 0) return
    void emitTo(findPopupLabel(), SUGGEST_FRAME, {
      open: true,
      ...geometry,
      rows: rowsRef.current,
      active: activeRef.current
    }).catch(function (error: unknown) {
      console.warn('[navigation] 推送建议列表失败', error)
    })
  }

  useEffect(function () {
    activeRef.current = active
    submitUrlRef.current = submitUrl
    clearListRef.current = clearList
    sendFrameRef.current = sendFrame
  })

  // 键位命令只能通过信号找到输入框：聚焦并全选，列表由 onFocus 重新拉起。
  useEffect(function () {
    return onAddressFocus(function () {
      const input = inputRef.current
      if (!input) return
      input.focus()
      input.select()
    })
  }, [])

  // 浮层只负责显示：矩形在这里算好交给原生层，网页本身既不移动也不缩放。
  useEffect(
    function () {
      if (!isOpen || rows.length === 0) {
        geometryRef.current = null
        if (!didOpenRef.current) return
        didOpenRef.current = false
        void closePopup().catch(function (error: unknown) {
          console.warn('[navigation] 关闭建议浮层失败', error)
        })
        return
      }
      const node = rootRef.current
      if (!node) return
      const rect = node.getBoundingClientRect()
      const gaps = Math.max(0, rows.length - 1) * SUGGEST_ITEM_GAP
      geometryRef.current = {
        x: rect.x - SUGGEST_SHADOW,
        y: rect.y + rect.height - SUGGEST_BORDER,
        width: rect.width + SUGGEST_SHADOW * 2,
        height: SUGGEST_PAD + rows.length * SUGGEST_ROW + gaps + SUGGEST_BORDER * 2 + SUGGEST_SHADOW
      }
      didOpenRef.current = true
      void openPopup(geometryRef.current).then(
        function () {
          sendFrameRef.current()
        },
        function (error: unknown) {
          console.warn('[navigation] 打开建议浮层失败', error)
        }
      )
    },
    [isOpen, rows]
  )

  // 内容变化（新一批建议 / 上下键）只推帧，不碰原生矩形。
  useEffect(
    function () {
      if (!isOpen) return
      sendFrameRef.current()
    },
    [isOpen, rows, active]
  )

  // 浮层首次就绪时向宿主要一次当前建议：建 WebView 与首次推帧之间有竞态。
  useEffect(function () {
    const stops: Array<() => void> = []
    void listen(SUGGEST_READY, function () {
      sendFrameRef.current()
    }).then(function (stop) {
      stops.push(stop)
    })
    void listen<{ url: string }>(SUGGEST_PICK, function (event) {
      submitUrlRef.current(event.payload.url)
    }).then(function (stop) {
      stops.push(stop)
    })
    void listen(SUGGEST_DISMISS, function () {
      clearListRef.current()
    }).then(function (stop) {
      stops.push(stop)
    })
    return function () {
      for (const stop of stops) stop()
      if (!didOpenRef.current) return
      didOpenRef.current = false
      void closePopup().catch(function (error: unknown) {
        console.warn('[navigation] 关闭建议浮层失败', error)
      })
    }
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' && isOpen) {
      event.preventDefault()
      setActive(function (index) {
        return Math.min(index + 1, rows.length - 1)
      })
    }
    if (event.key === 'ArrowUp' && isOpen) {
      event.preventDefault()
      setActive(function (index) {
        return Math.max(index - 1, 0)
      })
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
    }
    if (event.key === 'Escape') {
      hideList()
      setIsEngineOpen(false)
    }
  }

  return (
    <div
      ref={rootRef}
      className="relative min-w-0 flex-1">
      <div
        className={clsx(
          'box-border flex h-10 items-center border transition-[background-color,border-color,border-radius,box-shadow] duration-150 ease-[ease] motion-reduce:transition-none',
          isOpen
            ? 'rounded-t-[18px] rounded-b-none border-ring border-b-transparent bg-background shadow-none'
            : 'rounded-full border-transparent bg-muted shadow-none focus-within:border-ring focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/25'
        )}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-region="false"
          aria-label="搜索引擎"
          aria-expanded={isEngineOpen}
          title={engine.label}
          className="ml-1 rounded-full"
          onMouseDown={function (event) {
            event.preventDefault()
          }}
          onClick={function () {
            hideList()
            setIsEngineOpen(function (open) {
              return !open
            })
          }}>
          <Icon
            icon={engine.icon}
            aria-hidden
          />
        </Button>
        <EngineStrip
          engineKey={engine.key}
          isOpen={isEngineOpen}
          onPick={function (key) {
            onEngine(key)
            setIsEngineOpen(false)
          }}
        />
        <Input
          ref={inputRef}
          value={value}
          data-region="false"
          placeholder="搜索或输入网址"
          aria-label="网址"
          className="h-full flex-1 border-0 bg-transparent px-2 py-0 shadow-none focus-visible:ring-0"
          onChange={function (event) {
            const next = event.target.value
            typedRef.current = next
            pendingRef.current = next
            onValue(next)
            if (!next.trim()) clearList()
            setIsEngineOpen(false)
          }}
          onKeyDown={onKeyDown}
          onFocus={function () {
            focusedRef.current = true
            reopenList()
          }}
          onBlur={function () {
            // 列表在原生浮层里，点它会让输入框失焦。这里不能立即收起，
            // 否则点击会被吞掉；收起交给 Esc / 回车 / 点击外部 / 浮层失焦。
            focusedRef.current = false
          }}
          onClick={reopenList}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-region="false"
          aria-label="搜索"
          className="mr-1 rounded-full"
          onMouseDown={function (event) {
            event.preventDefault()
          }}
          onClick={submit}>
          <Icon
            icon="lucide:search"
            aria-hidden
          />
        </Button>
      </div>
    </div>
  )
}

export { AddressBar }
