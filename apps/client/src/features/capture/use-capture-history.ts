import { useRef, useState } from 'react'

import { type GraphicsProps } from '@/features/capture/components/graphics'

interface CaptureHistoryApi {
  canUndo: boolean
  canRedo: boolean
  commitHistory(this: void, next: GraphicsProps[]): void
  undo(this: void): GraphicsProps[] | null
  redo(this: void): GraphicsProps[] | null
  resetHistory(this: void): void
}

function useCaptureHistory(): CaptureHistoryApi {
  const historyRef = useRef<GraphicsProps[][]>([[]])
  const historyStepRef = useRef(0)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  function syncHistoryFlags() {
    setCanUndo(historyStepRef.current > 0)
    setCanRedo(historyStepRef.current < historyRef.current.length - 1)
  }

  function commitHistory(next: GraphicsProps[]) {
    const truncated = historyRef.current.slice(0, historyStepRef.current + 1)
    truncated.push(next)
    historyRef.current = truncated
    historyStepRef.current = truncated.length - 1
    syncHistoryFlags()
  }

  function undo(): GraphicsProps[] | null {
    if (historyStepRef.current === 0) return null
    historyStepRef.current -= 1
    syncHistoryFlags()
    return historyRef.current[historyStepRef.current] ?? null
  }

  function redo(): GraphicsProps[] | null {
    if (historyStepRef.current >= historyRef.current.length - 1) return null
    historyStepRef.current += 1
    syncHistoryFlags()
    return historyRef.current[historyStepRef.current] ?? null
  }

  function resetHistory() {
    historyRef.current = [[]]
    historyStepRef.current = 0
    syncHistoryFlags()
  }

  return {
    canUndo,
    canRedo,
    commitHistory,
    undo,
    redo,
    resetHistory
  }
}

export type { CaptureHistoryApi }
export { useCaptureHistory }
