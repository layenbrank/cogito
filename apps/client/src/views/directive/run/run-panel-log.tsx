import { useEffect, useRef } from 'react'

const BOTTOM_GAP = 32

interface RunPanelLogProps {
  logText: string
  placeholder: string
  isFollowing: boolean
  onFollowingChange: (following: boolean) => void
}

function RunPanelLog(props: RunPanelLogProps) {
  const logScrollerRef = useRef<HTMLDivElement | null>(null)
  const logEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(
    function () {
      if (!props.isFollowing) return
      const scroller = logScrollerRef.current
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight
        return
      }
      logEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
    },
    [props.logText, props.isFollowing]
  )

  function handleLogScroll() {
    const scroller = logScrollerRef.current
    if (!scroller) return
    const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    const atBottom = gap <= BOTTOM_GAP
    if (atBottom !== props.isFollowing) props.onFollowingChange(atBottom)
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
      <div
        ref={logScrollerRef}
        onScroll={handleLogScroll}
        className="absolute inset-0 overflow-auto overscroll-contain p-2"
        style={{ overflowAnchor: 'none' }}>
        <pre className="m-0 min-h-full w-full whitespace-pre-wrap wrap-break-word font-mono text-xs leading-5">
          {props.logText || props.placeholder}
        </pre>
        <div
          ref={logEndRef}
          aria-hidden
          className="h-px w-full"
        />
      </div>
    </div>
  )
}

export { RunPanelLog }
