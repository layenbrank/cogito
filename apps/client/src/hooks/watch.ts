import { useEffect, useRef } from 'react'

function useWatch<T>(callback: (value: T) => void, options: { deps: any[]; once?: boolean }) {
  const { deps, once = false } = options
  const hasExecutedRef = useRef(false)
  const currentValue = deps.length > 0 ? (deps[deps.length - 1] as T) : (null as T)

  useEffect(
    function () {
      if (once && hasExecutedRef.current) return
      if (currentValue !== null && currentValue !== undefined) {
        callback(currentValue)
        hasExecutedRef.current = true
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps
  )

  return currentValue
}

export { useWatch }
