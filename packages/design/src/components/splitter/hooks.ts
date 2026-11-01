import { useRef, type RefObject } from 'react'

import type { GroupHandle, PaneHandle } from './types'

function usePaneRef(): RefObject<PaneHandle | null> {
  return useRef<PaneHandle | null>(null)
}

function useGroupRef(): RefObject<GroupHandle | null> {
  return useRef<GroupHandle | null>(null)
}

export { useGroupRef, usePaneRef }
