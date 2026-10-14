"use client"

import { useCallback, useSyncExternalStore } from "react"

type BreakpointMode = "min" | "max"

/**
 * Hook to detect whether the current viewport matches a given breakpoint rule.
 * Example:
 *   useIsBreakpoint("max", 768)   // true when width < 768
 *   useIsBreakpoint("min", 1024)  // true when width >= 1024
 */
export function useIsBreakpoint(
  mode: BreakpointMode = "max",
  breakpoint = 768
) {
  const query =
    mode === "min"
      ? `(min-width: ${breakpoint}px)`
      : `(max-width: ${breakpoint - 1}px)`

  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    [query]
  )

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [
    query,
  ])

  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
