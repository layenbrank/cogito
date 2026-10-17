import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { emitTo, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { clsx } from 'clsx'
import { useEffect, useRef, useState, type TransitionEvent } from 'react'

import { AddressBar } from '@/views/navigation/address-bar'
import {
  BAR_ACTION,
  BAR_FRAME,
  BAR_READY,
  BAR_STATE,
  type BarFrame,
  type BarState,
  type SuggestFrame,
  type SuggestRow
} from '@/views/navigation/ipc'

const MOTION_MS = 150

function emitAction(payload: {
  kind: 'submit' | 'back' | 'forward' | 'engine' | 'menu' | 'suggest'
  url?: string
  key?: string
  open?: boolean
  x?: number
  y?: number
  width?: number
  height?: number
}) {
  void emitTo(getCurrentWindow().label, BAR_ACTION, payload)
}

function NavigationBar() {
  const [address, setAddress] = useState('')
  const [engineKey, setEngineKey] = useState('bing')
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)
  const [rows, setRows] = useState<SuggestRow[]>([])
  const [active, setActive] = useState(0)
  const [listHeight, setListHeight] = useState(0)
  const [listX, setListX] = useState(0)
  const [listY, setListY] = useState(0)
  const [listWidth, setListWidth] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'wait' | 'in' | 'out'>('idle')
  const phaseRef = useRef(phase)
  const boxRef = useRef({ x: 0, y: 0, width: 0, height: 0 })
  const closeTimerRef = useRef(0)

  function setPhaseNow(next: 'idle' | 'wait' | 'in' | 'out') {
    phaseRef.current = next
    setPhase(next)
  }

  function finishClose() {
    if (phaseRef.current !== 'out') return
    window.clearTimeout(closeTimerRef.current)
    emitAction({ kind: 'suggest', open: false })
    setPhaseNow('idle')
    setRows([])
  }

  function beginClose() {
    setPhaseNow('out')
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(finishClose, MOTION_MS + 40)
  }

  function publishSuggest(frame: SuggestFrame) {
    if (!frame.open) {
      if (phaseRef.current === 'in') {
        beginClose()
        return
      }
      if (phaseRef.current === 'out') return
      window.clearTimeout(closeTimerRef.current)
      emitAction({ kind: 'suggest', open: false })
      setPhaseNow('idle')
      setRows([])
      return
    }
    window.clearTimeout(closeTimerRef.current)
    setRows(frame.rows)
    setActive(frame.active)
    setListHeight(frame.height)
    setListX(frame.x)
    setListY(frame.y)
    setListWidth(frame.width)
    const same =
      boxRef.current.height === frame.height &&
      boxRef.current.x === frame.x &&
      boxRef.current.y === frame.y &&
      boxRef.current.width === frame.width
    boxRef.current = { x: frame.x, y: frame.y, width: frame.width, height: frame.height }
    if (phaseRef.current === 'out') {
      setPhaseNow('in')
      if (!same) {
        emitAction({
          kind: 'suggest',
          open: true,
          x: frame.x,
          y: frame.y,
          width: frame.width,
          height: frame.height
        })
      }
      return
    }
    if ((phaseRef.current === 'in' || phaseRef.current === 'wait') && same) return
    if (phaseRef.current !== 'in') setPhaseNow('wait')
    emitAction({
      kind: 'suggest',
      open: true,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height
    })
  }

  useEffect(function () {
    const stops: Array<() => void> = []
    void listen<BarState>(BAR_STATE, function (event) {
      setAddress(event.payload.address)
      setEngineKey(event.payload.engineKey)
      setCanBack(event.payload.canBack)
      setCanForward(event.payload.canForward)
    }).then(function (stop) {
      stops.push(stop)
    })
    void listen<BarFrame>(BAR_FRAME, function (event) {
      if (!event.payload.shown || phaseRef.current !== 'wait') return
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          if (phaseRef.current !== 'wait') return
          setPhaseNow('in')
        })
      })
    }).then(function (stop) {
      stops.push(stop)
    })
    void emitTo(getCurrentWindow().label, BAR_READY, {})
    return function () {
      for (const stop of stops) stop()
    }
  }, [])

  function onListTransition(event: TransitionEvent<HTMLDivElement>) {
    if (event.propertyName !== 'height') return
    finishClose()
  }

  const listVisible = phase !== 'idle' && rows.length > 0

  return (
    <div className="relative h-full bg-transparent">
      <div className="relative flex h-[72px] items-center gap-2 bg-background px-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="后退"
          disabled={!canBack}
          onClick={function () {
            emitAction({ kind: 'back' })
          }}>
          <Icon
            icon="lucide:arrow-left"
            aria-hidden
          />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="前进"
          disabled={!canForward}
          onClick={function () {
            emitAction({ kind: 'forward' })
          }}>
          <Icon
            icon="lucide:arrow-right"
            aria-hidden
          />
        </Button>
        <AddressBar
          key={engineKey}
          value={address}
          engineKey={engineKey}
          onValue={setAddress}
          onSubmit={function (url) {
            emitAction({ kind: 'submit', url })
          }}
          onEngine={function (key) {
            setEngineKey(key)
            emitAction({ kind: 'engine', key })
          }}
          onEngineMenu={function (anchor) {
            emitAction({ kind: 'menu', open: anchor.open, x: anchor.x, y: anchor.y })
          }}
          onSuggest={publishSuggest}
          joined={phase === 'in'}
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border/50" />
      </div>
      {listVisible ? (
        <div
          className={clsx(
            'absolute z-10 box-border overflow-hidden rounded-b-[18px] border-x border-t border-b border-ring border-t-border bg-popover text-popover-foreground shadow-md transition-[height,opacity] duration-150 ease-[ease] motion-reduce:transition-none',
            phase === 'in' ? 'opacity-100' : 'opacity-0'
          )}
          style={{
            top: listY,
            left: listX,
            width: listWidth,
            height: phase === 'in' ? listHeight : 0
          }}
          onTransitionEnd={onListTransition}>
          <div className="flex flex-col gap-1 p-1.5">
            {rows.map(function (row, index) {
              const isActive = index === active
              return (
                <button
                  key={`${row.url}-${index}`}
                  type="button"
                  aria-selected={isActive}
                  className={clsx(
                    'flex min-h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm text-foreground',
                    isActive ? 'bg-primary/15' : 'hover:bg-muted'
                  )}
                  onMouseDown={function (event) {
                    event.preventDefault()
                  }}
                  onClick={function () {
                    emitAction({ kind: 'submit', url: row.url })
                  }}>
                  <Icon
                    icon="lucide:search"
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export { NavigationBar }
