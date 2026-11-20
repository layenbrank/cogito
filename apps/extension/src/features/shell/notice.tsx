import { clsx } from 'clsx'

import { useNotice } from './notice-state.ts'

export function Notice() {
  const message = useNotice(function (state) {
    return state.message
  })

  if (!message) return null

  return (
    <div
      role="status"
      className={clsx(
        'fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md'
      )}>
      {message}
    </div>
  )
}
