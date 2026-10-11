import { useEffect, useRef } from 'react'

interface UseSurfaceSubmenuOptions {
  expandDelayMs: number
  collapseDelayMs: number
  keyPath: string[]
  onpathChange: (path: string[]) => void
  onUpdateActive: (key: string | undefined) => void
}

interface SurfaceSubmenuApi {
  expand(this: void, itemKey: string): void
  collapse(this: void): void
  cancelPendingClose(this: void): void
}

function useSurfaceSubmenu(options: UseSurfaceSubmenuOptions): SurfaceSubmenuApi {
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearTimers() {
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current)
      expandTimerRef.current = null
    }
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current)
      collapseTimerRef.current = null
    }
  }

  useEffect(function () {
    return function () {
      clearTimers()
    }
  }, [])

  function expand(itemKey: string) {
    clearTimers()
    expandTimerRef.current = setTimeout(function () {
      options.onpathChange([...options.keyPath, itemKey])
      options.onUpdateActive(itemKey)
    }, options.expandDelayMs)
  }

  function collapse() {
    clearTimers()
    collapseTimerRef.current = setTimeout(function () {
      options.onpathChange(options.keyPath)
    }, options.collapseDelayMs)
  }

  function cancelPendingClose() {
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current)
      collapseTimerRef.current = null
    }
  }

  return { expand, collapse, cancelPendingClose }
}

export type { SurfaceSubmenuApi, UseSurfaceSubmenuOptions }
export { useSurfaceSubmenu }
