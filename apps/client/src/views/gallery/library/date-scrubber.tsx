import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import { cn } from 'cn'

import type { ScrollFx } from '@/features/controller/lib/scroll-fx'
import { findReducedMotion } from '@/features/window/appearance'
import type { ScrubberMark } from '@/views/gallery/library/time-buckets'

interface DateScrubberProps {
  marks: ScrubberMark[]
  scrollRoot: HTMLElement | null
  scrollFxRef?: RefObject<ScrollFx | null>
  className?: string
}

function DateScrubber(props: DateScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [activeKey, onActiveKey] = useState(props.marks[0]?.key ?? '')
  const [isDragging, onDragging] = useState(false)

  useEffect(
    function () {
      const root = props.scrollRoot
      if (!root || props.marks.length === 0) return

      function onScroll() {
        if (isDragging) return
        const sections = root!.querySelectorAll<HTMLElement>('[data-gallery-section]')
        let current = props.marks[0]?.key ?? ''
        for (const section of sections) {
          if (section.offsetTop - root!.scrollTop <= 48) {
            current = section.dataset.gallerySection || current
          }
        }
        onActiveKey(current)
      }

      root.addEventListener('scroll', onScroll, { passive: true })
      onScroll()
      return function () {
        root.removeEventListener('scroll', onScroll)
      }
    },
    [props.scrollRoot, props.marks, isDragging]
  )

  function scrollToMark(mark: ScrubberMark) {
    const root = props.scrollRoot
    if (!root) return
    const section = root.querySelector<HTMLElement>(`[data-gallery-section="${mark.key}"]`)
    if (!section) return
    const reduced = findReducedMotion()
    const top = section.offsetTop
    const fx = props.scrollFxRef?.current
    if (fx && !reduced) {
      fx.scrollToY(top, 0.55)
    } else {
      root.scrollTop = top
    }
    onActiveKey(mark.key)
  }

  function pickFromPointer(clientY: number) {
    const track = trackRef.current
    if (!track || props.marks.length === 0) return
    const rect = track.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
    const index = Math.round(ratio * (props.marks.length - 1))
    const mark = props.marks[index]
    if (mark) scrollToMark(mark)
  }

  if (props.marks.length < 2) return null

  return (
    <div
      className={cn(
        'pointer-events-none absolute top-16 right-2 bottom-24 z-20 flex w-8 flex-col items-center',
        props.className
      )}>
      <div
        ref={trackRef}
        className="pointer-events-auto relative flex h-full w-6 cursor-ns-resize items-stretch justify-center py-2"
        onPointerDown={function (event) {
          onDragging(true)
          ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
          pickFromPointer(event.clientY)
        }}
        onPointerMove={function (event) {
          if (!isDragging) return
          pickFromPointer(event.clientY)
        }}
        onPointerUp={function () {
          onDragging(false)
        }}
        onPointerCancel={function () {
          onDragging(false)
        }}>
        <div className="w-1 rounded-full bg-muted-foreground/25" />
        {props.marks.map(function (mark) {
          const isActive = mark.key === activeKey
          return (
            <button
              key={mark.key}
              type="button"
              className={cn(
                'absolute left-1/2 size-2.5 -translate-x-1/2 rounded-full border border-background bg-muted-foreground/50',
                isActive && 'size-3 bg-primary'
              )}
              style={{ top: `${mark.ratio * 100}%` }}
              title={mark.label}
              aria-label={mark.label}
              onClick={function (event) {
                event.stopPropagation()
                scrollToMark(mark)
              }}
            />
          )
        })}
      </div>
      {activeKey ? (
        <div className="pointer-events-none mt-2 max-w-24 truncate rounded-full bg-card/90 px-2 py-0.5 text-[10px] text-muted-foreground shadow-sm backdrop-blur-sm">
          {props.marks.find(function (mark) {
            return mark.key === activeKey
          })?.label ?? ''}
        </div>
      ) : null}
    </div>
  )
}

export { DateScrubber }
export type { DateScrubberProps }
