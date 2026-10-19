import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { LAYER_OVERLAY } from '@i-thinking/design/lib/surface'
import { clsx } from 'clsx'
import { useEffect, useRef, useState, type TransitionEvent } from 'react'

import { isUrlKeyword } from '@/views/overview/engine/engine-url'
import { AddressBar } from '@/views/navigation/address-bar'
import type { Bounds, SuggestFrame, SuggestRow } from '@/views/navigation/ipc'

interface OmniboxProps {
  address: string
  engineKey: string
  canBack: boolean
  canForward: boolean
  onAddress: (value: string) => void
  onSubmit: (url: string, query?: string) => void
  onEngine: (key: string) => void
  onHome: () => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  /** 建议列表在窗口中的矩形。页面边界不变，由原生窗口在这块挖空。 */
  onCover: (rect: Bounds | null) => void
}

const MOTION_MS = 150

function Omnibox(props: OmniboxProps) {
  const fieldRef = useRef<HTMLDivElement>(null)
  const onCoverRef = useRef(props.onCover)
  const [rows, setRows] = useState<SuggestRow[]>([])
  const [active, setActive] = useState(0)
  const [listHeight, setListHeight] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'wait' | 'in' | 'out'>('idle')
  const phaseRef = useRef(phase)
  const closeTimerRef = useRef(0)

  useEffect(function () {
    onCoverRef.current = props.onCover
  }, [props.onCover])

  function setPhaseNow(next: 'idle' | 'wait' | 'in' | 'out') {
    phaseRef.current = next
    setPhase(next)
  }

  function findCover(height: number): Bounds | null {
    const field = fieldRef.current
    if (!field || height <= 0) return null
    const rect = field.getBoundingClientRect()
    return {
      x: rect.left,
      y: rect.bottom,
      width: rect.width,
      height
    }
  }

  function finishClose() {
    if (phaseRef.current !== 'out') return
    window.clearTimeout(closeTimerRef.current)
    setPhaseNow('idle')
    setRows([])
    onCoverRef.current(null)
  }

  function beginClose() {
    setPhaseNow('out')
    onCoverRef.current(null)
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
      setPhaseNow('idle')
      setRows([])
      onCoverRef.current(null)
      return
    }
    window.clearTimeout(closeTimerRef.current)
    setRows(frame.rows)
    setActive(frame.active)
    setListHeight(frame.height)
    onCoverRef.current(findCover(frame.height))
    if (phaseRef.current === 'out' || phaseRef.current === 'idle') setPhaseNow('wait')
  }

  useEffect(
    function () {
      if (phase !== 'wait') return
      const frame = window.requestAnimationFrame(function () {
        if (phaseRef.current !== 'wait') return
        setPhaseNow('in')
      })
      return function () {
        window.cancelAnimationFrame(frame)
      }
    },
    [phase, rows, listHeight]
  )

  useEffect(function () {
    return function () {
      onCoverRef.current(null)
    }
  }, [])

  function onListTransition(event: TransitionEvent<HTMLDivElement>) {
    if (event.propertyName !== 'opacity') return
    finishClose()
  }

  function submit(url: string) {
    const keyword = props.address.trim()
    props.onSubmit(url, keyword && !isUrlKeyword(keyword) ? keyword : undefined)
  }

  const listVisible = phase !== 'idle' && rows.length > 0

  return (
    <div className="relative flex h-full min-w-0 flex-1 items-center px-1">
      <div className="flex shrink-0 items-center">
        <Button
          variant="ghost"
          size="icon"
          data-region="false"
          className="size-10 min-w-10 rounded-full [&_svg]:size-4.5"
          aria-label="后退"
          disabled={!props.canBack}
          onClick={props.onBack}>
          <Icon
            icon="lucide:arrow-left"
            aria-hidden
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-region="false"
          className="size-10 min-w-10 rounded-full [&_svg]:size-4.5"
          aria-label="前进"
          disabled={!props.canForward}
          onClick={props.onForward}>
          <Icon
            icon="lucide:arrow-right"
            aria-hidden
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-region="false"
          className="size-10 min-w-10 rounded-full [&_svg]:size-4.5"
          aria-label="重新加载"
          disabled={!props.canBack}
          onClick={props.onReload}>
          <Icon
            icon="lucide:rotate-cw"
            aria-hidden
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-region="false"
          className="size-10 min-w-10 rounded-full [&_svg]:size-4.5"
          aria-label="主页"
          onClick={props.onHome}>
          <Icon
            icon="lucide:house"
            aria-hidden
          />
        </Button>
      </div>
      <div
        ref={fieldRef}
        className="relative ml-1 min-w-48 flex-1">
        <AddressBar
          value={props.address}
          engineKey={props.engineKey}
          onValue={props.onAddress}
          onSubmit={submit}
          onEngine={props.onEngine}
          onSuggest={publishSuggest}
          joined={phase === 'in'}
        />
        {listVisible ? (
          <div
            data-layer={LAYER_OVERLAY}
            className={clsx(
              'absolute z-30 box-border overflow-hidden rounded-b-[18px] border border-ring bg-popover text-popover-foreground shadow-md transition-opacity duration-150 ease-[ease] motion-reduce:transition-none',
              phase === 'in' ? 'opacity-100' : 'opacity-0'
            )}
            style={{
              top: '100%',
              left: 0,
              right: 0,
              height: listHeight
            }}
            onTransitionEnd={onListTransition}>
            <div className="flex flex-col gap-1 p-1.5">
              {rows.map(function (row, index) {
                const isActive = index === active
                return (
                  <button
                    key={`${row.url}-${index}`}
                    type="button"
                    data-region="false"
                    aria-selected={isActive}
                    className={clsx(
                      'flex min-h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm text-foreground',
                      isActive ? 'bg-primary/15' : 'hover:bg-muted'
                    )}
                    onMouseDown={function (event) {
                      event.preventDefault()
                    }}
                    onClick={function () {
                      submit(row.url)
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
    </div>
  )
}

export { Omnibox }
