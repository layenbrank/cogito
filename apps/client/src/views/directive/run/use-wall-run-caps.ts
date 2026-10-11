import { useEffect, useState } from 'react'

import { findDirectiveCaps, type Caps } from './run-caps'

function useWallRunCaps(name: string, given: Caps, refreshAlive: () => Promise<void>) {
  const [caps, updateCaps] = useState(given)

  const [snapshot, updateSnapshot] = useState({
    hasCron: given.hasCron,
    hasWatch: given.hasWatch
  })
  if (snapshot.hasCron !== given.hasCron || snapshot.hasWatch !== given.hasWatch) {
    updateSnapshot({ hasCron: given.hasCron, hasWatch: given.hasWatch })
    updateCaps(given)
  }

  useEffect(
    function () {
      if (!name) return
      let cancelled = false

      async function sync() {
        if (given.hasCron && given.hasWatch) {
          const refined = await findDirectiveCaps(name)
          if (cancelled) return
          updateCaps(refined)
        }
        if (cancelled) return
        await refreshAlive()
      }

      if (given.hasCron || given.hasWatch) void sync()
      return function () {
        cancelled = true
      }
    },
    [name, given.hasCron, given.hasWatch, refreshAlive]
  )

  return caps
}

export { useWallRunCaps }
