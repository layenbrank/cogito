import { useRef, useState } from 'react'

import { type GraphicsProps } from '@/features/capture/components/graphics'

interface CaptureHistorySnapshot {
  annotations: GraphicsProps[]
  selectedIDs: string[]
}

interface CaptureHistoryApi {
  canUndo: boolean
  canRedo: boolean
  commitHistory(this: void, next: GraphicsProps[], selectedIDs?: string[]): void
  undo(this: void): CaptureHistorySnapshot | null
  redo(this: void): CaptureHistorySnapshot | null
  resetHistory(this: void): void
}

function useCaptureHistory(): CaptureHistoryApi {
  const historyRef = useRef<CaptureHistorySnapshot[]>([{ annotations: [], selectedIDs: [] }])
  const historyStepRef = useRef(0)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  function syncHistoryFlags() {
    setCanUndo(historyStepRef.current > 0)
    setCanRedo(historyStepRef.current < historyRef.current.length - 1)
  }

  function commitHistory(next: GraphicsProps[], selectedIDs: string[] = []) {
    const truncated = historyRef.current.slice(0, historyStepRef.current + 1)
    truncated.push({ annotations: next, selectedIDs })
    historyRef.current = truncated
    historyStepRef.current = truncated.length - 1
    syncHistoryFlags()
  }

  function undo(): CaptureHistorySnapshot | null {
    if (historyStepRef.current === 0) return null
    historyStepRef.current -= 1
    syncHistoryFlags()
    return historyRef.current[historyStepRef.current] ?? null
  }

  function redo(): CaptureHistorySnapshot | null {
    if (historyStepRef.current >= historyRef.current.length - 1) return null
    historyStepRef.current += 1
    syncHistoryFlags()
    return historyRef.current[historyStepRef.current] ?? null
  }

  function resetHistory() {
    historyRef.current = [{ annotations: [], selectedIDs: [] }]
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

export type { CaptureHistoryApi, CaptureHistorySnapshot }
export { useCaptureHistory }
