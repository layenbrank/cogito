import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { useClickOutside } from '@reactuses/core'
import { clsx } from 'clsx'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { ENGINES, findEngine } from '@/constants/engine'
import { findAddressUrl, findItemUrl, parseSuggestionLabel } from '@/views/overview/engine/engine-url'
import {
  completeAddress,
  SUGGEST_BORDER,
  SUGGEST_ITEM_GAP,
  SUGGEST_PAD,
  SUGGEST_ROW,
  type SuggestFrame,
  type SuggestRow
} from '@/views/navigation/ipc'

interface AddressBarProps {
  value: string
  engineKey: string
  onValue: (value: string) => void
  onSubmit: (url: string) => void
  onEngine: (key: string) => void
  onSuggest?: (frame: SuggestFrame) => void
  joined?: boolean
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
  const { value, engineKey, onValue, onSubmit, onEngine, onSuggest, joined } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const typedRef = useRef(value)
  const pendingRef = useRef('')
  const onSuggestRef = useRef(onSuggest)
  const seqRef = useRef(0)
  const didOpenRef = useRef(false)
  const rowsRef = useRef<SuggestRow[]>([])
  const focusedRef = useRef(false)
  const hideTimerRef = useRef(0)
  const [isEngineOpen, setIsEngineOpen] = useState(false)
  const [rows, setRows] = useState<SuggestRow[]>([])
  const [active, setActive] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const engine = findEngine(engineKey)

  useEffect(function () {
    onSuggestRef.current = onSuggest
  }, [onSuggest])

  useClickOutside(rootRef, function () {
    setIsEngineOpen(false)
  })

  function hideList() {
    window.clearTimeout(hideTimerRef.current)
    setIsOpen(false)
  }

  function clearList() {
    window.clearTimeout(hideTimerRef.current)
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
    window.clearTimeout(hideTimerRef.current)
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

  useEffect(
    function () {
      const publish = onSuggestRef.current
      if (!publish) return
      const node = rootRef.current
      if (!isOpen || !node || rows.length === 0) {
        if (!didOpenRef.current) return
        didOpenRef.current = false
        publish({ open: false, x: 0, y: 0, width: 0, height: 0, rows: [], active: 0 })
        return
      }
      didOpenRef.current = true
      const rect = node.getBoundingClientRect()
      const gaps = Math.max(0, rows.length - 1) * SUGGEST_ITEM_GAP
      publish({
        open: true,
        x: rect.x,
        y: rect.y + rect.height - SUGGEST_BORDER,
        width: rect.width,
        height: SUGGEST_PAD + rows.length * SUGGEST_ROW + gaps + SUGGEST_BORDER * 2,
        rows,
        active
      })
    },
    [isOpen, rows, active]
  )

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
          joined
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
            focusedRef.current = false
            window.clearTimeout(hideTimerRef.current)
            hideTimerRef.current = window.setTimeout(hideList, 80)
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
