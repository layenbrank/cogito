/**
 * 地址建议浮层。
 *
 * 跑在独立的子 WebView 里（label `navigation-popup-<宿主>`），只做两件事：画列表、把选择交回宿主。
 * 它之所以是独立视图，是因为主壳里的 DOM 盖不住原生网页——列表要浮在网页上，
 * 就必须本身也是一层原生视图，否则只能靠改 z 序硬抢，抖动全部来自那里。
 */
import { Icon } from '@iconify/react/offline'
import { emitTo, listen } from '@tauri-apps/api/event'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'

import {
  SUGGEST_DISMISS,
  SUGGEST_FRAME,
  SUGGEST_PICK,
  SUGGEST_READY,
  type SuggestFrame
} from '@/views/navigation/ipc'

/**
 * 宿主浏览窗口的 label。
 *
 * 浮层可以有多个（每扇浏览窗口一个），所以宿主不写死：Rust 建浮层时把它注入进来。
 * 拿不到时退回主窗，至少不会静默失效。
 */
function findHostLabel(): string {
  const injected = (window as unknown as { __ITH_SUGGEST_HOST__?: unknown }).__ITH_SUGGEST_HOST__
  return typeof injected === 'string' && injected ? injected : 'main'
}

const HOST_LABEL = findHostLabel()

function SuggestPanel() {
  const [frame, setFrame] = useState<SuggestFrame | null>(null)

  useEffect(function () {
    const stops: Array<() => void> = []
    function dismiss() {
      void emitTo(HOST_LABEL, SUGGEST_DISMISS, {})
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      dismiss()
    }
    void listen<SuggestFrame>(SUGGEST_FRAME, function (event) {
      setFrame(event.payload.open ? event.payload : null)
    }).then(function (stop) {
      stops.push(stop)
    })
    // 宿主建好 WebView 与推第一帧之间有竞态：就绪后主动要一次。
    void emitTo(HOST_LABEL, SUGGEST_READY, {})
    // 点到网页或别处时本视图失去焦点，让宿主一起收起；点进来之后 Esc 交给自己处理。
    window.addEventListener('blur', dismiss)
    window.addEventListener('keydown', onKeyDown)
    return function () {
      for (const stop of stops) stop()
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const rows = frame?.rows ?? []
  const active = frame?.active ?? 0

  return (
    <div
      className="box-border h-screen w-screen px-2.5 pb-2.5"
      onPointerDown={function (event) {
        // 空白处按下 = 关掉列表；行上的按下交给行自己。
        if (event.target === event.currentTarget) {
          void emitTo(HOST_LABEL, SUGGEST_DISMISS, {})
        }
      }}>
      <div className="box-border h-full w-full overflow-hidden rounded-b-[18px] border border-ring bg-popover text-popover-foreground shadow-md">
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
                  void emitTo(HOST_LABEL, SUGGEST_PICK, { url: row.url })
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
    </div>
  )
}

export { SuggestPanel }
